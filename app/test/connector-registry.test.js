'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfirmationStore } = require('../src/connectors/confirmation-store');
const { ConnectorRegistry } = require('../src/connectors/registry');

function setup() {
  let now = 1000;
  let configured = true;
  let writes = 0;
  const records = [];
  const connector = {
    id: 'demo',
    name: 'Demo',
    secretName: 'connector-demo-token',
    tools: [
      {
        name: 'demo_read',
        risk: 'read',
        description: 'Read',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true, value: 'read' }),
      },
      {
        name: 'demo_write',
        risk: 'representational-write',
        description: 'Write',
        parameters: { type: 'object', properties: {} },
        summarize: (args) => ({ action: 'Publish', title: args.title }),
        target: (args) => ({ destination: args.destination }),
        execute: async (args) => {
          writes += 1;
          return { ok: true, published: args.title };
        },
      },
    ],
    health: async () => ({ ok: true }),
  };
  const confirmations = new ConfirmationStore({
    now: () => now,
    idFactory: () => 'confirmation-1',
    ttlMs: 500,
  });
  const registry = new ConnectorRegistry({
    connectors: [connector],
    store: {
      hasSecret: () => configured,
      saveSecret: () => {},
      clearSecret: () => { configured = false; },
    },
    confirmations,
    auditLog: { record: (entry) => records.push(entry) },
    now: () => now,
  });
  return {
    records,
    registry,
    setConfigured: (value) => { configured = value; },
    setNow: (value) => { now = value; },
    writes: () => writes,
  };
}

test('read connector tools execute directly with audit metadata', async () => {
  const ctx = setup();
  const result = await ctx.registry.execute('demo_read', {}, { requestId: 'request-1' });

  assert.deepEqual(result, { ok: true, value: 'read' });
  assert.equal(ctx.records[0].status, 'completed');
  assert.equal(ctx.records[0].requestId, 'request-1');
});

test('representational writes require one-time confirmation and deduplicate retries', async () => {
  const ctx = setup();
  const first = await ctx.registry.execute('demo_write', {
    title: 'Launch',
    destination: 'workspace',
  }, { requestId: 'request-2' });
  const second = await ctx.registry.execute('demo_write', {
    destination: 'workspace',
    title: 'Launch',
  }, { requestId: 'request-2' });

  assert.equal(first.code, 'CONFIRMATION_REQUIRED');
  assert.equal(second.confirmation.id, first.confirmation.id);
  assert.equal(ctx.writes(), 0);
  assert.equal(ctx.registry.pendingConfirmations().length, 1);

  const approved = await ctx.registry.approve(first.confirmation.id);
  assert.deepEqual(approved, { ok: true, published: 'Launch' });
  assert.equal(ctx.writes(), 1);
  assert.equal((await ctx.registry.approve(first.confirmation.id)).code, 'CONFIRMATION_EXPIRED');
});

test('expired confirmations cannot execute and missing credentials fail closed', async () => {
  const ctx = setup();
  const pending = await ctx.registry.execute('demo_write', { title: 'Old' });
  ctx.setNow(2000);

  assert.equal((await ctx.registry.approve(pending.confirmation.id)).code, 'CONFIRMATION_EXPIRED');
  assert.equal(ctx.writes(), 0);

  ctx.setConfigured(false);
  assert.equal((await ctx.registry.execute('demo_read', {})).code, 'CONNECTOR_NOT_CONFIGURED');
});

test('confirmation snapshots arguments and rechecks credentials before approval', async () => {
  const ctx = setup();
  const args = { title: 'Original', destination: 'workspace' };
  const pending = await ctx.registry.execute('demo_write', args);
  args.title = 'Mutated';
  assert.equal((await ctx.registry.approve(pending.confirmation.id)).published, 'Original');

  const disconnected = setup();
  const blocked = await disconnected.registry.execute('demo_write', {
    title: 'Blocked',
    destination: 'workspace',
  });
  disconnected.setConfigured(false);

  assert.equal(
    (await disconnected.registry.approve(blocked.confirmation.id)).code,
    'CONNECTOR_NOT_CONFIGURED'
  );
  assert.equal(disconnected.writes(), 0);
});
