'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-store-'));
const originalLoad = Module._load;

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => configDir },
      safeStorage: { isEncryptionAvailable: () => false },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const store = require('../src/config/store');
Module._load = originalLoad;

test.after(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

test('normal preference saves cannot overwrite backend usage', () => {
  store.saveUsage({
    days: { '2026-06-09': { usd: 1, prompt: 10, completion: 5, calls: 1 } },
    months: {},
  });

  store.savePrefs({
    monthlyCapUsd: 25,
    usage: { days: {}, months: {} },
  });

  const prefs = store.loadPrefs();
  assert.equal(prefs.monthlyCapUsd, 25);
  assert.equal(prefs.usage.days['2026-06-09'].usd, 1);
});

test('normal preference saves cannot persist wake-word access keys', () => {
  store.savePrefs({
    wakeWordEnabled: true,
    wakeWordAccessKey: 'plaintext-one',
    picovoiceAccessKey: 'plaintext-two',
  });

  const raw = fs.readFileSync(path.join(configDir, 'prefs.json'), 'utf8');
  assert.doesNotMatch(raw, /plaintext-one|plaintext-two/);
  assert.equal(store.loadPrefs().wakeWordEnabled, true);
});

test('usage writes are atomic and leave no temporary file behind', () => {
  store.saveUsage({ days: {}, months: { '2026-06': { usd: 2 } } });

  const files = fs.readdirSync(configDir);
  assert.deepEqual(files, ['prefs.json']);
  assert.equal(store.loadPrefs().usage.months['2026-06'].usd, 2);
});
