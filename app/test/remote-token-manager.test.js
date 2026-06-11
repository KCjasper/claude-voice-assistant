'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteTokenManager } = require('../src/remote/token-manager');

test('pairing tokens are one-time and issue reconnectable session tokens', () => {
  let now = 1000;
  let sequence = 0;
  const manager = new RemoteTokenManager({
    now: () => now,
    tokenFactory: () => `token-${++sequence}`,
    pairingTtlMs: 100,
    sessionTtlMs: 500,
  });
  const pairingToken = manager.status().pairingToken;
  const paired = manager.authenticate({ pairingToken });

  assert.equal(paired.ok, true);
  assert.equal(paired.paired, true);
  assert.equal(manager.authenticate({ pairingToken }).ok, false);
  assert.equal(manager.authenticate({ sessionToken: paired.sessionToken }).ok, true);

  now = 2000;
  assert.equal(manager.authenticate({ sessionToken: paired.sessionToken }).ok, false);
});

test('rotating pairing tokens revokes active sessions', () => {
  let sequence = 0;
  const manager = new RemoteTokenManager({
    tokenFactory: () => `token-${++sequence}`,
  });
  const paired = manager.authenticate({ pairingToken: manager.status().pairingToken });
  manager.rotate();

  assert.equal(manager.authenticate({ sessionToken: paired.sessionToken }).ok, false);
  assert.equal(manager.status().pairingConsumed, false);
});
