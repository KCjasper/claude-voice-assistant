'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const cancellation = require('../src/tasks/cancellation');

let mode = 'blocked';
const requests = [];

class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async (params, options = {}) => {
          requests.push(params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })));

          if (mode === 'blocked') {
            return (async function* blockedStream() {
              await new Promise((resolve, reject) => {
                const signal = options.signal;
                if (signal?.aborted) return reject(signal.reason);
                signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
              });
            })();
          }

          return (async function* successfulStream() {
            yield { choices: [{ delta: { content: 'Done.' } }] };
            yield {
              choices: [],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            };
          })();
        },
      },
    };
  }
}

const originalLoad = Module._load;
Module._load = function mockEngineDependencies(request, parent, isMain) {
  if (request === 'openai') return FakeOpenAI;
  if (request === '../config/store') {
    return {
      loadApiKey: () => 'test-key',
      loadPrefs: () => ({
        baseUrl: 'https://example.invalid/v1',
        defaultModel: 'claude-sonnet-4-6',
        jarvisMode: false,
      }),
    };
  }
  if (request === './tools') return { schema: [], execute: async () => '' };
  if (request === './pricing') {
    return {
      computeCost: () => 0,
      getPrice: () => ({ in: 3, out: 15 }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const engine = require('../src/ai/engine');
Module._load = originalLoad;

test('cancelled AI turns are removed from conversation history', async () => {
  engine.resetConversation();
  const controller = new AbortController();
  const first = engine.chat('first message', { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancellation.createAbortError());

  const cancelled = await first;
  assert.equal(cancelled.code, 'CANCELLED');

  mode = 'success';
  const completed = await engine.chat('second message');
  assert.equal(completed.ok, true);

  const latestMessages = requests.at(-1);
  assert.equal(
    latestMessages.some((message) => message.content === 'first message'),
    false
  );
  assert.equal(
    latestMessages.some((message) => message.content === 'second message'),
    true
  );
});

test('per-request cost bounds stop a call before exceeding its budget', async () => {
  engine.resetConversation();
  mode = 'success';
  const before = requests.length;

  const result = await engine.chat('Analyze a large architecture.', {
    maxCostUsd: 0.000001,
    maxOutputTokens: 2048,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'REQUEST_COST_LIMIT_REACHED');
  assert.equal(requests.length, before);
});
