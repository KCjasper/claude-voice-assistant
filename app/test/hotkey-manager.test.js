'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HotkeyManager,
  registerHotkeyIpc,
  savePreferencesWithHotkey,
} = require('../src/config/hotkey-manager');

function setup({ conflicts = [] } = {}) {
  const callbacks = new Map();
  const unregisters = [];
  const messages = [];
  const globalShortcut = {
    register: (accelerator, callback) => {
      if (conflicts.includes(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      unregisters.push(accelerator);
      callbacks.delete(accelerator);
    },
  };
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => messages.push({ channel, payload }),
    },
  };
  let triggers = 0;
  const manager = new HotkeyManager({
    globalShortcut,
    getWindows: () => [window],
    onTrigger: () => { triggers += 1; },
  });
  return {
    callbacks,
    manager,
    messages,
    unregisters,
    triggerCount: () => triggers,
  };
}

test('registers the configured accelerator and broadcasts authoritative state', () => {
  const ctx = setup();
  const result = ctx.manager.setAccelerator('Control+Space');

  assert.deepEqual(result, {
    ok: true,
    accelerator: 'Control+Space',
    registered: true,
    error: null,
  });
  ctx.callbacks.get('Control+Space')();
  assert.equal(ctx.triggerCount(), 1);
  assert.deepEqual(ctx.messages, [{
    channel: 'hotkey:changed',
    payload: {
      accelerator: 'Control+Space',
      registered: true,
      error: null,
    },
  }]);
});

test('keeps the previous shortcut when a replacement conflicts', () => {
  const ctx = setup({ conflicts: ['Alt+Space'] });
  ctx.manager.setAccelerator('Control+Space');

  const result = ctx.manager.setAccelerator('Alt+Space');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HOTKEY_REGISTRATION_FAILED');
  assert.match(result.error, /unavailable|already in use/);
  assert.equal(result.accelerator, 'Control+Space');
  assert.equal(result.registered, true);
  assert.deepEqual(ctx.unregisters, []);
  assert.equal(ctx.callbacks.has('Control+Space'), true);
});

test('unregisters the previous shortcut only after replacement succeeds', () => {
  const ctx = setup();
  ctx.manager.setAccelerator('Control+Space');
  const result = ctx.manager.setAccelerator('Control+Shift+Space');

  assert.equal(result.ok, true);
  assert.deepEqual(ctx.unregisters, ['Control+Space']);
  assert.equal(ctx.callbacks.has('Control+Space'), false);
  assert.equal(ctx.callbacks.has('Control+Shift+Space'), true);
});

test('IPC persists only successful registrations and exposes current state', async () => {
  const ctx = setup({ conflicts: ['Alt+Space'] });
  const handlers = new Map();
  const saved = [];
  registerHotkeyIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    manager: ctx.manager,
    store: {
      savePrefs: (prefs) => saved.push(prefs),
    },
  });

  assert.deepEqual(await handlers.get('hotkey:get')(), {
    ok: true,
    accelerator: '',
    registered: false,
    error: null,
  });
  assert.equal((await handlers.get('hotkey:set')({}, 'Alt+Space')).ok, false);
  assert.deepEqual(saved, []);

  assert.equal((await handlers.get('hotkey:set')({}, 'Control+Space')).ok, true);
  assert.deepEqual(saved, [{ pttHotkey: 'Control+Space' }]);
});

test('preference changes persist only after the new shortcut registers', () => {
  const ctx = setup({ conflicts: ['Alt+Space'] });
  ctx.manager.setAccelerator('Control+Space');
  const saved = [];
  const store = {
    savePrefs: (partial) => {
      saved.push(partial);
      return partial;
    },
  };

  const failed = savePreferencesWithHotkey({
    partial: { pttHotkey: 'Alt+Space', monthlyCapUsd: 25 },
    manager: ctx.manager,
    store,
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(saved, []);

  const result = savePreferencesWithHotkey({
    partial: { pttHotkey: 'Control+Shift+Space', monthlyCapUsd: 25 },
    manager: ctx.manager,
    store,
  });
  assert.deepEqual(result, {
    pttHotkey: 'Control+Shift+Space',
    monthlyCapUsd: 25,
  });
  assert.deepEqual(saved, [{
    pttHotkey: 'Control+Shift+Space',
    monthlyCapUsd: 25,
  }]);
});
