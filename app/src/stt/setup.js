// src/stt/setup.js — Whisper 自動安裝器
// 確認 whisper.cpp 執行檔與模型存在；不存在則從 GitHub / HuggingFace 下載

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const AdmZip = require('adm-zip');

const BIN_DIR = () => path.join(app.getPath('userData'), 'bin');
const MODEL_DIR = () => path.join(app.getPath('userData'), 'models');

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

function isReady() {
  const exe = findWhisperExe(BIN_DIR());
  return !!exe;
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

// 從 GitHub API 找 whisper.cpp 最新 release 的 Windows x64 binary
async function getWhisperBinaryUrl() {
  const url = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest';
  const res = await fetch(url, { headers: { 'User-Agent': 'VoiceAssistant/0.1' } });
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const data = await res.json();

  // 偏好順序：blas-bin-x64 (with OpenBLAS) > bin-x64
  const preferred = ['whisper-blas-bin-x64.zip', 'whisper-bin-x64.zip', 'whisper-cli-x64.zip'];
  for (const name of preferred) {
    const asset = data.assets.find(a => a.name === name);
    if (asset) return { url: asset.browser_download_url, name, version: data.tag_name };
  }
  // Fallback：找任何含 "x64" 與 ".zip" 的
  const fallback = data.assets.find(a => /x64/.test(a.name) && a.name.endsWith('.zip'));
  if (fallback) return { url: fallback.browser_download_url, name: fallback.name, version: data.tag_name };

  throw new Error('找不到適合的 Windows x64 binary');
}

async function ensureBinary(onProgress) {
  if (isReady()) return findWhisperExe(BIN_DIR());

  if (onProgress) onProgress({ stage: 'binary', step: 'fetch-url' });
  const { url, name, version } = await getWhisperBinaryUrl();

  if (onProgress) onProgress({ stage: 'binary', step: 'download', name, version });
  fs.mkdirSync(BIN_DIR(), { recursive: true });
  const zipPath = path.join(BIN_DIR(), name);
  await downloadStream(url, zipPath, (p) => {
    if (onProgress) onProgress({ stage: 'binary', step: 'download', ...p, version });
  });

  if (onProgress) onProgress({ stage: 'binary', step: 'extract' });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(BIN_DIR(), true);
  try { fs.unlinkSync(zipPath); } catch {}

  const exe = findWhisperExe(BIN_DIR());
  if (!exe) throw new Error('解壓後找不到 whisper-cli.exe');
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
  MODEL_DIR,
  findWhisperExe,
};
