'use strict';

const fs = require('fs');
const path = require('path');

const MAX_AUDIT_BYTES = 2 * 1024 * 1024;

class ConnectorAuditLog {
  constructor({ filePath, fsImpl = fs, now = () => new Date() }) {
    this.filePath = filePath;
    this.fs = fsImpl;
    this.now = now;
  }

  record(entry) {
    try {
      const filePath = this.filePath();
      this.fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (this.fs.existsSync(filePath) && this.fs.statSync(filePath).size > MAX_AUDIT_BYTES) {
        const previous = `${filePath}.previous`;
        try { this.fs.unlinkSync(previous); } catch {}
        this.fs.renameSync(filePath, previous);
      }
      const safeEntry = {
        timestamp: this.now().toISOString(),
        connectorId: entry.connectorId,
        toolName: entry.toolName,
        action: entry.action,
        status: entry.status,
        requestId: entry.requestId || null,
        confirmationId: entry.confirmationId || null,
        durationMs: Number(entry.durationMs) || 0,
        code: entry.code || null,
        target: entry.target || null,
      };
      this.fs.appendFileSync(filePath, `${JSON.stringify(safeEntry)}\n`, 'utf8');
    } catch {}
  }
}

module.exports = {
  ConnectorAuditLog,
  MAX_AUDIT_BYTES,
};
