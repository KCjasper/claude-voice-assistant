'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRemoteIpc } = require('../src/remote/remote-ipc');

test('remote IPC validates ports and persists only successful lifecycle changes', async () => {
  const handlers = new Map();
  const saved = [];
  const tunnelCalls = [];
  const server = {
    state: () => ({ running: false, pairingToken: 'pair' }),
    start: async ({ host, port }) => ({ ok: true, running: true, host, port }),
    stop: async () => ({ ok: true, running: false }),
    rotatePairingToken: () => ({ ok: true, pairingToken: 'rotated' }),
  };
  const tunnel = {
    state: () => ({ status: 'stopped', publicUrl: null }),
    start: async (options) => {
      tunnelCalls.push(['start', options]);
      return {
        ok: true,
        status: 'running',
        binaryPath: 'C:\\tools\\cloudflared.exe',
        publicUrl: 'https://test.trycloudflare.com',
      };
    },
    stop: async () => {
      tunnelCalls.push(['stop']);
      return { ok: true, status: 'stopped' };
    },
  };
  registerRemoteIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    store: {
      loadPrefs: () => ({
        remotePort: 8787,
        remoteTunnelBinaryPath: 'C:\\tools\\cloudflared.exe',
      }),
      savePrefs: (partial) => saved.push(partial),
    },
    getServer: () => server,
    getTunnel: () => tunnel,
  });

  assert.equal((await handlers.get('remote:start')({}, { port: 80 })).code, 'REMOTE_PORT_INVALID');
  const started = await handlers.get('remote:start')({}, { port: 9000 });
  assert.equal(started.host, '0.0.0.0');
  assert.deepEqual(saved, [{ remoteEnabled: true, remotePort: 9000 }]);

  assert.equal((await handlers.get('remote:rotate-token')()).pairingToken, 'rotated');
  const access = await handlers.get('remote:get-access')();
  assert.equal(access.ok, true);

  server.state = () => ({ running: true, port: 9000, pairingToken: 'pair' });
  const tunnelResult = await handlers.get('remote:start-tunnel')({}, {
    acknowledgeRisk: true,
  });
  assert.equal(tunnelResult.status, 'running');
  assert.deepEqual(tunnelCalls[0], ['start', {
    port: 9000,
    binaryPath: 'C:\\tools\\cloudflared.exe',
    acknowledgeRisk: true,
  }]);
  assert.deepEqual(saved.at(-1), {
    remoteTunnelBinaryPath: 'C:\\tools\\cloudflared.exe',
  });

  await handlers.get('remote:stop')();
  assert.deepEqual(saved.at(-1), { remoteEnabled: false });
  assert.deepEqual(tunnelCalls.slice(-1), [['stop']]);
  assert.equal((await handlers.get('remote:get-protocol')()).protocolVersion, 1);
});
