'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TaskRegistry,
  createAbortError,
  isAbortError,
  throwIfAborted,
  timeoutSignal,
} = require('../src/tasks/cancellation');

test('registry assigns request IDs and cancels tasks by type', () => {
  const states = [];
  const registry = new TaskRegistry({ onState: (state) => states.push(state) });
  const ai = registry.start('ai');
  const tts = registry.start('tts');

  assert.notEqual(ai.id, tts.id);
  assert.deepEqual(registry.cancel({ type: 'ai' }), [ai.id]);
  assert.equal(ai.signal.aborted, true);
  assert.equal(tts.signal.aborted, false);
  assert.equal(isAbortError(ai.signal.reason), true);

  registry.finish(ai.id, 'cancelled');
  registry.finish(tts.id);
  assert.deepEqual(states.map((state) => state.status), [
    'running',
    'running',
    'cancel-requested',
    'cancelled',
    'completed',
  ]);
});

test('throwIfAborted preserves the cancellation error', () => {
  const controller = new AbortController();
  const reason = createAbortError('stop');
  controller.abort(reason);

  assert.throws(() => throwIfAborted(controller.signal), (error) => error === reason);
});

test('timeout signal distinguishes timeout from parent cancellation', async () => {
  const parent = new AbortController();
  const linked = timeoutSignal(parent.signal, 1000);
  parent.abort(createAbortError());

  assert.equal(linked.signal.aborted, true);
  assert.equal(linked.timedOut(), false);
  assert.equal(isAbortError(linked.signal.reason), true);
  linked.cleanup();

  const timed = timeoutSignal(null, 5);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timed.signal.aborted, true);
  assert.equal(timed.timedOut(), true);
  assert.equal(timed.signal.reason.code, 'TIMEOUT');
  timed.cleanup();
});
