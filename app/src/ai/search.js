// src/ai/search.js — 網路搜尋（支援 Brave Search API 與 Google Custom Search）
// 依 prefs.searchProvider 與已儲存的 key 自動選擇

const store = require('../config/store');

function timeoutFetch(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function braveSearch(query, count) {
  const key = store.loadSecret('braveSearchKey');
  if (!key) return { ok: false, error: '尚未設定 Brave Search API Key' };
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await timeoutFetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
  });
  if (!res.ok) return { ok: false, error: `Brave HTTP ${res.status}` };
  const data = await res.json();
  const results = (data.web?.results || []).slice(0, count).map((r) => ({
    title: r.title, url: r.url, snippet: r.description,
  }));
  return { ok: true, results };
}

async function tavilySearch(query, count) {
  const key = store.loadSecret('tavilySearchKey');
  if (!key) return { ok: false, error: '尚未設定 Tavily API Key' };
  const res = await timeoutFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: count, search_depth: 'basic' }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `Tavily HTTP ${res.status}：${t.slice(0, 120)}` };
  }
  const data = await res.json();
  const results = (data.results || []).slice(0, count).map((r) => ({
    title: r.title, url: r.url, snippet: r.content,
  }));
  // Tavily 有時直接給一個 answer，附在最前面當參考
  if (data.answer) results.unshift({ title: '（Tavily 摘要）', url: '', snippet: data.answer });
  return { ok: true, results };
}

async function googleSearch(query, count) {
  const key = store.loadSecret('googleSearchKey');
  const cx = store.loadPrefs().googleCx;
  if (!key) return { ok: false, error: '尚未設定 Google Search API Key' };
  if (!cx) return { ok: false, error: '尚未設定 Google 搜尋引擎 ID (cx)' };
  const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(count, 10)}`;
  const res = await timeoutFetch(url, {});
  if (!res.ok) return { ok: false, error: `Google HTTP ${res.status}` };
  const data = await res.json();
  const results = (data.items || []).slice(0, count).map((r) => ({
    title: r.title, url: r.link, snippet: r.snippet,
  }));
  return { ok: true, results };
}

/**
 * 執行搜尋，回傳給模型看的純文字
 */
async function webSearch(query, count = 5) {
  if (!query || !query.trim()) return '錯誤：搜尋關鍵字為空';
  const provider = store.loadPrefs().searchProvider || 'tavily';

  let r;
  try {
    if (provider === 'google') r = await googleSearch(query, count);
    else if (provider === 'brave') r = await braveSearch(query, count);
    else r = await tavilySearch(query, count); // 預設 tavily
  } catch (e) {
    if (e.name === 'AbortError') return '錯誤：搜尋逾時';
    return `錯誤：搜尋失敗 ${e.message}`;
  }

  if (!r.ok) return `錯誤：${r.error}`;
  if (!r.results.length) return '（沒有搜尋到結果）';

  return r.results
    .map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`)
    .join('\n\n');
}

module.exports = { webSearch };
