# External connector backend

Connector credentials are stored with Electron `safeStorage` and never returned
to renderer state or written to the connector audit log.

The initial vertical integration is Notion:

- `notion_search` is read-only and can run directly.
- `notion_create_page` creates an in-memory confirmation request. The external
  write runs only after `connector:approve` consumes that one-time request.
- Notion requests use API version `2026-03-11`, a per-request timeout, parent
  cancellation, structured errors, and metadata-only JSONL auditing.

The registry keeps connector tools separate from the local filesystem and web
tools. Additional provider adapters can register schemas, health checks,
credential names, risk levels, summaries, and executors through the same
boundary.
