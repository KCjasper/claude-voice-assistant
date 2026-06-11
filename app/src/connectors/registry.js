'use strict';

const { ConfirmationStore } = require('./confirmation-store');
const cancellation = require('../tasks/cancellation');

class ConnectorRegistry {
  constructor({
    connectors,
    store,
    auditLog,
    confirmations = new ConfirmationStore(),
    now = () => Date.now(),
    onEvent = () => {},
  }) {
    this.store = store;
    this.auditLog = auditLog;
    this.confirmations = confirmations;
    this.now = now;
    this.onEvent = onEvent;
    this.connectors = new Map();
    this.tools = new Map();
    for (const connector of connectors) {
      this.connectors.set(connector.id, connector);
      for (const tool of connector.tools) {
        if (this.tools.has(tool.name)) throw new Error(`Duplicate connector tool: ${tool.name}`);
        this.tools.set(tool.name, { connector, tool });
      }
    }
  }

  setEventSink(onEvent) {
    this.onEvent = onEvent || (() => {});
  }

  emit(event) {
    try { this.onEvent(event); } catch {}
  }

  schema() {
    return [...this.tools.values()].map(({ tool }) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  connectorState(connector) {
    return {
      id: connector.id,
      name: connector.name,
      configured: this.store.hasSecret(connector.secretName),
      tools: connector.tools.map((tool) => ({
        name: tool.name,
        risk: tool.risk,
      })),
    };
  }

  list() {
    return [...this.connectors.values()].map((connector) => this.connectorState(connector));
  }

  setCredential(connectorId, credential) {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return { ok: false, code: 'CONNECTOR_UNKNOWN', error: `Unknown connector: ${connectorId}` };
    }
    const value = typeof credential === 'string' ? credential.trim() : '';
    if (!value || value.length > 4096) {
      return { ok: false, code: 'CONNECTOR_CREDENTIAL_INVALID', error: 'A valid connector credential is required.' };
    }
    this.store.saveSecret(connector.secretName, value);
    const state = this.connectorState(connector);
    this.emit({ type: 'credential-changed', connector: state });
    return { ok: true, connector: state };
  }

  clearCredential(connectorId) {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return { ok: false, code: 'CONNECTOR_UNKNOWN', error: `Unknown connector: ${connectorId}` };
    }
    this.store.clearSecret(connector.secretName);
    const state = this.connectorState(connector);
    this.emit({ type: 'credential-changed', connector: state });
    return { ok: true, connector: state };
  }

  async health(connectorId, opts = {}) {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return { ok: false, code: 'CONNECTOR_UNKNOWN', error: `Unknown connector: ${connectorId}` };
    }
    const startedAt = this.now();
    try {
      const result = await connector.health(opts);
      this.auditLog.record({
        connectorId,
        action: 'health',
        status: result.ok ? 'completed' : 'failed',
        durationMs: this.now() - startedAt,
        code: result.code,
      });
      return result;
    } catch (error) {
      const cancelled = cancellation.isAbortError(error) || opts.signal?.aborted;
      this.auditLog.record({
        connectorId,
        action: 'health',
        status: cancelled ? 'cancelled' : 'failed',
        durationMs: this.now() - startedAt,
        code: cancelled ? 'CANCELLED' : 'CONNECTOR_HEALTH_FAILED',
      });
      if (cancelled) throw error;
      return {
        ok: false,
        code: 'CONNECTOR_HEALTH_FAILED',
        error: error.message || 'Connector health check failed.',
      };
    }
  }

  async execute(name, args, opts = {}) {
    cancellation.throwIfAborted(opts.signal);
    const entry = this.tools.get(name);
    if (!entry) {
      return { ok: false, code: 'CONNECTOR_TOOL_UNKNOWN', error: `Unknown connector tool: ${name}` };
    }
    const { connector, tool } = entry;
    if (!this.store.hasSecret(connector.secretName)) {
      return { ok: false, code: 'CONNECTOR_NOT_CONFIGURED', error: `${connector.name} is not connected.` };
    }
    if (tool.risk === 'representational-write') {
      const pending = this.confirmations.request({
        connectorId: connector.id,
        toolName: tool.name,
        args,
        summary: tool.summarize(args),
        requestId: opts.requestId,
      });
      this.auditLog.record({
        connectorId: connector.id,
        toolName: tool.name,
        action: 'confirmation',
        status: 'required',
        requestId: opts.requestId,
        confirmationId: pending.id,
        target: tool.target?.(args),
      });
      this.emit({ type: 'confirmation-required', confirmation: pending });
      return {
        ok: false,
        code: 'CONFIRMATION_REQUIRED',
        error: 'Explicit user confirmation is required before this external write.',
        confirmation: pending,
      };
    }
    return this.run(entry, args, opts);
  }

  async run(entry, args, opts = {}, confirmationId = null) {
    const startedAt = this.now();
    try {
      cancellation.throwIfAborted(opts.signal);
      const result = await entry.tool.execute(args, opts);
      this.auditLog.record({
        connectorId: entry.connector.id,
        toolName: entry.tool.name,
        action: entry.tool.risk,
        status: result.ok ? 'completed' : 'failed',
        requestId: opts.requestId,
        confirmationId,
        durationMs: this.now() - startedAt,
        code: result.code,
        target: entry.tool.target?.(args),
      });
      this.emit({
        type: 'action-completed',
        connectorId: entry.connector.id,
        toolName: entry.tool.name,
        confirmationId,
        result,
      });
      return result;
    } catch (error) {
      const cancelled = cancellation.isAbortError(error) || opts.signal?.aborted;
      const result = {
        ok: false,
        code: cancelled ? 'CANCELLED' : 'CONNECTOR_ACTION_FAILED',
        cancelled,
        error: cancelled ? 'Connector action cancelled.' : (error.message || 'Connector action failed.'),
      };
      this.auditLog.record({
        connectorId: entry.connector.id,
        toolName: entry.tool.name,
        action: entry.tool.risk,
        status: cancelled ? 'cancelled' : 'failed',
        requestId: opts.requestId,
        confirmationId,
        durationMs: this.now() - startedAt,
        code: result.code,
        target: entry.tool.target?.(args),
      });
      this.emit({
        type: 'action-completed',
        connectorId: entry.connector.id,
        toolName: entry.tool.name,
        confirmationId,
        result,
      });
      if (cancelled) throw error;
      return result;
    }
  }

  pendingConfirmations() {
    return this.confirmations.list();
  }

  async approve(confirmationId, opts = {}) {
    const pending = this.confirmations.take(confirmationId);
    if (!pending) {
      return {
        ok: false,
        code: 'CONFIRMATION_EXPIRED',
        error: 'The confirmation is missing, expired, or already used.',
      };
    }
    const entry = this.tools.get(pending.toolName);
    if (!entry || entry.connector.id !== pending.connectorId) {
      return { ok: false, code: 'CONNECTOR_TOOL_UNKNOWN', error: 'The confirmed action is unavailable.' };
    }
    if (!this.store.hasSecret(entry.connector.secretName)) {
      return {
        ok: false,
        code: 'CONNECTOR_NOT_CONFIGURED',
        error: `${entry.connector.name} is no longer connected.`,
      };
    }
    return this.run(entry, pending.args, {
      ...opts,
      requestId: pending.requestId || opts.requestId,
    }, pending.id);
  }

  reject(confirmationId) {
    const pending = this.confirmations.take(confirmationId);
    if (!pending) {
      return {
        ok: false,
        code: 'CONFIRMATION_EXPIRED',
        error: 'The confirmation is missing, expired, or already used.',
      };
    }
    this.auditLog.record({
      connectorId: pending.connectorId,
      toolName: pending.toolName,
      action: 'confirmation',
      status: 'rejected',
      requestId: pending.requestId,
      confirmationId: pending.id,
    });
    this.emit({ type: 'confirmation-rejected', confirmationId: pending.id });
    return { ok: true, confirmationId: pending.id };
  }
}

module.exports = {
  ConnectorRegistry,
};
