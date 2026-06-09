'use strict';

const pricing = require('../ai/pricing');
const ledger = require('./ledger');

function evaluateRequest({ usage, monthlyCapUsd, model, date = new Date() }) {
  const usageSummary = ledger.capStatus(usage, monthlyCapUsd, date);

  if (usageSummary.overCap) {
    return {
      allowed: false,
      code: 'MONTHLY_CAP_REACHED',
      error: `Monthly AI spending cap reached ($${usageSummary.capUsd.toFixed(2)}).`,
      usageSummary,
    };
  }

  if (usageSummary.enabled && !pricing.hasKnownPrice(model)) {
    return {
      allowed: false,
      code: 'MODEL_PRICE_UNKNOWN',
      error: `Cannot enforce the monthly cap because pricing is unknown for model "${model}".`,
      usageSummary,
    };
  }

  return { allowed: true, usageSummary };
}

module.exports = { evaluateRequest };
