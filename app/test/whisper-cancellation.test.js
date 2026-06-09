'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const cancellation = require('../src/tasks/cancellation');

const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => process.cwd() } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { runWhisper } = require('../src/stt/whisper');
Module._load = originalLoad;

test('cancelling Whisper kills the active child process', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  const controller = new AbortController();
  const pending = runWhisper(
    'whisper.exe',
    'model.bin',
    'recording.wav',
    {
      language: 'en',
      timeoutMs: 60_000,
      signal: controller.signal,
      spawnImpl: () => child,
    }
  );

  controller.abort(cancellation.createAbortError());
  await assert.rejects(pending, (error) => cancellation.isAbortError(error));
  assert.equal(child.killed, true);
});
