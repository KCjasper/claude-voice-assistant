'use strict';

// USD per one million input/output tokens.
const PRICE = Object.freeze({
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-4-5-20250929': { in: 3, out: 15 },
  'claude-sonnet-4-20250514': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-opus-4-7': { in: 15, out: 75 },
  'claude-opus-4-6': { in: 15, out: 75 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
});

function hasKnownPrice(model) {
  return Object.hasOwn(PRICE, model);
}

function computeCost(model, usage) {
  const price = PRICE[model];
  if (!price) return null;

  const promptTokens = Number(usage?.prompt_tokens) || 0;
  const completionTokens = Number(usage?.completion_tokens) || 0;
  return (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out;
}

module.exports = { computeCost, hasKnownPrice };
