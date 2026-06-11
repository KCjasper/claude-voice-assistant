'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const {
  RemoteServer,
  isPrivateAddress,
  originMatchesRequest,
} = require('../src/remote/remote-server');

function nextMessage(ws, predicate = () => true) {
  const index = ws.testInbox.findIndex(predicate);
  if (index >= 0) return Promise.resolve(ws.testInbox.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    ws.testWaiters.push({ predicate, resolve, reject });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.testInbox = [];
    ws.testWaiters = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString('utf8'));
      const index = ws.testWaiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) {
        ws.testInbox.push(message);
        return;
      }
      const [waiter] = ws.testWaiters.splice(index, 1);
      waiter.resolve(message);
    });
    ws.on('error', (error) => {
      for (const waiter of ws.testWaiters.splice(0)) waiter.reject(error);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function rejectedStatus(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('unexpected-response', (request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    ws.once('open', () => reject(new Error('Expected WebSocket authentication failure.')));
    ws.once('error', () => {});
  });
}

test('accepts only private, link-local and loopback client addresses', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.10'), true);
  assert.equal(isPrivateAddress('172.20.0.5'), true);
  assert.equal(isPrivateAddress('::ffff:10.0.0.8'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
});

test('trusts forwarded browser origins only from loopback proxies', () => {
  const request = (remoteAddress, origin, host, forwardedHost) => ({
    socket: { remoteAddress },
    headers: {
      origin,
      host,
      'x-forwarded-host': forwardedHost,
    },
  });
  assert.equal(originMatchesRequest(request(
    '127.0.0.1',
    'https://demo.trycloudflare.com',
    '127.0.0.1:8787',
    'demo.trycloudflare.com'
  )), true);
  assert.equal(originMatchesRequest(request(
    '192.168.1.20',
    'https://demo.trycloudflare.com',
    '192.168.1.10:8787',
    'demo.trycloudflare.com'
  )), false);
  assert.equal(originMatchesRequest(request(
    '192.168.1.20',
    'http://192.168.1.10:8787',
    '192.168.1.10:8787',
    ''
  )), true);
});

test('serves static assets and rejects unauthenticated WebSocket upgrades', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-remote-'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Remote</h1>');
  const server = new RemoteServer({
    staticDir: directory,
    handlers: {
      getSession: () => ({ state: 'idle' }),
      interrupt: async () => ({ ok: true }),
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const started = await server.start({ host: '127.0.0.1', port: 0 });
  assert.equal(started.ok, true);
  const base = `http://127.0.0.1:${started.port}`;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Remote/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal(await rejectedStatus(`${base.replace('http', 'ws')}/ws`), 401);
});

test('pairs once, supports session reconnect and bridges progress/results', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-remote-'));
  fs.writeFileSync(path.join(directory, 'index.html'), 'Remote');
  const cancelled = [];
  const server = new RemoteServer({
    staticDir: directory,
    handlers: {
      getSession: () => ({ state: 'idle', convo: [] }),
      interrupt: async () => ({ ok: true, count: 1 }),
      cancelTask: (task) => {
        cancelled.push(task);
        return { ok: true, cancelled: [task.requestId] };
      },
      chat: async ({ text, onProgress, onTaskStart }) => {
        onTaskStart({ type: 'ai', requestId: 'backend-ai-1' });
        onProgress({ phase: 'sentence', text: 'Hello' });
        return { ok: true, text: `Echo: ${text}` };
      },
      transcribe: async () => ({ ok: true, text: 'voice' }),
      speak: async () => ({ ok: true, audioBase64: 'YXVkaW8=' }),
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const started = await server.start({ host: '127.0.0.1', port: 0 });
  const wsBase = `ws://127.0.0.1:${started.port}/ws`;

  const first = await connect(`${wsBase}?token=${encodeURIComponent(started.pairingToken)}`);
  const auth = await nextMessage(first, (message) => message.type === 'auth.ready');
  assert.ok(auth.sessionToken);
  assert.equal(await rejectedStatus(`${wsBase}?token=${encodeURIComponent(started.pairingToken)}`), 401);

  const reconnected = await connect(`${wsBase}?session=${encodeURIComponent(auth.sessionToken)}`);
  await nextMessage(reconnected, (message) => message.type === 'auth.ready');
  const progressPromise = nextMessage(reconnected, (message) => (
    message.type === 'progress' && message.requestId === 'chat-1'
  ));
  const resultPromise = nextMessage(reconnected, (message) => (
    message.type === 'result' && message.requestId === 'chat-1'
  ));
  reconnected.send(JSON.stringify({
    type: 'chat.send',
    requestId: 'chat-1',
    text: 'test',
  }));

  assert.equal((await progressPromise).progress.text, 'Hello');
  assert.equal((await resultPromise).result.text, 'Echo: test');
  first.close();
  reconnected.close();
  assert.deepEqual(cancelled, []);
});

test('validates remote audio before invoking Whisper', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-remote-'));
  fs.writeFileSync(path.join(directory, 'index.html'), 'Remote');
  let called = false;
  const server = new RemoteServer({
    staticDir: directory,
    handlers: {
      getSession: () => null,
      interrupt: async () => ({ ok: true }),
      transcribe: async () => {
        called = true;
        return { ok: true };
      },
    },
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const started = await server.start({ host: '127.0.0.1', port: 0 });
  const ws = await connect(
    `ws://127.0.0.1:${started.port}/ws?token=${encodeURIComponent(started.pairingToken)}`
  );
  await nextMessage(ws, (message) => message.type === 'auth.ready');
  const resultPromise = nextMessage(ws, (message) => message.requestId === 'stt-1');
  ws.send(JSON.stringify({
    type: 'stt.transcribe',
    requestId: 'stt-1',
    audioBase64: Buffer.from('not-wave').toString('base64'),
  }));

  assert.equal((await resultPromise).result.code, 'REMOTE_AUDIO_INVALID');
  assert.equal(called, false);
  ws.close();
});

test('disconnect and token rotation cancel tracked backend work', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-remote-'));
  fs.writeFileSync(path.join(directory, 'index.html'), 'Remote');
  const cancelled = [];
  let releaseChat;
  let markStarted;
  const taskStarted = new Promise((resolve) => { markStarted = resolve; });
  const server = new RemoteServer({
    staticDir: directory,
    handlers: {
      getSession: () => null,
      interrupt: async () => ({ ok: true }),
      cancelTask: (task) => {
        cancelled.push(task);
        return { ok: true };
      },
      chat: ({ onTaskStart }) => {
        onTaskStart({ type: 'ai', requestId: 'backend-pending' });
        markStarted();
        return new Promise((resolve) => { releaseChat = resolve; });
      },
    },
  });
  t.after(async () => {
    releaseChat?.({ ok: false, cancelled: true });
    await server.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const started = await server.start({ host: '127.0.0.1', port: 0 });
  const ws = await connect(
    `ws://127.0.0.1:${started.port}/ws?token=${encodeURIComponent(started.pairingToken)}`
  );
  await nextMessage(ws, (message) => message.type === 'auth.ready');
  ws.send(JSON.stringify({ type: 'chat.send', requestId: 'pending-1', text: 'wait' }));
  await taskStarted;
  ws.close();
  await new Promise((resolve) => ws.once('close', resolve));
  for (let attempt = 0; attempt < 10 && cancelled.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.deepEqual(cancelled, [{ type: 'ai', requestId: 'backend-pending' }]);

  const rotated = server.rotatePairingToken();
  assert.equal(rotated.activeSessions, 0);
  const second = await connect(
    `ws://127.0.0.1:${started.port}/ws?token=${encodeURIComponent(rotated.pairingToken)}`
  );
  await nextMessage(second, (message) => message.type === 'auth.ready');
  const closed = new Promise((resolve) => second.once('close', resolve));
  server.rotatePairingToken();
  const closeCode = await closed;
  assert.equal(closeCode, 4001);
});
