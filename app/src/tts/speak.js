// src/tts/speak.js — Edge TTS 語音合成（主程序）
// 把文字合成成 MP3 buffer，交給渲染端播放

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const cancellation = require('../tasks/cancellation');

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
  const signal = opts.signal;
  cancellation.throwIfAborted(signal);

  const voice = opts.voice || DEFAULT_VOICE;
  const rateStr = rateToSSML(opts.rate);

  let tts;
  try {
    tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    cancellation.throwIfAborted(signal);
  } catch (e) {
    return { ok: false, error: `TTS 初始化失敗：${e.message}` };
  }

  try {
    const prosody = {};
    if (rateStr) prosody.rate = rateStr;

    const { audioStream } = tts.toStream(clean, prosody);
    const chunks = [];

    const buf = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn(value);
      };
      const onAbort = () => {
        const error = cancellation.isAbortError(signal.reason)
          ? signal.reason
          : cancellation.createAbortError();
        finish(reject, error);
        try { audioStream.destroy(error); } catch {}
        try { tts.close(); } catch {}
      };
      const onTimeout = () => {
        finish(reject, new Error('TTS 合成逾時（15 秒）'));
        try { audioStream.destroy(); } catch {}
        try { tts.close(); } catch {}
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(onTimeout, 15000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => finish(resolve, Buffer.concat(chunks)));
      audioStream.on('close', () => finish(resolve, Buffer.concat(chunks)));
      audioStream.on('error', (e) => finish(reject, e));
    });

    try { tts.close(); } catch {}

    if (!buf || buf.length === 0) return { ok: false, error: '合成結果為空' };
    return { ok: true, audioBase64: buf.toString('base64') };
  } catch (e) {
    try { tts.close(); } catch {}
    if (cancellation.isAbortError(e) || signal?.aborted) {
      return { ok: false, code: 'CANCELLED', cancelled: true, error: 'Speech synthesis cancelled.' };
    }
    return { ok: false, error: `TTS 合成失敗：${e.message}` };
  }
}

module.exports = { synthesize, DEFAULT_VOICE };
