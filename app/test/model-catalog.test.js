'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ModelCatalogService,
  classifyTask,
  normalizeCatalog,
  resolveModel,
} = require('../src/ai/model-catalog');

test('normalizes provider models and marks spending-cap compatibility', () => {
  const models = normalizeCatalog({
    data: [
      { id: 'gpt-5.5', owned_by: 'openai' },
      { id: 'claude-sonnet-4-6', owned_by: 'anthropic' },
      { id: 'gpt-5.5', owned_by: 'duplicate' },
      { id: '' },
    ],
  }, { monthlyCapUsd: 50 });

  assert.deepEqual(models, [
    {
      id: 'claude-sonnet-4-6',
      ownedBy: 'anthropic',
      created: null,
      priceKnown: true,
      selectableUnderCap: true,
    },
    {
      id: 'gpt-5.5',
      ownedBy: 'openai',
      created: null,
      priceKnown: false,
      selectableUnderCap: false,
    },
  ]);
});

test('routes simple and reasoning tasks to eligible provider models', () => {
  const available = [
    'gemini-2.5-flash',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ];
  const fast = resolveModel({
    defaultModel: 'claude-sonnet-4-6',
    modelRouting: true,
    monthlyCapUsd: 50,
    text: 'What time is it?',
    availableModels: available,
  });
  const reasoning = resolveModel({
    defaultModel: 'claude-sonnet-4-6',
    modelRouting: true,
    monthlyCapUsd: 50,
    text: 'Analyze and refactor this architecture.',
    availableModels: available,
  });

  assert.equal(classifyTask('What time is it?'), 'fast');
  assert.equal(fast.model, 'gemini-2.5-flash');
  assert.equal(reasoning.model, 'claude-opus-4-8');
});

test('falls back from unavailable or unknown-price defaults', () => {
  const unavailable = resolveModel({
    defaultModel: 'gpt-5.5',
    modelRouting: false,
    monthlyCapUsd: 50,
    availableModels: ['gpt-5.5', 'claude-sonnet-4-6'],
  });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.model, 'claude-sonnet-4-6');
  assert.equal(unavailable.fallback, true);

  const none = resolveModel({
    defaultModel: 'gpt-5.5',
    modelRouting: false,
    monthlyCapUsd: 50,
    availableModels: ['gpt-5.5', 'gemini-3-pro-preview'],
  });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'MODEL_NO_ELIGIBLE_FALLBACK');
});

test('explicit per-request models override automatic routing when eligible', () => {
  const result = resolveModel({
    requestedModel: 'claude-sonnet-4-6',
    defaultModel: 'gemini-2.5-flash',
    modelRouting: true,
    monthlyCapUsd: 50,
    text: 'Analyze a complex architecture.',
    availableModels: [
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'gemini-2.5-flash',
    ],
  });

  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.equal(result.route, 'explicit');
  assert.equal(result.reason, 'explicit-request');
});

test('catalog service fetches, caches and refreshes provider models', async () => {
  let calls = 0;
  let now = 1000;
  const service = new ModelCatalogService({
    getBaseUrl: () => 'https://provider.example/v1/',
    getApiKey: () => 'secret',
    now: () => now,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://provider.example/v1/models');
      assert.equal(options.headers.Authorization, 'Bearer secret');
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'claude-sonnet-4-6' }] }),
      };
    },
  });

  const first = await service.getCatalog({ monthlyCapUsd: 50 });
  const cached = await service.getCatalog({ monthlyCapUsd: 0 });
  now += 10;
  const forced = await service.getCatalog({ force: true });

  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(cached.models[0].selectableUnderCap, true);
  assert.equal(forced.cached, false);
  assert.equal(calls, 2);
});
