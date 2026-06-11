'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../src/ai/pricing');

test('computes model cost from prompt and completion tokens', () => {
  assert.equal(pricing.computeCost('claude-sonnet-4-6', {
    prompt_tokens: 1_000_000,
    completion_tokens: 100_000,
  }), 4.5);
});

test('returns null for models without configured pricing', () => {
  assert.equal(pricing.hasKnownPrice('custom-model'), false);
  assert.equal(pricing.computeCost('custom-model', { prompt_tokens: 100 }), null);
});

test('exposes immutable copies of model pricing for request bounds', () => {
  const price = pricing.getPrice('claude-sonnet-4-6');
  assert.deepEqual(price, { in: 3, out: 15 });
  price.in = 999;
  assert.deepEqual(pricing.getPrice('claude-sonnet-4-6'), { in: 3, out: 15 });
});
