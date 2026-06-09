'use strict';

const DAY_RETENTION = 90;
const MONTH_RETENTION = 24;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function blankBucket() {
  return { usd: 0, prompt: 0, completion: 0, calls: 0 };
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeBucket(bucket) {
  return {
    usd: finiteNonNegative(bucket?.usd),
    prompt: finiteNonNegative(bucket?.prompt),
    completion: finiteNonNegative(bucket?.completion),
    calls: finiteNonNegative(bucket?.calls),
  };
}

function normalizeUsage(usage) {
  const normalized = { days: {}, months: {} };

  for (const [key, bucket] of Object.entries(usage?.days || {})) {
    normalized.days[key] = normalizeBucket(bucket);
  }
  for (const [key, bucket] of Object.entries(usage?.months || {})) {
    normalized.months[key] = normalizeBucket(bucket);
  }

  return normalized;
}

function pruneOldBuckets(buckets, limit) {
  const keys = Object.keys(buckets).sort();
  while (keys.length > limit) delete buckets[keys.shift()];
}

function recordUsage(usage, entry, date = new Date()) {
  const next = normalizeUsage(usage);
  const day = dayKey(date);
  const month = monthKey(date);
  const increment = {
    usd: finiteNonNegative(entry?.cost),
    prompt: finiteNonNegative(entry?.promptTokens),
    completion: finiteNonNegative(entry?.completionTokens),
    calls: 1,
  };

  next.days[day] = next.days[day] || blankBucket();
  next.months[month] = next.months[month] || blankBucket();

  for (const bucket of [next.days[day], next.months[month]]) {
    bucket.usd += increment.usd;
    bucket.prompt += increment.prompt;
    bucket.completion += increment.completion;
    bucket.calls += increment.calls;
  }

  pruneOldBuckets(next.days, DAY_RETENTION);
  pruneOldBuckets(next.months, MONTH_RETENTION);
  return next;
}

function summary(usage, date = new Date()) {
  const normalized = normalizeUsage(usage);
  return {
    today: normalized.days[dayKey(date)] || blankBucket(),
    month: normalized.months[monthKey(date)] || blankBucket(),
  };
}

function capStatus(usage, monthlyCapUsd, date = new Date()) {
  const capUsd = finiteNonNegative(monthlyCapUsd);
  const totals = summary(usage, date);
  const enabled = capUsd > 0;
  const spentUsd = totals.month.usd;

  return {
    ...totals,
    capUsd,
    enabled,
    overCap: enabled && spentUsd >= capUsd,
    remainingUsd: enabled ? Math.max(0, capUsd - spentUsd) : null,
  };
}

module.exports = {
  capStatus,
  dayKey,
  monthKey,
  normalizeUsage,
  recordUsage,
  summary,
};
