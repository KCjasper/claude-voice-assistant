// src/tts/elevenlabs.js — ElevenLabs TTS（真人級語音）
// 合成 MP3 + 列出帳號可用聲音

const store = require('../config/store');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const API = 'https://api.elevenlabs.io/v1';

function timeoutFetch(url, options = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * 合成語音 → base64 mp3
 * @param {string} text
 * @param {object} opts - { voiceId, model }
 */
async function synthesize(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return { ok: false, error: '沒有要念的文字' };

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
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `ElevenLabs HTTP ${res.status}：${t.slice(0, 160)}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: '合成結果為空' };
    return { ok: true, audioBase64: buf.toString('base64') };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'ElevenLabs 合成逾時' };
    return { ok: false, error: `ElevenLabs 失敗：${e.message}` };
  }
}

/**
 * 列出帳號裡可用的聲音（含 voice library 已加入的）
 */
async function listVoices() {
  const key = store.loadSecret('elevenLabsKey');
  if (!key) return { ok: false, error: '尚未設定 ElevenLabs API Key' };
  try {
    const res = await timeoutFetch(`${API}/voices`, { headers: { 'xi-api-key': key } }, 15000);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}：${t.slice(0, 120)}` };
    }
    const data = await res.json();
    const voices = (data.voices || []).map((v) => {
      const labels = v.labels || {};
      const desc = [labels.accent, labels.gender, labels.description].filter(Boolean).join(' · ');
      return { id: v.voice_id, name: v.name, desc };
    });
    return { ok: true, voices };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: '逾時' };
    return { ok: false, error: e.message };
  }
}

module.exports = { synthesize, listVoices, DEFAULT_MODEL };
