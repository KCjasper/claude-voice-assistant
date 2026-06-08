// src/stt/whisper.js — 轉錄包裝
// 呼叫 whisper-cli.exe 把 WAV 轉成文字

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const setup = require('./setup');

// 從 prefs 取得目前模型（之後可從 store 帶入；先寫死預設）
const DEFAULT_MODEL = 'medium-q5';

/**
 * 轉錄一個 WAV 檔
 * @param {string} wavPath - 16k 單聲道 16-bit PCM WAV 路徑
 * @param {object} opts - { model, language, onProgress, prompt }
 * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
 */
async function transcribe(wavPath, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const language = opts.language || 'zh';   // 繁中
  const onProgress = opts.onProgress || (() => {});

  try {
    if (!fs.existsSync(wavPath)) return { ok: false, error: `找不到錄音檔：${wavPath}` };

    onProgress({ phase: 'ensure-binary' });
    const exe = await setup.ensureBinary(onProgress);

    onProgress({ phase: 'ensure-model', model });
    const modelPath = await setup.ensureModel(model, onProgress);

    onProgress({ phase: 'transcribe' });
    const text = await runWhisper(exe, modelPath, wavPath, { language, prompt: opts.prompt });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function runWhisper(exe, modelPath, wavPath, { language, prompt }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-l', language,            // zh 對繁中和簡中都通
      '--no-prints',             // 不要進度條干擾輸出
      '--output-txt',            // 同時寫一份 .txt（保險）
      '-of', wavPath.replace(/\.wav$/i, ''),  // output file prefix
    ];
    if (prompt) {
      args.push('--prompt', prompt);
    }

    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => reject(new Error(`啟動 whisper 失敗：${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`whisper exit ${code}：${stderr.slice(-400) || stdout.slice(-400)}`));
      }
      // 優先讀 .txt
      const txtPath = wavPath.replace(/\.wav$/i, '.txt');
      try {
        if (fs.existsSync(txtPath)) {
          const text = fs.readFileSync(txtPath, 'utf-8').trim();
          if (text) return resolve(text);
        }
      } catch {}
      // 後備：解析 stdout
      const cleaned = cleanStdout(stdout);
      resolve(cleaned);
    });
  });
}

// 從 stdout 抽出純文字（whisper.cpp 預設輸出含時間軸）
function cleanStdout(stdout) {
  const lines = stdout.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    // 例如：[00:00:00.000 --> 00:00:04.000] 你好我是 KC
    const m = line.match(/\]\s*(.+)$/);
    if (m) out.push(m[1].trim());
    else if (line.trim() && !line.startsWith('whisper_') && !line.includes('system_info')) {
      out.push(line.trim());
    }
  }
  return out.join(' ').trim();
}

module.exports = { transcribe };
