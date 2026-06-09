'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/usage/ledger');
const policy = require('../src/usage/policy');

const NOW = new Date(2026, 5, 9);

test('blocks requests once the monthly cap is reached', () => {
  const usage = ledger.recordUsage(null, { cost: 5 }, NOW);
  const result = policy.evaluateRequest({
    usage,
    monthlyCapUsd: 5,
    model: 'claude-sonnet-4-6',
    date: NOW,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'MONTHLY_CAP_REACHED');
});

test('blocks unknown-price models while a spending cap is enabled', () => {
  const result = policy.evaluateRequest({
    usage: null,
    monthlyCapUsd: 5,
    model: 'custom-model',
    date: NOW,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.code, 'MODEL_PRICE_UNKNOWN');
});

test('allows unknown-price models when the spending cap is disabled', () => {
  const result = policy.evaluateRequest({
    usage: null,
    monthlyCapUsd: 0,
    model: 'custom-model',
    date: NOW,
  });

  assert.equal(result.allowed, true);
});
