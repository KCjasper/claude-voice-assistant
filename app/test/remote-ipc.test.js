'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRemoteIpc } = require('../src/remote/remote-ipc');

test('remote IPC validates ports and persists only successful lifecycle changes', async () => {
  const handlers = new Map();
  const saved = [];
  const server = {
    state: () => ({ running: false, pairingToken: 'pair' }),
    start: async ({ host, port }) => ({ ok: true, running: true, host, port }),
    stop: async () => ({ ok: true, running: false }),
    rotatePairingToken: () => ({ ok: true, pairingToken: 'rotated' }),
  };
  registerRemoteIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    store: {
      loadPrefs: () => ({ remotePort: 8787 }),
      savePrefs: (partial) => saved.push(partial),
    },
    getServer: () => server,
  });

  assert.equal((await handlers.get('remote:start')({}, { port: 80 })).code, 'REMOTE_PORT_INVALID');
  const started = await handlers.get('remote:start')({}, { port: 9000 });
  assert.equal(started.host, '0.0.0.0');
  assert.deepEqual(saved, [{ remoteEnabled: true, remotePort: 9000 }]);

  assert.equal((await handlers.get('remote:rotate-token')()).pairingToken, 'rotated');
  await handlers.get('remote:stop')();
  assert.deepEqual(saved.at(-1), { remoteEnabled: false });
  assert.equal((await handlers.get('remote:get-protocol')()).protocolVersion, 1);
});
