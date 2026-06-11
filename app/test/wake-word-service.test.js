'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  WakeWordService,
  normalizeConfig,
} = require('../src/wake-word/wake-word-service');
const {
  ACCESS_KEY_SECRET,
  registerWakeWordIpc,
  sanitizeConfig,
} = require('../src/wake-word/wake-word-ipc');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const reads = [];
  const states = [];
  const detections = [];
  const keywordPath = path.resolve('hey-claude.ppn');
  const recorder = {
    sampleRate: 16000,
    started: 0,
    stopped: 0,
    released: 0,
    start() { this.started += 1; },
    stop() { this.stopped += 1; },
    release() { this.released += 1; },
    getSelectedDevice: () => 'Test microphone',
    read() {
      const next = deferred();
      reads.push(next);
      return next.promise;
    },
  };
  const engine = {
    frameLength: 512,
    sampleRate: 16000,
    released: 0,
    process: overrides.process || (() => -1),
    release() { this.released += 1; },
  };
  const config = {
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.65,
    wakeWordDeviceIndex: 2,
    wakeWordKeywordPath: keywordPath,
  };
  const service = new WakeWordService({
    getConfig: () => config,
    getAccessKey: () => overrides.accessKey === undefined ? 'access-key' : overrides.accessKey,
    createEngineImpl: overrides.createEngine || (() => engine),
    createRecorderImpl: overrides.createRecorder || (() => recorder),
    listDevicesImpl: overrides.listDevices || (() => ['Default', 'USB mic']),
    fsImpl: { existsSync: () => overrides.keywordExists !== false },
    onState: (state) => states.push(state),
    onWake: (detection) => detections.push(detection),
  });
  return { config, detections, engine, keywordPath, reads, recorder, service, states };
}

test('normalizes wake-word preferences and validates config patches', () => {
  assert.deepEqual(normalizeConfig({
    wakeWordEnabled: true,
    wakeWordSensitivity: 4,
    wakeWordDeviceIndex: -2,
  }), {
    enabled: true,
    sensitivity: 1,
    deviceIndex: -1,
    keywordPath: '',
    modelPath: '',
  });
  assert.deepEqual(sanitizeConfig({
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.4,
    ignored: 'value',
  }), {
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.4,
  });
  assert.throws(
    () => sanitizeConfig({ wakeWordKeywordPath: 'relative.ppn' }),
    /absolute .ppn/
  );
});

test('falls back to push-to-talk when required offline configuration is missing', () => {
  const ctx = setup({ accessKey: null });
  const state = ctx.service.configure(ctx.config);

  assert.equal(state.status, 'fallback');
  assert.equal(state.code, 'WAKE_ACCESS_KEY_MISSING');
  assert.equal(state.fallback, 'push-to-talk');
  assert.equal(state.localOnly, true);
});

test('captures local frames, emits detection and pauses until the interaction is idle', async () => {
  let detected = false;
  const ctx = setup({
    process: () => {
      if (detected) return -1;
      detected = true;
      return 0;
    },
  });

  const state = ctx.service.configure(ctx.config);
  assert.equal(state.status, 'listening');
  assert.equal(ctx.recorder.started, 1);
  assert.equal(ctx.service.listDevices().devices[1].name, 'USB mic');

  ctx.reads[0].resolve(new Int16Array(512));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ctx.detections.length, 1);
  assert.equal(ctx.detections[0].keyword, 'hey-claude');
  assert.equal(ctx.service.state().status, 'paused');
  assert.equal(ctx.recorder.stopped, 1);

  ctx.service.setActivity('listening');
  assert.equal(ctx.service.state().status, 'paused');
  ctx.service.setActivity('idle');
  assert.equal(ctx.service.state().status, 'listening');
  assert.equal(ctx.recorder.started, 2);
});

test('capture and initialization errors release native resources and preserve PTT fallback', async () => {
  const init = setup({
    createRecorder: () => {
      throw new Error('microphone denied');
    },
  });
  const initState = init.service.configure(init.config);
  assert.equal(initState.status, 'fallback');
  assert.match(initState.error, /microphone denied/);
  assert.equal(init.engine.released, 1);

  const capture = setup();
  capture.service.configure(capture.config);
  capture.reads[0].reject(new Error('device disconnected'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capture.service.state().status, 'fallback');
  assert.equal(capture.service.state().code, 'WAKE_CAPTURE_FAILED');
  assert.equal(capture.recorder.released, 1);
  assert.equal(capture.engine.released, 1);
});

test('IPC stores the AccessKey only through the secret store and reconfigures the service', async () => {
  const handlers = new Map();
  const savedSecrets = [];
  const savedPrefs = [];
  const service = {
    state: () => ({ status: 'disabled' }),
    listDevices: () => ({ ok: true, devices: [] }),
    configure: (prefs) => ({ status: prefs.wakeWordEnabled ? 'listening' : 'disabled' }),
  };
  const store = {
    prefs: { wakeWordEnabled: false },
    hasSecret: () => savedSecrets.length > 0,
    saveSecret: (name, value) => savedSecrets.push([name, value]),
    clearSecret: () => savedSecrets.splice(0),
    loadPrefs() { return this.prefs; },
    savePrefs(partial) {
      savedPrefs.push(partial);
      this.prefs = { ...this.prefs, ...partial };
      return this.prefs;
    },
  };
  registerWakeWordIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    store,
    service,
  });

  const keyResult = await handlers.get('wake-word:set-access-key')({}, 'encrypted-me');
  assert.equal(keyResult.ok, true);
  assert.deepEqual(savedSecrets, [[ACCESS_KEY_SECRET, 'encrypted-me']]);
  assert.deepEqual(savedPrefs, []);

  const configResult = await handlers.get('wake-word:set-config')({}, {
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.7,
    ignored: 'value',
  });
  assert.equal(configResult.status, 'listening');
  assert.deepEqual(savedPrefs, [{
    wakeWordEnabled: true,
    wakeWordSensitivity: 0.7,
  }]);
});
