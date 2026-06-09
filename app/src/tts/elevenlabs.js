// src/tts/elevenlabs.js — ElevenLabs TTS（真人級語音）
// 合成 MP3 + 列出帳號可用聲音

const store = require('../config/store');
const cancellation = require('../tasks/cancellation');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const API = 'https://api.elevenlabs.io/v1';

function timeoutFetch(url, options = {}, ms = 20000, parentSignal) {
  const timeout = cancellation.timeoutSignal(parentSignal, ms);
  return fetch(url, { ...options, signal: timeout.signal }).finally(timeout.cleanup);
}

/**
 * 合成語音 → base64 mp3
 * @param {string} text
 * @param {object} opts - { voiceId, model }
 */
async function synthesize(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return { ok: false, error: '沒有要念的文字' };
  const signal = opts.signal;
  cancellation.throwIfAborted(signal);

  const key = store.loadSecret('elevenLabsKey');
  if (!key) return { ok: false, error: '尚未設定 ElevenLabs API Key' };

  const prefs = store.loadPrefs();
  const voiceId = opts.voiceId || prefs.elevenVoiceId;
  if (!voiceId) return { ok: false, error: '尚未選擇 ElevenLabs 聲音' };
  const model = opts.model || prefs.elevenModel || DEFAULT_MODEL;

  try {
    const res = await timeoutFetch(`${API}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    }, 20000, signal);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `ElevenLabs HTTP ${res.status}：${t.slice(0, 160)}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: '合成結果為空' };
    return { ok: true, audioBase64: buf.toString('base64') };
  } catch (e) {
    if (signal?.aborted) {
      return { ok: false, code: 'CANCELLED', cancelled: true, error: 'Speech synthesis cancelled.' };
    }
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'TIMEOUT') {
      return { ok: false, error: 'ElevenLabs 合成逾時' };
    }
    return { ok: false, error: `ElevenLabs 失敗：${e.message}` };
  }
}

/**
 * 列出「我的聲音」（v2 /voices，voice_type=non-default：排除 ElevenLabs 預設庫存，
 * 保留 personal / workspace / community，即使用者擁有或加入的聲音）。含分頁處理。
 */
const V2_VOICES = 'https://api.elevenlabs.io/v2/voices';
const MAX_PAGES = 20; // 安全上限，避免無限分頁

function mapVoice(v) {
  const labels = v.labels || {};
  const desc = [labels.accent, labels.gender, labels.description].filter(Boolean).join(' · ');
  return { id: v.voice_id, name: v.name, desc, category: v.category };
}

// 可測試的核心：給 key + fetch 實作，撈完所有分頁，不做任何 fallback
async function fetchVoices(key, { fetchImpl } = {}) {
  const doFetch = fetchImpl || ((url, opts) => timeoutFetch(url, opts, 15000));
  const voices = [];
  let pageToken = null;

  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(V2_VOICES);
    url.searchParams.set('voice_type', 'non-default');
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('next_page_token', pageToken);

    const res = await doFetch(url.toString(), { headers: { 'xi-api-key': key } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}：${t.slice(0, 120)}` };
    }
    const data = await res.json();
    for (const v of data.voices || []) voices.push(mapVoice(v));

    if (data.has_more && data.next_page_token) pageToken = data.next_page_token;
    else break;
  }

  return { ok: true, voices };
}

async function listVoices() {
  const key = store.loadSecret('elevenLabsKey');
  if (!key) return { ok: false, error: '尚未設定 ElevenLabs API Key' };
  try {
    return await fetchVoices(key);
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: '逾時' };
    return { ok: false, error: e.message };
  }
}

module.exports = { synthesize, listVoices, fetchVoices, DEFAULT_MODEL };
