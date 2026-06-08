// src/tts/speak.js — Edge TTS 語音合成（主程序）
// 把文字合成成 MP3 buffer，交給渲染端播放

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const DEFAULT_VOICE = 'zh-TW-HsiaoChenNeural';

/**
 * 把使用者偏好的速度（0.5~1.5，1.0=正常）轉成 SSML 的相對百分比字串
 * 1.0 → 不調整；1.2 → "+20%"；0.8 → "-20%"
 */
function rateToSSML(rate) {
  if (typeof rate !== 'number' || rate === 1.0) return null;
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

/**
 * 合成語音
 * @param {string} text
 * @param {object} opts - { voice, rate }
 * @returns {Promise<{ ok, audioBase64?, error? }>}
 */
async function synthesize(text, opts = {}) {
  const clean = (text || '').trim();
  if (!clean) return { ok: false, error: '沒有要念的文字' };

  const voice = opts.voice || DEFAULT_VOICE;
  const rateStr = rateToSSML(opts.rate);

  let tts;
  try {
    tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  } catch (e) {
    return { ok: false, error: `TTS 初始化失敗：${e.message}` };
  }

  try {
    const prosody = {};
    if (rateStr) prosody.rate = rateStr;

    const { audioStream } = tts.toStream(clean, prosody);
    const chunks = [];

    const buf = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TTS 合成逾時（15 秒）')), 15000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      audioStream.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    try { tts.close(); } catch {}

    if (!buf || buf.length === 0) return { ok: false, error: '合成結果為空' };
    return { ok: true, audioBase64: buf.toString('base64') };
  } catch (e) {
    try { tts.close(); } catch {}
    return { ok: false, error: `TTS 合成失敗：${e.message}` };
  }
}

module.exports = { synthesize, DEFAULT_VOICE };
