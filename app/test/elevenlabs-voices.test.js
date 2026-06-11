'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { estimateCost, fetchVoices } = require('../src/tts/elevenlabs');

test('estimates paid synthesis usage from Unicode characters', () => {
  assert.deepStrictEqual(estimateCost('你好 A', 0.30), {
    characters: 4,
    cost: 0.0012,
  });
  assert.deepStrictEqual(estimateCost('free', 0), {
    characters: 4,
    cost: 0,
  });
});

// 建一個假的 Response
function jsonRes(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function voice(id, name, category = 'professional') {
  return { voice_id: id, name, category, labels: { gender: 'male' } };
}

test('filtering: 回傳 API 給的聲音、帶 voice_type=non-default', async () => {
  let calledUrl = '';
  const fetchImpl = async (url) => {
    calledUrl = url;
    return jsonRes({ voices: [voice('a', 'Jarvis'), voice('b', 'Julian')], has_more: false });
  };
  const r = await fetchVoices('k', { fetchImpl });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.voices.map((v) => v.name), ['Jarvis', 'Julian']);
  assert.ok(calledUrl.includes('/v2/voices'));
  assert.ok(calledUrl.includes('voice_type=non-default'));
});

test('pagination: 跟著 next_page_token 撈完所有頁', async () => {
  const pages = {
    null: { voices: [voice('a', 'A')], has_more: true, next_page_token: 't2' },
    t2: { voices: [voice('b', 'B')], has_more: true, next_page_token: 't3' },
    t3: { voices: [voice('c', 'C')], has_more: false },
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const token = u.searchParams.get('next_page_token');
    return jsonRes(pages[token]);
  };
  const r = await fetchVoices('k', { fetchImpl });
  assert.deepStrictEqual(r.voices.map((v) => v.name), ['A', 'B', 'C']);
});

test('empty: 沒有聲音時回空陣列，不退回 premade', async () => {
  const fetchImpl = async () => jsonRes({ voices: [], has_more: false });
  const r = await fetchVoices('k', { fetchImpl });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.voices, []);
});

test('HTTP error: 非 2xx 回 ok:false 帶狀態碼', async () => {
  const fetchImpl = async () => jsonRes('unauthorized', { ok: false, status: 401 });
  const r = await fetchVoices('k', { fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('401'));
});

test('timeout: fetch 拋 AbortError 會往上拋（由 listVoices 轉成逾時訊息）', async () => {
  const fetchImpl = async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  await assert.rejects(() => fetchVoices('k', { fetchImpl }), /aborted/);
});
