'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cancellation = require('../src/tasks/cancellation');
const {
  MAX_CONTENT_LENGTH,
  NOTION_VERSION,
  NotionConnector,
  contentBlocks,
  pageTitle,
} = require('../src/connectors/notion');

function response(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

test('Notion health and search use current version headers and return sanitized pages', async () => {
  const calls = [];
  const connector = new NotionConnector({
    getToken: () => 'notion-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/users/me')) return response({ id: 'bot-1', name: 'Jarvis', type: 'bot' });
      return response({
        has_more: false,
        results: [{
          id: 'page-1',
          url: 'https://notion.so/page-1',
          last_edited_time: '2026-06-11T00:00:00Z',
          properties: {
            Name: {
              type: 'title',
              title: [{ plain_text: 'Meeting notes' }],
            },
          },
        }],
      });
    },
  });

  assert.equal((await connector.health()).account.name, 'Jarvis');
  const search = await connector.search({ query: 'meeting', count: 5 });
  assert.equal(search.results[0].title, 'Meeting notes');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer notion-secret');
  assert.equal(calls[0].options.headers['Notion-Version'], NOTION_VERSION);
  assert.equal(JSON.parse(calls[1].options.body).filter.value, 'page');
});

test('Notion page creation validates IDs and builds bounded paragraph blocks', async () => {
  let requestBody;
  const connector = new NotionConnector({
    getToken: () => 'notion-secret',
    fetchImpl: async (url, options) => {
      requestBody = JSON.parse(options.body);
      return response({ id: 'created-1', url: 'https://notion.so/created-1' });
    },
  });
  const parentPageId = '12345678-1234-1234-1234-1234567890ab';
  const result = await connector.createPage({
    parentPageId,
    title: 'Launch plan',
    content: 'x'.repeat(2500),
  });

  assert.equal(result.ok, true);
  assert.equal(requestBody.parent.page_id, parentPageId.replace(/-/g, ''));
  assert.equal(requestBody.children.length, 2);
  assert.equal(requestBody.children[0].paragraph.rich_text[0].text.content.length, 2000);
  assert.equal((await connector.createPage({ parentPageId: 'bad', title: 'x' })).code, 'CONNECTOR_INVALID_ARGUMENT');
  assert.equal(
    (await connector.createPage({
      parentPageId,
      title: 'x',
      content: 'x'.repeat(MAX_CONTENT_LENGTH + 1),
    })).code,
    'CONNECTOR_CONTENT_TOO_LARGE'
  );
});

test('Notion helper output omits unavailable titles and empty content', () => {
  assert.equal(pageTitle({ properties: {} }), 'Untitled');
  assert.deepEqual(contentBlocks(''), []);
});

test('Notion requests distinguish timeout from parent cancellation', async () => {
  const waitForAbort = async (url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const timeoutConnector = new NotionConnector({
    getToken: () => 'notion-secret',
    fetchImpl: waitForAbort,
    timeoutMs: 5,
  });
  assert.equal((await timeoutConnector.health()).code, 'CONNECTOR_TIMEOUT');

  const controller = new AbortController();
  const cancelledConnector = new NotionConnector({
    getToken: () => 'notion-secret',
    fetchImpl: waitForAbort,
    timeoutMs: 1000,
  });
  const pending = cancelledConnector.health({ signal: controller.signal });
  controller.abort(cancellation.createAbortError());
  await assert.rejects(pending, (error) => cancellation.isAbortError(error));
});
