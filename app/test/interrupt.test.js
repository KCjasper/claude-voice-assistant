'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskRegistry } = require('../src/tasks/cancellation');
const { interruptRuntime, isInterruptInput } = require('../src/tasks/interrupt');

test('recognizes Ctrl+Q and Command+Q keydown input', () => {
  assert.equal(isInterruptInput({ type: 'keyDown', key: 'q', control: true }), true);
  assert.equal(isInterruptInput({ type: 'keyDown', key: 'Q', meta: true }), true);
  assert.equal(isInterruptInput({ type: 'keyUp', key: 'q', control: true }), false);
  assert.equal(isInterruptInput({ type: 'keyDown', key: 'q', control: true, alt: true }), false);
  assert.equal(isInterruptInput({ type: 'keyDown', key: 'k', control: true }), false);
});

test('interrupt cancels backend tasks and notifies every live window', () => {
  const registry = new TaskRegistry();
  const ai = registry.start('ai');
  const tts = registry.start('tts');
  const stt = registry.start('stt');
  const messages = [];
  const liveWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel) => messages.push(channel) },
  };
  const destroyedWindow = {
    isDestroyed: () => true,
    webContents: { send: () => messages.push('destroyed') },
  };

  const result = interruptRuntime({
    taskRegistry: registry,
    windows: [liveWindow, destroyedWindow],
  });

  assert.equal(ai.signal.aborted, true);
  assert.equal(tts.signal.aborted, true);
  assert.equal(stt.signal.aborted, true);
  assert.equal(result.count, 3);
  assert.equal(result.notifiedWindows, 1);
  assert.deepEqual(messages, ['playback:stop']);
});
