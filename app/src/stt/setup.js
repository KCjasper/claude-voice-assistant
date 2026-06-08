// src/stt/setup.js — Whisper 自動安裝器
// 確認 whisper.cpp 執行檔與模型存在；不存在則從 GitHub / HuggingFace 下載

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { app } = require('electron');

const BIN_DIR = () => path.join(app.getPath('userData'), 'bin');           // CPU 版
const BIN_DIR_CUDA = () => path.join(app.getPath('userData'), 'bin-cuda'); // GPU 版
const MODEL_DIR = () => path.join(app.getPath('userData'), 'models');

const REPO = 'ggml-org/whisper.cpp';

const MODEL_URLS = {
  tiny:        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base:        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small:       'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  'small-q5':  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_0.bin',
  medium:      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  'medium-q5': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
  large:       'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
};

// 找執行檔位置（不同 release 結構可能放在不同子資料夾）
// 注意：新版 whisper.cpp 同時附 main.exe（已淘汰，會 exit 1）與 whisper-cli.exe，
// 必須優先選 whisper-cli.exe，所以全部掃完再按優先順序挑。
function findWhisperExe(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const priority = ['whisper-cli.exe', 'whisper.exe', 'main.exe']; // 高→低
  const found = {}; // name -> 第一個找到的完整路徑

  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) queue.push(p);
      else if (priority.includes(e.name) && !found[e.name]) found[e.name] = p;
    }
  }

  for (const name of priority) {
    if (found[name]) return found[name];
  }
  return null;
}

function isReady(gpu = false) {
  return !!findWhisperExe(gpu ? BIN_DIR_CUDA() : BIN_DIR());
}

function modelPath(name = 'medium-q5') {
  return path.join(MODEL_DIR(), `ggml-${name}.bin`);
}

function modelExists(name = 'medium-q5') {
  return fs.existsSync(modelPath(name));
}

// HTTPS 下載含 follow redirect + progress
function downloadStream(url, destPath, onProgress, _depth = 0) {
  return new Promise((resolve, reject) => {
    if (_depth > 5) return reject(new Error('Too many redirects'));
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.part';
    const file = fs.createWriteStream(tmp);

    const req = https.get(url, {
      headers: { 'User-Agent': 'VoiceAssistant/0.1' },
    }, (res) => {
      // Redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(tmp); } catch {}
        return resolve(downloadStream(res.headers.location, destPath, onProgress, _depth + 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tmp); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress) onProgress({ downloaded, total });
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmp, destPath);
            resolve(destPath);
          } catch (e) { reject(e); }
        });
      });
    });
    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(tmp); } catch {}
      reject(e);
    });
  });
}

function extractZip(zipPath, destDir, onProgress, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    if (onProgress) onProgress({ stage: 'binary', step: 'extract', tool: 'tar' });

    const child = spawn('tar', ['-xf', zipPath, '-C', destDir], {
      windowsHide: true,
    });

    let settled = false;
    let stderr = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error('Whisper binary extraction timed out'));
    }, timeoutMs);

    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (e) => {
      finish(reject, new Error(`Failed to start zip extractor: ${e.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) return finish(resolve);
      finish(reject, new Error(`Whisper binary extraction failed with exit ${code}: ${stderr.slice(-800)}`));
    });
  });
}

// 透過 releases atom feed + expanded_assets HTML 找下載網址（不走會被限流的 GitHub API）
async function getWhisperBinaryUrl(gpu) {
  const H = { 'User-Agent': 'VoiceAssistant/0.1' };

  // 1) 最新版號
  const atom = await (await fetch(`https://github.com/${REPO}/releases.atom`, { headers: H })).text();
  const tag = (atom.match(/releases\/tag\/([^<"]+)/) || [])[1];
  if (!tag) throw new Error('找不到 whisper 版本');

  // 2) 該版資產清單
  const html = await (await fetch(`https://github.com/${REPO}/releases/expanded_assets/${tag}`, { headers: H })).text();
  const esc = tag.replace(/[.]/g, '\\.');
  const names = [...html.matchAll(new RegExp(`/download/${esc}/([^"]+)`, 'g'))].map((m) => m[1]);

  let asset;
  if (gpu) {
    // 優先 CUDA 12.x，其次 11.x
    asset = names.find((n) => /cublas-12.*x64\.zip$/.test(n))
         || names.find((n) => /cublas-11.*x64\.zip$/.test(n));
  }
  if (!asset) {
    asset = names.find((n) => /blas-bin-x64\.zip$/.test(n))
         || names.find((n) => /whisper-bin-x64\.zip$/.test(n));
  }
  if (!asset) throw new Error('找不到適合的 Windows x64 binary');

  return { url: `https://github.com/${REPO}/releases/download/${tag}/${asset}`, name: asset, version: tag };
}

async function ensureBinary(onProgress, gpu = false) {
  const dir = gpu ? BIN_DIR_CUDA() : BIN_DIR();
  if (isReady(gpu)) return findWhisperExe(dir);

  if (onProgress) onProgress({ stage: 'binary', step: 'fetch-url', gpu });
  const { url, name, version } = await getWhisperBinaryUrl(gpu);

  if (onProgress) onProgress({ stage: 'binary', step: 'download', name, version, gpu });
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, name);
  await downloadStream(url, zipPath, (p) => {
    if (onProgress) onProgress({ stage: 'binary', step: 'download', ...p, version, gpu });
  });

  await extractZip(zipPath, dir, (p) => {
    if (onProgress) onProgress({ ...p, version, gpu });
  });

  const exe = findWhisperExe(dir);
  if (!exe) throw new Error('解壓後找不到 whisper-cli.exe');
  try { fs.unlinkSync(zipPath); } catch {}
  return exe;
}

async function ensureModel(name = 'medium-q5', onProgress) {
  if (modelExists(name)) return modelPath(name);
  if (!MODEL_URLS[name]) throw new Error(`未知的模型：${name}`);

  fs.mkdirSync(MODEL_DIR(), { recursive: true });
  if (onProgress) onProgress({ stage: 'model', step: 'download', name });
  await downloadStream(MODEL_URLS[name], modelPath(name), (p) => {
    if (onProgress) onProgress({ stage: 'model', step: 'download', name, ...p });
  });
  return modelPath(name);
}

module.exports = {
  ensureBinary,
  ensureModel,
  isReady,
  modelExists,
  modelPath,
  BIN_DIR,
  BIN_DIR_CUDA,
  MODEL_DIR,
  findWhisperExe,
};
