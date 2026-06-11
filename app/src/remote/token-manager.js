'use strict';

const crypto = require('crypto');

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class RemoteTokenManager {
  constructor({
    pairingTtlMs = 10 * 60 * 1000,
    sessionTtlMs = 24 * 60 * 60 * 1000,
    maxSessions = 5,
    now = () => Date.now(),
    tokenFactory = token,
  } = {}) {
    this.pairingTtlMs = pairingTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.tokenFactory = tokenFactory;
    this.sessions = new Map();
    this.rotate();
  }

  prune() {
    const now = this.now();
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(hash);
    }
    while (this.sessions.size > this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value);
    }
  }

  rotate({ revokeSessions = true } = {}) {
    if (revokeSessions) this.sessions.clear();
    const createdAt = this.now();
    this.pairing = {
      value: this.tokenFactory(24),
      createdAt,
      expiresAt: createdAt + this.pairingTtlMs,
      consumed: false,
    };
    return this.status();
  }

  status() {
    this.prune();
    return {
      pairingToken: this.pairing.value,
      pairingCreatedAt: this.pairing.createdAt,
      pairingExpiresAt: this.pairing.expiresAt,
      pairingConsumed: this.pairing.consumed,
      activeSessions: this.sessions.size,
    };
  }

  authenticate({ pairingToken, sessionToken } = {}) {
    this.prune();
    const now = this.now();
    if (sessionToken) {
      const session = this.sessions.get(digest(sessionToken));
      if (session && session.expiresAt > now) {
        return { ok: true, paired: false, sessionExpiresAt: session.expiresAt };
      }
    }
    if (
      pairingToken
      && !this.pairing.consumed
      && this.pairing.expiresAt > now
      && safeEqual(pairingToken, this.pairing.value)
    ) {
      this.pairing.consumed = true;
      const value = this.tokenFactory(32);
      const expiresAt = now + this.sessionTtlMs;
      this.sessions.set(digest(value), { createdAt: now, expiresAt });
      this.prune();
      return {
        ok: true,
        paired: true,
        sessionToken: value,
        sessionExpiresAt: expiresAt,
      };
    }
    return { ok: false, code: 'REMOTE_UNAUTHORIZED' };
  }

  revokeAll() {
    this.sessions.clear();
    this.pairing.consumed = true;
  }
}

module.exports = {
  RemoteTokenManager,
  digest,
  safeEqual,
  token,
};
