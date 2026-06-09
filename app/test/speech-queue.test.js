'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SpeechQueueController } = require('../src/audio/speech-queue');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('reset cancels active playback and releases waitForDrain', async () => {
  const playbackDone = deferred();
  let cancelled = false;
  const queue = new SpeechQueueController({
    synthesize: async () => 'audio',
    createPlayback: () => ({
      promise: playbackDone.promise,
      cancel() {
        cancelled = true;
        playbackDone.resolve();
      },
    }),
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
  });

  const generation = queue.generation;
  queue.enqueue('first');
  await new Promise((resolve) => setImmediate(resolve));
  const draining = queue.waitForDrain(generation);
  queue.reset();

  assert.equal(await draining, false);
  assert.equal(cancelled, true);
  assert.equal(queue.busy(), false);
});

test('late synthesis results cannot restart playback after reset', async () => {
  const synthesis = deferred();
  let playbackCount = 0;
  const queue = new SpeechQueueController({
    synthesize: () => synthesis.promise,
    createPlayback: () => {
      playbackCount += 1;
      return { promise: Promise.resolve(), cancel() {} };
    },
  });

  queue.enqueue('late sentence');
  await new Promise((resolve) => setImmediate(resolve));
  queue.reset();
  synthesis.resolve('audio');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(playbackCount, 0);
  assert.equal(queue.busy(), false);
});

test('new generation can play after an interrupted generation finishes late', async () => {
  const firstSynthesis = deferred();
  const played = [];
  const queue = new SpeechQueueController({
    synthesize: (text) => text === 'old' ? firstSynthesis.promise : Promise.resolve(text),
    createPlayback: (audio) => {
      played.push(audio);
      return { promise: Promise.resolve(), cancel() {} };
    },
  });

  queue.enqueue('old');
  await new Promise((resolve) => setImmediate(resolve));
  queue.reset();
  queue.enqueue('new');
  firstSynthesis.resolve('old');
  await queue.waitForDrain();

  assert.deepEqual(played, ['new']);
});
