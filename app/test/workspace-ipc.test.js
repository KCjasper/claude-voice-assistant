'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerWorkspaceIpc,
} = require('../src/config/workspace-ipc');

function setup({
  dialogResult = { canceled: true, filePaths: [] },
  operationError = null,
} = {}) {
  const handlers = new Map();
  const sent = [];
  const liveWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload }),
    },
  };
  const destroyedWindow = {
    isDestroyed: () => true,
    webContents: {
      send: () => sent.push({ channel: 'destroyed' }),
    },
  };
  const states = {
    initial: {
      workspaceDir: 'C:\\repo',
      approvedFolders: [],
    },
    changed: {
      workspaceDir: 'C:\\projects\\Jarvis',
      approvedFolders: [
        { path: 'C:\\projects\\Jarvis', name: 'Jarvis' },
      ],
    },
  };
  const calls = [];
  const store = {
    getWorkspaceState: () => states.initial,
    approveWorkspace: (folderPath) => {
      calls.push(['approve', folderPath]);
      if (operationError) throw operationError;
      return states.changed;
    },
    setWorkspace: (folderPath) => {
      calls.push(['set', folderPath]);
      if (operationError) throw operationError;
      return states.changed;
    },
    removeWorkspace: (folderPath) => {
      calls.push(['remove', folderPath]);
      if (operationError) throw operationError;
      return states.initial;
    },
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  const BrowserWindow = {
    fromWebContents: () => liveWindow,
    getAllWindows: () => [liveWindow, destroyedWindow],
  };
  const dialog = {
    showOpenDialog: async () => dialogResult,
  };

  registerWorkspaceIpc({ ipcMain, dialog, BrowserWindow, store });
  return { calls, handlers, sent, states };
}

test('registers compatible renderer methods and returns the stored state', async () => {
  const { handlers, states } = setup();

  assert.deepEqual(
    [...handlers.keys()].sort(),
    [
      'workspace:choose',
      'workspace:get',
      'workspace:pick',
      'workspace:remove',
      'workspace:set',
    ]
  );
  assert.equal(handlers.get('workspace:choose'), handlers.get('workspace:pick'));
  assert.deepEqual(await handlers.get('workspace:get')(), {
    ok: true,
    state: states.initial,
  });
});

test('picking a folder authorizes it and broadcasts the changed state', async () => {
  const { calls, handlers, sent, states } = setup({
    dialogResult: {
      canceled: false,
      filePaths: ['C:\\projects\\Jarvis'],
    },
  });

  const result = await handlers.get('workspace:pick')({
    sender: {},
  });

  assert.deepEqual(calls, [['approve', 'C:\\projects\\Jarvis']]);
  assert.deepEqual(result, {
    ok: true,
    canceled: false,
    state: states.changed,
  });
  assert.deepEqual(sent, [{
    channel: 'workspace:changed',
    payload: {
      active: states.changed.workspaceDir,
      folders: states.changed.approvedFolders,
      isDefault: false,
    },
  }]);
});

test('canceling the picker returns current state without broadcasting', async () => {
  const { handlers, sent } = setup();

  const result = await handlers.get('workspace:pick')({
    sender: {},
  });

  assert.deepEqual(result, {
    ok: true,
    canceled: true,
    state: {
      workspaceDir: 'C:\\repo',
      approvedFolders: [],
    },
  });
  assert.deepEqual(sent, []);
});

test('set and remove broadcast while policy errors stay structured', async () => {
  const success = setup();
  const setResult = await success.handlers.get('workspace:set')({}, 'C:\\projects\\Jarvis');
  const removeResult = await success.handlers.get('workspace:remove')({}, 'C:\\projects\\Jarvis');

  assert.equal(setResult.ok, true);
  assert.equal(removeResult.ok, true);
  assert.deepEqual(success.calls, [
    ['set', 'C:\\projects\\Jarvis'],
    ['remove', 'C:\\projects\\Jarvis'],
  ]);
  assert.equal(success.sent.length, 2);

  const error = Object.assign(new Error('Folder is not approved.'), {
    code: 'WORKSPACE_NOT_APPROVED',
    details: { path: 'C:\\blocked' },
  });
  const failed = setup({ operationError: error });
  assert.deepEqual(
    await failed.handlers.get('workspace:set')({}, 'C:\\blocked'),
    {
      ok: false,
      error: 'Folder is not approved.',
      code: 'WORKSPACE_NOT_APPROVED',
      details: { path: 'C:\\blocked' },
    }
  );
  assert.deepEqual(failed.sent, []);
});
