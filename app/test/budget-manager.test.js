'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BudgetManager } = require('../src/usage/budget-manager');
const ledger = require('../src/usage/ledger');

const NOW = new Date(2026, 5, 11);

test('concurrent reservations cannot exceed the remaining monthly cap', () => {
  let nextId = 0;
  const manager = new BudgetManager({ idFactory: () => `r${++nextId}` });
  const usage = ledger.recordUsage(null, { cost: 2 }, NOW);

  const first = manager.reserve({
    usage,
    monthlyCapUsd: 5,
    requestedUsd: 2,
    provider: 'ai',
    date: NOW,
  });
  const blocked = manager.reserve({
    usage,
    monthlyCapUsd: 5,
    requestedUsd: 2,
    provider: 'elevenlabs',
    date: NOW,
  });
  const partial = manager.reserve({
    usage,
    monthlyCapUsd: 5,
    requestedUsd: 2,
    provider: 'ai',
    allowPartial: true,
    date: NOW,
  });

  assert.equal(first.amountUsd, 2);
  assert.equal(blocked.code, 'MONTHLY_CAP_WOULD_BE_EXCEEDED');
  assert.equal(partial.amountUsd, 1);
  assert.equal(manager.reservedUsd(), 3);
});

test('failed or cancelled work can release reservations without recording cost', () => {
  const manager = new BudgetManager({ idFactory: () => 'reservation' });
  const reservation = manager.reserve({
    usage: null,
    monthlyCapUsd: 5,
    requestedUsd: 1,
    provider: 'ai',
    date: NOW,
  });

  assert.equal(manager.reservedUsd(), 1);
  assert.deepEqual(manager.release(reservation.id), {
    amountUsd: 1,
    provider: 'ai',
  });
  assert.equal(manager.reservedUsd(), 0);
  assert.equal(manager.release(reservation.id), null);
});
