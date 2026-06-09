'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-workspace-store-'));
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-workspace-home-'));
const originalLoad = Module._load;

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => name === 'home' ? homeDir : configDir,
      },
      safeStorage: { isEncryptionAvailable: () => false },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const store = require('../src/config/store');
Module._load = originalLoad;

test.after(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('general preference saves cannot inject workspace authorization', () => {
  const injected = path.join(homeDir, 'Injected');
  fs.mkdirSync(injected);

  store.savePrefs({
    workspaceDir: injected,
    approvedFolders: [{ path: injected, name: 'Injected' }],
    monthlyCapUsd: 30,
  });

  const prefs = store.loadPrefs();
  assert.equal(prefs.workspaceDir, '');
  assert.deepEqual(prefs.approvedFolders, []);
  assert.equal(prefs.monthlyCapUsd, 30);
});

test('approved folders can be activated, switched and removed', () => {
  const validationOptions = { systemPaths: [] };
  const first = path.join(homeDir, 'First Project');
  const second = path.join(homeDir, 'Second Project');
  fs.mkdirSync(first);
  fs.mkdirSync(second);

  const firstState = store.approveWorkspace(first, validationOptions);
  assert.equal(firstState.workspaceDir, fs.realpathSync(first));
  assert.equal(firstState.approvedFolders.length, 1);

  store.approveWorkspace(second, validationOptions);
  const switched = store.setWorkspace(first, validationOptions);
  assert.equal(switched.workspaceDir, fs.realpathSync(first));
  assert.equal(switched.approvedFolders.length, 2);

  const removed = store.removeWorkspace(first, validationOptions);
  assert.equal(removed.isDefault, true);
  assert.equal(removed.approvedFolders.length, 1);
});

test('unapproved and dangerous folders cannot become active', () => {
  const unapproved = path.join(homeDir, 'Unapproved');
  fs.mkdirSync(unapproved);

  assert.throws(() => store.setWorkspace(), {
    code: 'WORKSPACE_INVALID_PATH',
  });
  assert.throws(() => store.removeWorkspace(''), {
    code: 'WORKSPACE_INVALID_PATH',
  });
  assert.throws(() => store.setWorkspace(unapproved), {
    code: 'WORKSPACE_NOT_APPROVED',
  });
  assert.throws(() => store.approveWorkspace(homeDir), {
    code: 'WORKSPACE_DANGEROUS_HOME',
  });
});
