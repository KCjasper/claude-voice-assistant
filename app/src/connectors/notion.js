'use strict';

const cancellation = require('../tasks/cancellation');

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_CONTENT_LENGTH = 20000;

function cleanString(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pageTitle(page) {
  for (const property of Object.values(page?.properties || {})) {
    if (property?.type !== 'title' || !Array.isArray(property.title)) continue;
    const title = property.title.map((part) => part?.plain_text || '').join('').trim();
    if (title) return title;
  }
  return 'Untitled';
}

function contentBlocks(content) {
  const text = cleanString(content, MAX_CONTENT_LENGTH);
  if (!text) return [];
  return (text.match(/[\s\S]{1,2000}/g) || []).map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: chunk },
      }],
    },
  }));
}

class NotionConnector {
  constructor({
    getToken,
    fetchImpl = (...args) => fetch(...args),
    timeoutMs = 10000,
  }) {
    this.id = 'notion';
    this.name = 'Notion';
    this.secretName = 'connector-notion-token';
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.tools = [
      {
        name: 'notion_search',
        risk: 'read',
        description: 'Search pages shared with the configured Notion connection by title.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Page title query.' },
            count: { type: 'integer', minimum: 1, maximum: 20 },
          },
          required: ['query'],
        },
        execute: (args, opts) => this.search(args, opts),
      },
      {
        name: 'notion_create_page',
        risk: 'representational-write',
        description: 'Prepare a Notion page creation. This always requires explicit user confirmation before writing.',
        parameters: {
          type: 'object',
          properties: {
            parentPageId: { type: 'string', description: 'Existing Notion page ID that will own the new page.' },
            title: { type: 'string', description: 'New page title.' },
            content: { type: 'string', description: 'Optional page body, up to 20,000 characters.' },
          },
          required: ['parentPageId', 'title'],
        },
        summarize: (args) => ({
          action: 'Create Notion page',
          parentPageId: cleanString(args.parentPageId, 64),
          title: cleanString(args.title, 200),
          contentPreview: cleanString(args.content, 300),
        }),
        target: (args) => ({
          parentPageId: cleanString(args.parentPageId, 64),
        }),
        execute: (args, opts) => this.createPage(args, opts),
      },
    ];
  }

  async request(endpoint, { method = 'GET', body, signal } = {}) {
    const token = this.getToken();
    if (!token) {
      return {
        ok: false,
        code: 'CONNECTOR_NOT_CONFIGURED',
        error: 'Notion is not connected.',
      };
    }
    const timeout = cancellation.timeoutSignal(signal, this.timeoutMs);
    try {
      const response = await this.fetch(`${NOTION_API_BASE}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          code: data.code || 'CONNECTOR_HTTP_ERROR',
          status: response.status,
          error: cleanString(data.message, 500) || `Notion HTTP ${response.status}`,
        };
      }
      return { ok: true, data };
    } catch (error) {
      if (signal?.aborted) throw signal.reason || cancellation.createAbortError();
      if (timeout.timedOut() || error?.code === 'TIMEOUT' || error?.name === 'TimeoutError') {
        return {
          ok: false,
          code: 'CONNECTOR_TIMEOUT',
          error: `Notion request timed out after ${this.timeoutMs}ms.`,
        };
      }
      return {
        ok: false,
        code: 'CONNECTOR_NETWORK_ERROR',
        error: cleanString(error?.message, 500) || 'Notion request failed.',
      };
    } finally {
      timeout.cleanup();
    }
  }

  async health({ signal } = {}) {
    const result = await this.request('/users/me', { signal });
    if (!result.ok) return result;
    return {
      ok: true,
      account: {
        id: result.data.id,
        name: result.data.name || null,
        type: result.data.type || null,
      },
      apiVersion: NOTION_VERSION,
    };
  }

  async search(args, { signal } = {}) {
    const query = cleanString(args.query, 200);
    if (!query) {
      return { ok: false, code: 'CONNECTOR_INVALID_ARGUMENT', error: 'A Notion search query is required.' };
    }
    const count = Math.min(20, Math.max(1, Number(args.count) || 5));
    const result = await this.request('/search', {
      method: 'POST',
      signal,
      body: {
        query,
        page_size: count,
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      },
    });
    if (!result.ok) return result;
    return {
      ok: true,
      results: (result.data.results || []).slice(0, count).map((page) => ({
        id: page.id,
        title: pageTitle(page),
        url: page.url || null,
        lastEditedTime: page.last_edited_time || null,
      })),
      hasMore: result.data.has_more === true,
    };
  }

  async createPage(args, { signal } = {}) {
    const parentPageId = cleanString(args.parentPageId, 64).replace(/-/g, '');
    const title = cleanString(args.title, 200);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!/^[a-f0-9]{32}$/i.test(parentPageId)) {
      return { ok: false, code: 'CONNECTOR_INVALID_ARGUMENT', error: 'A valid Notion parent page ID is required.' };
    }
    if (!title) {
      return { ok: false, code: 'CONNECTOR_INVALID_ARGUMENT', error: 'A Notion page title is required.' };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return {
        ok: false,
        code: 'CONNECTOR_CONTENT_TOO_LARGE',
        error: `Notion page content cannot exceed ${MAX_CONTENT_LENGTH} characters.`,
      };
    }
    const result = await this.request('/pages', {
      method: 'POST',
      signal,
      body: {
        parent: { type: 'page_id', page_id: parentPageId },
        properties: {
          title: {
            type: 'title',
            title: [{ type: 'text', text: { content: title } }],
          },
        },
        children: contentBlocks(content),
      },
    });
    if (!result.ok) return result;
    return {
      ok: true,
      page: {
        id: result.data.id,
        url: result.data.url || null,
        title,
      },
    };
  }
}

module.exports = {
  MAX_CONTENT_LENGTH,
  NOTION_API_BASE,
  NOTION_VERSION,
  NotionConnector,
  contentBlocks,
  pageTitle,
};
