'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  CloudflaredTunnel,
  discoverCloudflared,
} = require('../src/remote/cloudflared-tunnel');

function mockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCount = 0;
  child.kill = () => {
    child.killCount += 1;
    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
    return true;
  };
  return child;
}

test('discovers configured and PATH cloudflared executables', () => {
  const configured = path.resolve('tools', 'cloudflared.exe');
  const fsImpl = {
    statSync: (candidate) => ({
      isFile: () => [configured, path.join('C:\\bin', 'cloudflared.exe')].includes(candidate),
    }),
  };

  assert.equal(discoverCloudflared({
    configuredPath: configured,
    platform: 'win32',
    fsImpl,
  }), configured);
  assert.equal(discoverCloudflared({
    envPath: 'C:\\bin',
    platform: 'win32',
    fsImpl,
  }), path.join('C:\\bin', 'cloudflared.exe'));
});

test('requires acknowledgement and reports a missing official client', async () => {
  const tunnel = new CloudflaredTunnel({
    fsImpl: { statSync: () => { throw new Error('missing'); } },
    env: { PATH: '' },
  });

  assert.equal((await tunnel.start({ port: 8787 })).code, 'REMOTE_TUNNEL_RISK_ACK_REQUIRED');
  const missing = await tunnel.start({ port: 8787, acknowledgeRisk: true });
  assert.equal(missing.code, 'CLOUDFLARED_NOT_FOUND');
  assert.match(missing.docsUrl, /developers\.cloudflare\.com/);
});

test('starts a Quick Tunnel, parses its public URL and stops the child', async () => {
  const child = mockChild();
  let invocation;
  const executable = path.resolve('cloudflared.exe');
  const tunnel = new CloudflaredTunnel({
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      queueMicrotask(() => {
        child.stderr.emit(
          'data',
          Buffer.from('Your quick Tunnel has been created! https://unit-test.trycloudflare.com')
        );
      });
      return child;
    },
    fsImpl: { statSync: () => ({ isFile: () => true }) },
    env: { PATH: '' },
  });

  const started = await tunnel.start({
    port: 8787,
    binaryPath: executable,
    acknowledgeRisk: true,
  });
  assert.equal(started.ok, true);
  assert.equal(started.publicUrl, 'https://unit-test.trycloudflare.com');
  assert.deepEqual(invocation.args, [
    'tunnel',
    '--url',
    'http://127.0.0.1:8787',
  ]);
  assert.equal(invocation.options.windowsHide, true);

  const stopped = await tunnel.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(child.killCount, 1);
});

test('times out when cloudflared never publishes a URL', async () => {
  const child = mockChild();
  const tunnel = new CloudflaredTunnel({
    spawnImpl: () => child,
    fsImpl: { statSync: () => ({ isFile: () => true }) },
    env: { PATH: '' },
    startupTimeoutMs: 10,
  });

  const result = await tunnel.start({
    port: 8787,
    binaryPath: path.resolve('cloudflared.exe'),
    acknowledgeRisk: true,
  });
  assert.equal(result.code, 'REMOTE_TUNNEL_START_TIMEOUT');
  assert.equal(child.killCount, 1);
});

test('stopping during startup resolves pending and duplicate start calls', async () => {
  const child = mockChild();
  let spawnCount = 0;
  const tunnel = new CloudflaredTunnel({
    spawnImpl: () => {
      spawnCount += 1;
      return child;
    },
    fsImpl: { statSync: () => ({ isFile: () => true }) },
    env: { PATH: '' },
    startupTimeoutMs: 1000,
  });
  const options = {
    port: 8787,
    binaryPath: path.resolve('cloudflared.exe'),
    acknowledgeRisk: true,
  };

  const first = tunnel.start(options);
  const duplicate = tunnel.start(options);
  await tunnel.stop();

  assert.equal((await first).code, 'REMOTE_TUNNEL_STOPPED');
  assert.equal((await duplicate).code, 'REMOTE_TUNNEL_STOPPED');
  assert.equal(spawnCount, 1);
  assert.equal(child.killCount, 1);
  assert.equal(tunnel.state().status, 'stopped');
});
