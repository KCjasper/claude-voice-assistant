'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConnectorAuditLog } = require('../src/connectors/audit-log');

test('connector audit logs metadata without credentials or page content', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-connectors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connector-audit.jsonl');
  const audit = new ConnectorAuditLog({
    filePath: () => filePath,
    now: () => new Date('2026-06-11T00:00:00Z'),
  });

  audit.record({
    connectorId: 'notion',
    toolName: 'notion_create_page',
    action: 'representational-write',
    status: 'completed',
    target: { parentPageId: 'parent-1' },
    credential: 'secret-token',
    args: { content: 'private page body' },
  });

  const raw = fs.readFileSync(filePath, 'utf8');
  assert.match(raw, /notion_create_page|parent-1/);
  assert.doesNotMatch(raw, /secret-token|private page body|credential|args/);
});
