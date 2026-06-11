'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/usage/ledger');

test('records usage in daily and monthly buckets without mutating input', () => {
  const original = { days: {}, months: {} };
  const now = new Date(2026, 5, 9, 12);
  const result = ledger.recordUsage(original, {
    cost: 0.25,
    promptTokens: 100,
    completionTokens: 50,
  }, now);

  assert.deepEqual(original, { days: {}, months: {} });
  assert.deepEqual(result.days['2026-06-09'], {
    usd: 0.25,
    prompt: 100,
    completion: 50,
    characters: 0,
    calls: 1,
    providers: {
      ai: { usd: 0.25, calls: 1, characters: 0 },
    },
  });
  assert.deepEqual(result.months['2026-06'], result.days['2026-06-09']);
});

test('uses local calendar keys and rolls over daily totals', () => {
  let usage = ledger.recordUsage(null, { cost: 1 }, new Date(2026, 5, 30, 23, 59));
  usage = ledger.recordUsage(usage, { cost: 2 }, new Date(2026, 6, 1, 0, 1));

  assert.equal(ledger.summary(usage, new Date(2026, 5, 30)).today.usd, 1);
  assert.equal(ledger.summary(usage, new Date(2026, 6, 1)).today.usd, 2);
  assert.equal(ledger.summary(usage, new Date(2026, 6, 1)).month.usd, 2);
});

test('normalizes invalid and negative values to zero', () => {
  const usage = ledger.recordUsage({
    days: { '2026-06-09': { usd: -4, prompt: 'bad', calls: -1 } },
  }, {
    cost: -2,
    promptTokens: Number.NaN,
    completionTokens: 7,
  }, new Date(2026, 5, 9));

  assert.deepEqual(usage.days['2026-06-09'], {
    usd: 0,
    prompt: 0,
    completion: 7,
    characters: 0,
    calls: 1,
    providers: {
      ai: { usd: 0, calls: 1, characters: 0 },
    },
  });
});

test('reports enabled, remaining and reached cap states', () => {
  const now = new Date(2026, 5, 9);
  const usage = ledger.recordUsage(null, { cost: 4.5 }, now);

  assert.deepEqual(ledger.capStatus(usage, 5, now), {
    today: {
      usd: 4.5,
      prompt: 0,
      completion: 0,
      characters: 0,
      calls: 1,
      providers: { ai: { usd: 4.5, calls: 1, characters: 0 } },
    },
    month: {
      usd: 4.5,
      prompt: 0,
      completion: 0,
      characters: 0,
      calls: 1,
      providers: { ai: { usd: 4.5, calls: 1, characters: 0 } },
    },
    capUsd: 5,
    enabled: true,
    overCap: false,
    remainingUsd: 0.5,
  });
  assert.equal(ledger.capStatus(usage, 4, now).overCap, true);
  assert.equal(ledger.capStatus(usage, 0, now).remainingUsd, null);
});

test('records paid TTS characters and provider cost metadata', () => {
  const usage = ledger.recordUsage(null, {
    provider: 'elevenlabs',
    cost: 0.03,
    characters: 100,
  }, new Date(2026, 5, 9));
  const bucket = usage.days['2026-06-09'];

  assert.equal(bucket.usd, 0.03);
  assert.equal(bucket.characters, 100);
  assert.deepEqual(bucket.providers.elevenlabs, {
    usd: 0.03,
    calls: 1,
    characters: 100,
  });
});

test('retains only the newest 90 daily buckets', () => {
  let usage = null;
  for (let day = 1; day <= 100; day += 1) {
    usage = ledger.recordUsage(usage, { cost: 1 }, new Date(2026, 0, day));
  }

  assert.equal(Object.keys(usage.days).length, 90);
  assert.equal(Object.hasOwn(usage.days, '2026-01-01'), false);
});
