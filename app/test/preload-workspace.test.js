'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('preload exposes the documented workspace contract', async () => {
  const originalLoad = Module._load;
  const invokes = [];
  const listeners = new Map();
  let exposedApi;

  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld: (name, api) => {
            assert.equal(name, 'api');
            exposedApi = api;
          },
        },
        ipcRenderer: {
          invoke: async (channel, ...args) => {
            invokes.push([channel, ...args]);
            return { channel, args };
          },
          send: () => {},
          on: (channel, listener) => listeners.set(channel, listener),
          removeListener: (channel, listener) => {
            if (listeners.get(channel) === listener) listeners.delete(channel);
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const preloadPath = require.resolve('../preload');
  delete require.cache[preloadPath];
  try {
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
  }

  assert.equal(typeof exposedApi.getWorkspace, 'function');
  assert.equal(typeof exposedApi.chooseWorkspace, 'function');
  assert.equal(typeof exposedApi.pickWorkspace, 'function');
  assert.equal(typeof exposedApi.setActiveWorkspace, 'function');
  assert.equal(typeof exposedApi.setWorkspace, 'function');
  assert.equal(typeof exposedApi.removeWorkspace, 'function');
  assert.equal(typeof exposedApi.onWorkspaceChanged, 'function');
  assert.equal(typeof exposedApi.getPttHotkey, 'function');
  assert.equal(typeof exposedApi.setPttHotkey, 'function');
  assert.equal(typeof exposedApi.onPttHotkeyChanged, 'function');
  assert.equal(typeof exposedApi.listModels, 'function');
  assert.equal(typeof exposedApi.getWakeWordState, 'function');
  assert.equal(typeof exposedApi.listWakeWordDevices, 'function');
  assert.equal(typeof exposedApi.setWakeWordConfig, 'function');
  assert.equal(typeof exposedApi.setWakeWordAccessKey, 'function');
  assert.equal(typeof exposedApi.clearWakeWordAccessKey, 'function');
  assert.equal(typeof exposedApi.chooseWakeWordKeyword, 'function');
  assert.equal(typeof exposedApi.retryWakeWord, 'function');
  assert.equal(typeof exposedApi.onWakeWordState, 'function');
  assert.equal(typeof exposedApi.onWakeWordDetected, 'function');
  assert.equal(typeof exposedApi.listConnectors, 'function');
  assert.equal(typeof exposedApi.setConnectorCredential, 'function');
  assert.equal(typeof exposedApi.clearConnectorCredential, 'function');
  assert.equal(typeof exposedApi.checkConnectorHealth, 'function');
  assert.equal(typeof exposedApi.getPendingConnectorConfirmations, 'function');
  assert.equal(typeof exposedApi.approveConnectorAction, 'function');
  assert.equal(typeof exposedApi.rejectConnectorAction, 'function');
  assert.equal(typeof exposedApi.onConnectorEvent, 'function');
  assert.equal(typeof exposedApi.getRemoteStatus, 'function');
  assert.equal(typeof exposedApi.startRemote, 'function');
  assert.equal(typeof exposedApi.stopRemote, 'function');
  assert.equal(typeof exposedApi.rotateRemoteToken, 'function');
  assert.equal(typeof exposedApi.getRemoteProtocol, 'function');
  assert.equal(typeof exposedApi.onRemoteState, 'function');

  await exposedApi.getWorkspace();
  await exposedApi.chooseWorkspace();
  await exposedApi.pickWorkspace();
  await exposedApi.setActiveWorkspace('C:\\projects\\Current');
  await exposedApi.setWorkspace('C:\\projects\\Jarvis');
  await exposedApi.removeWorkspace('C:\\projects\\Old');
  await exposedApi.getPttHotkey();
  await exposedApi.setPttHotkey('Control+Space');
  await exposedApi.listModels({ force: true });
  await exposedApi.getWakeWordState();
  await exposedApi.listWakeWordDevices();
  await exposedApi.setWakeWordConfig({ wakeWordEnabled: true });
  await exposedApi.setWakeWordAccessKey('secret');
  await exposedApi.clearWakeWordAccessKey();
  await exposedApi.chooseWakeWordKeyword();
  await exposedApi.retryWakeWord();
  await exposedApi.listConnectors();
  await exposedApi.setConnectorCredential('notion', 'secret');
  await exposedApi.clearConnectorCredential('notion');
  await exposedApi.checkConnectorHealth('notion');
  await exposedApi.getPendingConnectorConfirmations();
  await exposedApi.approveConnectorAction('confirm-1');
  await exposedApi.rejectConnectorAction('confirm-2');
  await exposedApi.getRemoteStatus();
  await exposedApi.startRemote({ port: 8787 });
  await exposedApi.stopRemote();
  await exposedApi.rotateRemoteToken();
  await exposedApi.getRemoteProtocol();
  assert.deepEqual(invokes, [
    ['workspace:get'],
    ['workspace:choose'],
    ['workspace:pick'],
    ['workspace:set', 'C:\\projects\\Current'],
    ['workspace:set', 'C:\\projects\\Jarvis'],
    ['workspace:remove', 'C:\\projects\\Old'],
    ['hotkey:get'],
    ['hotkey:set', 'Control+Space'],
    ['ai:list-models', { force: true }],
    ['wake-word:get'],
    ['wake-word:list-devices'],
    ['wake-word:set-config', { wakeWordEnabled: true }],
    ['wake-word:set-access-key', 'secret'],
    ['wake-word:clear-access-key'],
    ['wake-word:choose-keyword'],
    ['wake-word:retry'],
    ['connector:list'],
    ['connector:set-credential', 'notion', 'secret'],
    ['connector:clear-credential', 'notion'],
    ['connector:health', 'notion'],
    ['connector:pending-confirmations'],
    ['connector:approve', 'confirm-1'],
    ['connector:reject', 'confirm-2'],
    ['remote:get-status'],
    ['remote:start', { port: 8787 }],
    ['remote:stop'],
    ['remote:rotate-token'],
    ['remote:get-protocol'],
  ]);

  const received = [];
  const unsubscribe = exposedApi.onWorkspaceChanged((state) => received.push(state));
  const payload = {
    active: 'C:\\projects\\Jarvis',
    folders: [{ path: 'C:\\projects\\Jarvis', name: 'Jarvis' }],
  };
  listeners.get('workspace:changed')({}, payload);
  assert.deepEqual(received, [payload]);

  unsubscribe();
  assert.equal(listeners.has('workspace:changed'), false);
});
