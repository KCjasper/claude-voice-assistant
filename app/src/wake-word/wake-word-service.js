'use strict';

const fs = require('fs');
const path = require('path');

const FALLBACK = 'push-to-talk';

function normalizeConfig(config = {}) {
  const sensitivity = Number(config.wakeWordSensitivity);
  const deviceIndex = Number(config.wakeWordDeviceIndex);
  return {
    enabled: config.wakeWordEnabled === true,
    sensitivity: Number.isFinite(sensitivity)
      ? Math.min(1, Math.max(0, sensitivity))
      : 0.55,
    deviceIndex: Number.isInteger(deviceIndex) && deviceIndex >= -1 ? deviceIndex : -1,
    keywordPath: typeof config.wakeWordKeywordPath === 'string'
      ? config.wakeWordKeywordPath.trim()
      : '',
    modelPath: typeof config.wakeWordModelPath === 'string'
      ? config.wakeWordModelPath.trim()
      : '',
  };
}

function createEngine({ accessKey, keywordPath, sensitivity, modelPath }) {
  const { Porcupine } = require('@picovoice/porcupine-node');
  const options = modelPath ? { modelPath } : undefined;
  return new Porcupine(accessKey, [keywordPath], [sensitivity], options);
}

function createRecorder({ frameLength, deviceIndex }) {
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  return new PvRecorder(frameLength, deviceIndex);
}

function listRecorderDevices() {
  const { PvRecorder } = require('@picovoice/pvrecorder-node');
  return PvRecorder.getAvailableDevices();
}

class WakeWordService {
  constructor({
    getConfig,
    getAccessKey,
    onState = () => {},
    onWake = () => {},
    createEngineImpl = createEngine,
    createRecorderImpl = createRecorder,
    listDevicesImpl = listRecorderDevices,
    fsImpl = fs,
  }) {
    this.getConfig = getConfig;
    this.getAccessKey = getAccessKey;
    this.onState = onState;
    this.onWake = onWake;
    this.createEngine = createEngineImpl;
    this.createRecorder = createRecorderImpl;
    this.listDevicesImpl = listDevicesImpl;
    this.fs = fsImpl;
    this.config = normalizeConfig();
    this.engine = null;
    this.recorder = null;
    this.generation = 0;
    this.blockers = new Set();
    this.current = {
      status: 'disabled',
      error: null,
      code: null,
      device: null,
      fallback: FALLBACK,
    };
  }

  state() {
    return {
      enabled: this.config.enabled,
      sensitivity: this.config.sensitivity,
      deviceIndex: this.config.deviceIndex,
      keywordConfigured: Boolean(this.config.keywordPath),
      modelConfigured: Boolean(this.config.modelPath),
      localOnly: true,
      ...this.current,
    };
  }

  emitState(next = {}) {
    this.current = { ...this.current, ...next };
    const state = this.state();
    this.onState(state);
    return state;
  }

  validateConfiguration(accessKey) {
    if (!accessKey) {
      return {
        code: 'WAKE_ACCESS_KEY_MISSING',
        error: 'A Picovoice AccessKey is required to initialize the offline wake-word engine.',
      };
    }
    if (
      !this.config.keywordPath
      || !path.isAbsolute(this.config.keywordPath)
      || path.extname(this.config.keywordPath).toLowerCase() !== '.ppn'
      || !this.fs.existsSync(this.config.keywordPath)
    ) {
      return {
        code: 'WAKE_KEYWORD_MISSING',
        error: 'Select a platform-compatible Hey Claude .ppn keyword file.',
      };
    }
    if (
      this.config.modelPath
      && (
        !path.isAbsolute(this.config.modelPath)
        || path.extname(this.config.modelPath).toLowerCase() !== '.pv'
        || !this.fs.existsSync(this.config.modelPath)
      )
    ) {
      return {
        code: 'WAKE_MODEL_INVALID',
        error: 'The configured Porcupine language model is unavailable.',
      };
    }
    return null;
  }

  configure(config = this.getConfig()) {
    this.releaseResources();
    this.config = normalizeConfig(config);
    if (!this.config.enabled) {
      return this.emitState({
        status: 'disabled',
        error: null,
        code: null,
        device: null,
        fallback: FALLBACK,
      });
    }
    if (this.blockers.size > 0) {
      return this.emitState({
        status: 'paused',
        error: null,
        code: null,
        device: null,
        fallback: FALLBACK,
      });
    }
    return this.start();
  }

  start() {
    if (!this.config.enabled) return this.state();
    const accessKey = this.getAccessKey();
    const invalid = this.validateConfiguration(accessKey);
    if (invalid) return this.fail(invalid.code, invalid.error);

    this.emitState({
      status: 'starting',
      error: null,
      code: null,
      device: null,
      fallback: FALLBACK,
    });
    try {
      const engine = this.createEngine({
        accessKey,
        keywordPath: this.config.keywordPath,
        sensitivity: this.config.sensitivity,
        modelPath: this.config.modelPath,
      });
      this.engine = engine;
      const recorder = this.createRecorder({
        frameLength: engine.frameLength,
        deviceIndex: this.config.deviceIndex,
      });
      this.recorder = recorder;
      if (Number(recorder.sampleRate) !== Number(engine.sampleRate)) {
        throw new Error(
          `Microphone sample rate ${recorder.sampleRate} does not match Porcupine ${engine.sampleRate}.`
        );
      }
      recorder.start();
      const state = this.emitState({
        status: 'listening',
        error: null,
        code: null,
        device: recorder.getSelectedDevice?.() || null,
        fallback: FALLBACK,
      });
      this.runCaptureLoop();
      return state;
    } catch (error) {
      return this.fail('WAKE_INITIALIZATION_FAILED', error.message);
    }
  }

  runCaptureLoop() {
    const generation = ++this.generation;
    const recorder = this.recorder;
    const engine = this.engine;
    void (async () => {
      while (
        generation === this.generation
        && this.current.status === 'listening'
        && recorder === this.recorder
        && engine === this.engine
      ) {
        try {
          const frame = await recorder.read();
          if (generation !== this.generation) return;
          if (engine.process(frame) < 0) continue;
          this.pause('wake-trigger');
          this.onWake({ keyword: 'hey-claude', detectedAt: Date.now() });
          return;
        } catch (error) {
          if (generation !== this.generation) return;
          this.fail('WAKE_CAPTURE_FAILED', error.message);
          return;
        }
      }
    })();
  }

  pause(reason) {
    if (reason) this.blockers.add(reason);
    if (this.current.status !== 'listening' && this.current.status !== 'starting') {
      return this.state();
    }
    this.generation += 1;
    try { this.recorder?.stop(); } catch {}
    return this.emitState({
      status: 'paused',
      error: null,
      code: null,
      fallback: FALLBACK,
    });
  }

  resume(reason) {
    if (reason) this.blockers.delete(reason);
    if (
      !this.config.enabled
      || this.blockers.size > 0
      || this.current.status !== 'paused'
    ) {
      return this.state();
    }
    if (!this.engine || !this.recorder) return this.start();
    try {
      this.recorder.start();
      const state = this.emitState({
        status: 'listening',
        error: null,
        code: null,
        fallback: FALLBACK,
      });
      this.runCaptureLoop();
      return state;
    } catch (error) {
      return this.fail('WAKE_RESUME_FAILED', error.message);
    }
  }

  setActivity(state) {
    if (state === 'idle') {
      this.blockers.delete('interaction');
      this.blockers.delete('wake-trigger');
      return this.resume();
    }
    this.blockers.add('interaction');
    return this.pause();
  }

  listDevices() {
    try {
      const devices = this.listDevicesImpl();
      return {
        ok: true,
        devices: devices.map((name, index) => ({ index, name })),
      };
    } catch (error) {
      return {
        ok: false,
        code: 'WAKE_DEVICE_LIST_FAILED',
        error: error.message,
        devices: [],
      };
    }
  }

  fail(code, error) {
    this.releaseResources();
    return this.emitState({
      status: 'fallback',
      code,
      error,
      device: null,
      fallback: FALLBACK,
    });
  }

  releaseResources() {
    this.generation += 1;
    const recorder = this.recorder;
    const engine = this.engine;
    this.recorder = null;
    this.engine = null;
    try { recorder?.stop(); } catch {}
    try { recorder?.release(); } catch {}
    try { engine?.release(); } catch {}
  }

  stop() {
    this.config = { ...this.config, enabled: false };
    this.blockers.clear();
    this.releaseResources();
    return this.emitState({
      status: 'disabled',
      error: null,
      code: null,
      device: null,
      fallback: FALLBACK,
    });
  }
}

module.exports = {
  FALLBACK,
  WakeWordService,
  normalizeConfig,
};
