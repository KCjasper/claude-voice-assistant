'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { validPort } = require('./remote-server');

const CLOUDFLARE_DOCS_URL = 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/';
const QUICK_TUNNEL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

function isUsableFile(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function discoverCloudflared({
  configuredPath = '',
  envPath = process.env.PATH || '',
  platform = process.platform,
  fsImpl = fs,
} = {}) {
  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (path.isAbsolute(configuredPath) && isUsableFile(resolved, fsImpl)) return resolved;
  }
  const names = platform === 'win32'
    ? ['cloudflared.exe', 'cloudflared.cmd', 'cloudflared.bat']
    : ['cloudflared'];
  for (const directory of String(envPath).split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), name);
      if (isUsableFile(candidate, fsImpl)) return candidate;
    }
  }
  return null;
}

class CloudflaredTunnel {
  constructor({
    spawnImpl = spawn,
    fsImpl = fs,
    env = process.env,
    platform = process.platform,
    startupTimeoutMs = 30000,
    onState = () => {},
  } = {}) {
    this.spawn = spawnImpl;
    this.fs = fsImpl;
    this.env = env;
    this.platform = platform;
    this.startupTimeoutMs = startupTimeoutMs;
    this.onState = onState;
    this.child = null;
    this.startupPromise = null;
    this.cancelStartup = null;
    this.current = {
      status: 'stopped',
      publicUrl: null,
      binaryPath: null,
      error: null,
      startedAt: null,
    };
  }

  state() {
    return { ...this.current };
  }

  emitState(partial = {}) {
    this.current = { ...this.current, ...partial };
    const state = this.state();
    try { this.onState(state); } catch {}
    return state;
  }

  async start({ port, binaryPath = '', acknowledgeRisk = false } = {}) {
    if (!acknowledgeRisk) {
      return {
        ok: false,
        code: 'REMOTE_TUNNEL_RISK_ACK_REQUIRED',
        error: 'Explicit risk acknowledgement is required before exposing the remote server.',
      };
    }
    const normalizedPort = validPort(port);
    if (!normalizedPort) {
      return { ok: false, code: 'REMOTE_PORT_INVALID', error: 'Remote port must be between 1024 and 65535.' };
    }
    if (this.current.status === 'starting' && this.startupPromise) {
      return this.startupPromise;
    }
    if (this.child && this.current.status === 'running') {
      return { ok: true, ...this.state() };
    }
    const executable = discoverCloudflared({
      configuredPath: binaryPath,
      envPath: this.env.PATH || '',
      platform: this.platform,
      fsImpl: this.fs,
    });
    if (!executable) {
      return {
        ok: false,
        code: 'CLOUDFLARED_NOT_FOUND',
        error: 'Install the official cloudflared client or provide its absolute executable path.',
        docsUrl: CLOUDFLARE_DOCS_URL,
      };
    }

    this.emitState({
      status: 'starting',
      publicUrl: null,
      binaryPath: executable,
      error: null,
      startedAt: Date.now(),
    });

    let child;
    try {
      child = this.spawn(executable, [
        'tunnel',
        '--url',
        `http://127.0.0.1:${normalizedPort}`,
      ], {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
    } catch (error) {
      const state = this.emitState({
        status: 'error',
        publicUrl: null,
        error: error.message,
      });
      return {
        ok: false,
        code: 'REMOTE_TUNNEL_START_FAILED',
        error: error.message,
        ...state,
      };
    }

    let resolveStartup;
    let settled = false;
    let output = '';
    let timer = null;
    const startup = new Promise((resolve) => { resolveStartup = resolve; });
    this.startupPromise = startup;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.startupPromise = null;
      this.cancelStartup = null;
      resolveStartup(result);
    };
    const fail = (code, error) => {
      if (child !== this.child && this.current.status === 'stopped') return;
      if (child === this.child) this.child = null;
      const state = this.emitState({
        status: 'error',
        publicUrl: null,
        error,
      });
      finish({ ok: false, code, error, ...state });
    };
    const inspect = (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-16384);
      const match = output.match(QUICK_TUNNEL_PATTERN);
      if (!match || settled) return;
      const publicUrl = match[0].replace(/\/$/, '');
      const state = this.emitState({ status: 'running', publicUrl, error: null });
      finish({ ok: true, ...state });
    };
    this.cancelStartup = () => finish({
      ok: false,
      code: 'REMOTE_TUNNEL_STOPPED',
      error: 'Tunnel startup was stopped.',
      status: 'stopped',
      publicUrl: null,
    });

    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('error', (error) => fail('REMOTE_TUNNEL_START_FAILED', error.message));
    child.once('exit', (exitCode, signal) => {
      if (child !== this.child) return;
      this.child = null;
      if (!settled) {
        fail(
          'REMOTE_TUNNEL_EXITED',
          `cloudflared exited before publishing a URL (code ${exitCode ?? 'null'}, signal ${signal || 'none'}).`
        );
        return;
      }
      this.emitState({
        status: 'stopped',
        publicUrl: null,
        error: exitCode === 0 || exitCode === null
          ? null
          : `cloudflared exited with code ${exitCode}.`,
      });
    });

    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      fail(
        'REMOTE_TUNNEL_START_TIMEOUT',
        `cloudflared did not publish a Quick Tunnel URL within ${this.startupTimeoutMs} ms.`
      );
    }, this.startupTimeoutMs);
    return startup;
  }

  async stop() {
    this.cancelStartup?.();
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.kill(); } catch {}
    }
    return {
      ok: true,
      ...this.emitState({
        status: 'stopped',
        publicUrl: null,
        error: null,
        startedAt: null,
      }),
    };
  }
}

module.exports = {
  CLOUDFLARE_DOCS_URL,
  CloudflaredTunnel,
  QUICK_TUNNEL_PATTERN,
  discoverCloudflared,
  isUsableFile,
};
