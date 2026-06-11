'use strict';

const path = require('path');
const store = require('../config/store');
const { ConnectorAuditLog } = require('./audit-log');
const { NotionConnector } = require('./notion');
const { ConnectorRegistry } = require('./registry');

const notion = new NotionConnector({
  getToken: () => store.loadSecret('connector-notion-token'),
});

const registry = new ConnectorRegistry({
  connectors: [notion],
  store,
  auditLog: new ConnectorAuditLog({
    filePath: () => path.join(
      require('electron').app.getPath('userData'),
      'connector-audit.jsonl'
    ),
  }),
});

module.exports = registry;
