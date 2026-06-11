'use strict';

const crypto = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

class ConfirmationStore {
  constructor({
    ttlMs = 5 * 60 * 1000,
    maxPending = 50,
    now = () => Date.now(),
    idFactory = () => crypto.randomUUID(),
  } = {}) {
    this.ttlMs = ttlMs;
    this.maxPending = maxPending;
    this.now = now;
    this.idFactory = idFactory;
    this.pending = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, item] of this.pending) {
      if (item.expiresAt <= now) this.pending.delete(id);
    }
    while (this.pending.size > this.maxPending) {
      this.pending.delete(this.pending.keys().next().value);
    }
  }

  request({ connectorId, toolName, args, summary, requestId = null }) {
    this.prune();
    const safeArgs = canonicalize(args);
    const digest = fingerprint({ connectorId, toolName, args: safeArgs });
    for (const item of this.pending.values()) {
      if (item.fingerprint === digest) return this.publicItem(item);
    }
    const createdAt = this.now();
    const item = {
      id: this.idFactory(),
      connectorId,
      toolName,
      args: safeArgs,
      summary,
      requestId,
      fingerprint: digest,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.pending.set(item.id, item);
    this.prune();
    return this.publicItem(item);
  }

  publicItem(item) {
    return {
      id: item.id,
      connectorId: item.connectorId,
      toolName: item.toolName,
      summary: item.summary,
      requestId: item.requestId,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    };
  }

  list() {
    this.prune();
    return [...this.pending.values()].map((item) => this.publicItem(item));
  }

  take(id) {
    this.prune();
    const item = this.pending.get(id);
    if (!item) return null;
    this.pending.delete(id);
    return item;
  }
}

module.exports = {
  ConfirmationStore,
  canonicalize,
  fingerprint,
};
