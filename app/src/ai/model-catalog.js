'use strict';

const pricing = require('./pricing');

const CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 5000;

function normalizeCatalog(payload, { monthlyCapUsd = 0 } = {}) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const capEnabled = Number(monthlyCapUsd) > 0;
  const models = [];

  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const priceKnown = pricing.hasKnownPrice(id);
    models.push({
      id,
      ownedBy: typeof row.owned_by === 'string' ? row.owned_by : '',
      created: Number.isFinite(row.created) ? row.created : null,
      priceKnown,
      selectableUnderCap: !capEnabled || priceKnown,
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function classifyTask(text) {
  const value = String(text || '');
  if (
    value.length > 500
    || /(code|debug|research|analyse|analyze|architecture|implement|refactor|file|report|compare|程式|代碼|研究|分析|比較|檔案|文件|實作|修正)/i.test(value)
  ) {
    return 'reasoning';
  }
  if (value.length <= 120) return 'fast';
  return 'balanced';
}

function routePriorities(route, defaultModel) {
  const common = [
    defaultModel,
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'gemini-2.5-flash',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
  ];
  if (route === 'reasoning') {
    return [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      ...common,
    ];
  }
  if (route === 'fast') {
    return ['gemini-2.5-flash', defaultModel, ...common];
  }
  return common;
}

function resolveModel({
  requestedModel,
  defaultModel = 'claude-sonnet-4-6',
  modelRouting = false,
  monthlyCapUsd = 0,
  text = '',
  availableModels = null,
}) {
  const requested = requestedModel || defaultModel;
  const explicitRequest = typeof requestedModel === 'string' && requestedModel.trim().length > 0;
  const route = explicitRequest ? 'explicit' : (modelRouting ? classifyTask(text) : 'fixed');
  const available = Array.isArray(availableModels)
    ? new Set(availableModels.map((model) => typeof model === 'string' ? model : model.id))
    : null;
  const capEnabled = Number(monthlyCapUsd) > 0;
  const eligible = (model) => (
    typeof model === 'string'
    && model.length > 0
    && (!available || available.has(model))
    && (!capEnabled || pricing.hasKnownPrice(model))
  );

  const candidates = explicitRequest
    ? [requested, defaultModel, ...routePriorities('balanced', defaultModel)]
    : modelRouting
    ? routePriorities(route, defaultModel)
    : [requested, defaultModel, ...routePriorities('balanced', defaultModel)];
  if (available) candidates.push(...available);

  const unique = [...new Set(candidates.filter(Boolean))];
  const model = unique.find(eligible) || null;
  if (!model) {
    return {
      ok: false,
      code: 'MODEL_NO_ELIGIBLE_FALLBACK',
      error: capEnabled
        ? 'No available model has known pricing for the enabled spending cap.'
        : 'No requested or fallback model is available from the provider.',
      requestedModel: requested,
      route,
    };
  }

  return {
    ok: true,
    model,
    requestedModel: requested,
    route,
    fallback: model !== requested,
    reason: route === 'explicit'
      ? (model === requested ? 'explicit-request' : 'explicit-fallback')
      : modelRouting
        ? `model-routing:${route}`
        : (model === requested ? 'requested' : 'unavailable-fallback'),
  };
}

class ModelCatalogService {
  constructor({
    getBaseUrl,
    getApiKey,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  }) {
    this.getBaseUrl = getBaseUrl;
    this.getApiKey = getApiKey;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = null;
  }

  async getCatalog({ force = false, monthlyCapUsd = 0 } = {}) {
    if (!force && this.cache && this.now() - this.cache.fetchedAt < CATALOG_TTL_MS) {
      return {
        ...this.cache,
        models: normalizeCatalog({ data: this.cache.rawModels }, { monthlyCapUsd }),
        cached: true,
      };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw Object.assign(new Error('An API key is required to load the model catalog.'), {
        code: 'MODEL_CATALOG_NO_API_KEY',
      });
    }

    const baseUrl = String(this.getBaseUrl() || '').replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Model catalog request failed with HTTP ${response.status}.`), {
          code: 'MODEL_CATALOG_HTTP_ERROR',
          status: response.status,
        });
      }
      const payload = await response.json();
      const rawModels = Array.isArray(payload?.data) ? payload.data : [];
      this.cache = {
        rawModels,
        fetchedAt: this.now(),
        source: 'provider',
      };
      return {
        ...this.cache,
        models: normalizeCatalog(payload, { monthlyCapUsd }),
        cached: false,
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw Object.assign(new Error('Model catalog request timed out.'), {
          code: 'MODEL_CATALOG_TIMEOUT',
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  CATALOG_TTL_MS,
  ModelCatalogService,
  classifyTask,
  normalizeCatalog,
  resolveModel,
};
