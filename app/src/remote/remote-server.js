'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { RemoteTokenManager } = require('./token-manager');

const PROTOCOL_VERSION = 1;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20000;
const MAX_CONCURRENT_REQUESTS = 2;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

function safeJson(value) {
  return JSON.stringify(value, (key, item) => item === undefined ? null : item);
}

function isWave(buffer) {
  return (
    Buffer.isBuffer(buffer)
    && buffer.length >= 44
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WAVE'
  );
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;
  const parts = mapped.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
  );
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  return value === '::1' || value === '127.0.0.1' || value === '::ffff:127.0.0.1';
}

function originMatchesRequest(request) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const accepted = new Set([String(request.headers?.host || '').toLowerCase()]);
    if (isLoopbackAddress(request.socket?.remoteAddress)) {
      const forwarded = String(request.headers?.['x-forwarded-host'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
      if (forwarded) accepted.add(forwarded);
    }
    return accepted.has(originHost);
  } catch {
    return false;
  }
}

class RemoteServer {
  constructor({
    staticDir,
    handlers,
    tokenManager = new RemoteTokenManager(),
    onState = () => {},
    fsImpl = fs,
    httpImpl = http,
    WebSocketServerImpl = WebSocketServer,
  }) {
    this.staticDir = path.resolve(staticDir);
    this.handlers = handlers;
    this.tokenManager = tokenManager;
    this.onState = onState;
    this.fs = fsImpl;
    this.http = httpImpl;
    this.WebSocketServer = WebSocketServerImpl;
    this.server = null;
    this.wss = null;
    this.clients = new Map();
    this.host = '0.0.0.0';
    this.port = 8787;
  }

  state() {
    const address = this.server?.address();
    return {
      running: Boolean(this.server?.listening),
      host: this.host,
      port: typeof address === 'object' && address ? address.port : this.port,
      clients: this.clients.size,
      protocolVersion: PROTOCOL_VERSION,
      ...this.tokenManager.status(),
    };
  }

  emitState() {
    const state = this.state();
    try { this.onState(state); } catch {}
    return state;
  }

  async start({ host = '0.0.0.0', port = 8787 } = {}) {
    if (this.server?.listening) return { ok: true, ...this.state() };
    if (!['0.0.0.0', '127.0.0.1'].includes(host)) {
      return { ok: false, code: 'REMOTE_HOST_INVALID', error: 'Remote host must be LAN or localhost.' };
    }
    const normalizedPort = validPort(port);
    if (!normalizedPort && Number(port) !== 0) {
      return { ok: false, code: 'REMOTE_PORT_INVALID', error: 'Remote port must be between 1024 and 65535.' };
    }
    this.host = host;
    this.port = Number(port) === 0 ? 0 : normalizedPort;
    this.tokenManager.rotate();
    this.wss = new this.WebSocketServer({
      noServer: true,
      maxPayload: MAX_AUDIO_BYTES * 2,
      perMessageDeflate: false,
    });
    this.server = this.http.createServer((request, response) => {
      this.handleHttp(request, response);
    });
    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        this.server.once('error', onError);
        this.server.listen(this.port, this.host, () => {
          this.server.removeListener('error', onError);
          resolve();
        });
      });
      return { ok: true, ...this.emitState() };
    } catch (error) {
      await this.stop();
      return {
        ok: false,
        code: error.code === 'EADDRINUSE' ? 'REMOTE_PORT_IN_USE' : 'REMOTE_START_FAILED',
        error: error.message,
      };
    }
  }

  async stop() {
    for (const ws of this.clients.keys()) {
      try { ws.close(1001, 'Remote server stopped'); } catch {}
    }
    this.clients.clear();
    this.tokenManager.revokeAll();
    const server = this.server;
    const wss = this.wss;
    this.server = null;
    this.wss = null;
    try { wss?.close(); } catch {}
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    return { ok: true, ...this.emitState() };
  }

  rotatePairingToken() {
    for (const ws of this.clients.keys()) {
      try { ws.close(4001, 'Remote credentials rotated'); } catch {}
    }
    this.tokenManager.rotate();
    return { ok: true, ...this.emitState() };
  }

  securityHeaders(response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob: data:; img-src 'self' data:; style-src 'self'; script-src 'self'"
    );
  }

  handleHttp(request, response) {
    this.securityHeaders(response);
    if (!isPrivateAddress(request.socket?.remoteAddress)) {
      response.writeHead(403);
      return response.end();
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      return response.end();
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url, 'http://remote.local');
    } catch {
      response.writeHead(400);
      return response.end();
    }
    if (requestUrl.pathname === '/health') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return response.end(safeJson({
        ok: true,
        running: true,
        protocolVersion: PROTOCOL_VERSION,
      }));
    }
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400);
      return response.end();
    }
    if (pathname.includes('\0') || pathname.split('/').includes('..')) {
      response.writeHead(403);
      return response.end();
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
      response.writeHead(403);
      return response.end();
    }
    const filePath = path.resolve(this.staticDir, relative);
    if (
      filePath !== this.staticDir
      && !filePath.startsWith(`${this.staticDir}${path.sep}`)
    ) {
      response.writeHead(403);
      return response.end();
    }
    try {
      const realRoot = this.fs.realpathSync(this.staticDir);
      const realFile = this.fs.realpathSync(filePath);
      if (
        realFile !== realRoot
        && !realFile.startsWith(`${realRoot}${path.sep}`)
      ) {
        response.writeHead(403);
        return response.end();
      }
      const stat = this.fs.statSync(realFile);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Unavailable');
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      });
      if (request.method === 'HEAD') return response.end();
      return this.fs.createReadStream(realFile).pipe(response);
    } catch {
      const missingClient = !this.fs.existsSync(this.staticDir);
      response.writeHead(missingClient ? 503 : 404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return response.end(safeJson({
        ok: false,
        code: missingClient ? 'REMOTE_CLIENT_UNAVAILABLE' : 'NOT_FOUND',
      }));
    }
  }

  rejectUpgrade(socket, status, message) {
    try {
      socket.write(
        `HTTP/1.1 ${status} ${message}\r\n`
        + 'Connection: close\r\n'
        + 'Content-Type: text/plain; charset=utf-8\r\n'
        + `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`
        + message
      );
    } finally {
      socket.destroy();
    }
  }

  handleUpgrade(request, socket, head) {
    if (!isPrivateAddress(request.socket?.remoteAddress)) {
      return this.rejectUpgrade(socket, 403, 'LAN Access Only');
    }
    let requestUrl;
    try {
      requestUrl = new URL(request.url, `http://${request.headers.host || 'remote.local'}`);
    } catch {
      return this.rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (requestUrl.pathname !== '/ws') {
      return this.rejectUpgrade(socket, 404, 'Not Found');
    }
    if (!originMatchesRequest(request)) {
      return this.rejectUpgrade(socket, 403, 'Forbidden Origin');
    }
    const auth = this.tokenManager.authenticate({
      pairingToken: requestUrl.searchParams.get('token'),
      sessionToken: requestUrl.searchParams.get('session'),
    });
    if (!auth.ok) return this.rejectUpgrade(socket, 401, 'Unauthorized');
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, auth);
    });
  }

  send(ws, payload) {
    if (ws.readyState !== 1) return false;
    try {
      ws.send(safeJson(payload));
      return true;
    } catch {
      return false;
    }
  }

  handleConnection(ws, auth) {
    const client = {
      active: new Map(),
      connectedAt: Date.now(),
    };
    this.clients.set(ws, client);
    this.send(ws, {
      type: 'auth.ready',
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: auth.sessionToken || null,
      sessionExpiresAt: auth.sessionExpiresAt,
    });
    try {
      const session = this.handlers.getSession?.();
      if (session) this.send(ws, { type: 'session.state', session });
    } catch {}
    this.emitState();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        return this.send(ws, {
          type: 'error',
          code: 'REMOTE_BINARY_UNSUPPORTED',
          error: 'Use JSON messages with base64 audio.',
        });
      }
      void this.handleMessage(ws, client, data.toString('utf8'));
    });
    ws.on('close', () => {
      for (const task of client.active.values()) {
        if (task.backend) this.handlers.cancelTask?.(task.backend);
      }
      this.clients.delete(ws);
      this.emitState();
    });
    ws.on('error', () => {});
  }

  async handleMessage(ws, client, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.send(ws, { type: 'error', code: 'REMOTE_JSON_INVALID', error: 'Invalid JSON.' });
    }
    const type = typeof message?.type === 'string' ? message.type : '';
    const requestId = typeof message?.requestId === 'string'
      ? message.requestId.slice(0, 100)
      : '';
    if (!type || !requestId) {
      return this.send(ws, {
        type: 'error',
        requestId: requestId || null,
        code: 'REMOTE_MESSAGE_INVALID',
        error: 'type and requestId are required.',
      });
    }
    if (type === 'ping') {
      return this.send(ws, { type: 'pong', requestId, timestamp: Date.now() });
    }
    if (type === 'session.get') {
      return this.send(ws, {
        type: 'result',
        requestId,
        channel: 'session',
        result: { ok: true, session: this.handlers.getSession?.() || null },
      });
    }
    if (type === 'interrupt') {
      return this.send(ws, {
        type: 'result',
        requestId,
        channel: 'interrupt',
        result: await this.handlers.interrupt(),
      });
    }
    if (type === 'request.cancel') {
      const active = client.active.get(message.targetRequestId);
      const result = active?.backend
        ? this.handlers.cancelTask(active.backend)
        : { ok: false, code: 'REMOTE_REQUEST_NOT_FOUND' };
      return this.send(ws, { type: 'result', requestId, channel: 'cancel', result });
    }
    if (client.active.size >= MAX_CONCURRENT_REQUESTS) {
      return this.send(ws, {
        type: 'result',
        requestId,
        channel: type,
        result: {
          ok: false,
          code: 'REMOTE_BUSY',
          error: 'Too many concurrent remote requests.',
        },
      });
    }
    const active = { backend: null };
    client.active.set(requestId, active);
    const onTaskStart = (backend) => { active.backend = backend; };
    const onProgress = (progress) => this.send(ws, {
      type: 'progress',
      requestId,
      channel: type,
      progress,
    });
    let result;
    try {
      if (type === 'chat.send') {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text || text.length > MAX_TEXT_LENGTH) {
          result = { ok: false, code: 'REMOTE_TEXT_INVALID', error: 'Chat text is required and must be under 20,000 characters.' };
        } else {
          result = await this.handlers.chat({
            text,
            options: message.options || {},
            onProgress,
            onTaskStart,
          });
        }
      } else if (type === 'stt.transcribe') {
        if (typeof message.audioBase64 !== 'string' || message.audioBase64.length > MAX_AUDIO_BYTES * 2) {
          result = { ok: false, code: 'REMOTE_AUDIO_INVALID', error: 'A bounded base64 WAV payload is required.' };
        } else {
          const audio = Buffer.from(message.audioBase64, 'base64');
          if (!isWave(audio) || audio.length > MAX_AUDIO_BYTES) {
            result = { ok: false, code: 'REMOTE_AUDIO_INVALID', error: 'Audio must be a valid WAV file up to 8 MB.' };
          } else {
            result = await this.handlers.transcribe({
              audio,
              options: message.options || {},
              onProgress,
              onTaskStart,
            });
          }
        }
      } else if (type === 'tts.synthesize') {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text || text.length > MAX_TEXT_LENGTH) {
          result = { ok: false, code: 'REMOTE_TEXT_INVALID', error: 'TTS text is required and must be under 20,000 characters.' };
        } else {
          result = await this.handlers.speak({
            text,
            options: message.options || {},
            onTaskStart,
          });
        }
      } else {
        result = { ok: false, code: 'REMOTE_MESSAGE_UNKNOWN', error: `Unknown message type: ${type}` };
      }
    } catch (error) {
      result = { ok: false, code: 'REMOTE_HANDLER_FAILED', error: error.message };
    } finally {
      client.active.delete(requestId);
    }
    return this.send(ws, {
      type: 'result',
      requestId,
      channel: type,
      result,
    });
  }

  broadcastSession(session) {
    for (const ws of this.clients.keys()) {
      this.send(ws, { type: 'session.state', session });
    }
  }
}

module.exports = {
  MAX_AUDIO_BYTES,
  MAX_CONCURRENT_REQUESTS,
  MAX_TEXT_LENGTH,
  PROTOCOL_VERSION,
  RemoteServer,
  isLoopbackAddress,
  isPrivateAddress,
  isWave,
  originMatchesRequest,
  validPort,
};
