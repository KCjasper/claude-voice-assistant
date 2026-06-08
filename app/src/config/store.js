// src/config/store.js — 加密設定儲存
// 用 Electron safeStorage（Windows DPAPI / macOS Keychain）保護 API Key

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = () => app.getPath('userData');
const KEY_FILE   = () => path.join(CONFIG_DIR(), 'apikey.enc');
const PREFS_FILE = () => path.join(CONFIG_DIR(), 'prefs.json');

const DEFAULT_PREFS = {
  baseUrl: 'https://clawrouter.com/v1',
  defaultModel: 'anthropic/claude-sonnet-4',
  ttsVoice: 'zh-TW-HsiaoChenNeural',
  ttsRate: 1.0,
  pttHotkey: 'Control+Space',
  monthlyCapUsd: 50,
  modelRouting: true,
};

// ===== API Key（加密）=====

function saveApiKey(plainKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系統加密不可用（Windows DPAPI 未啟動？）');
  }
  if (!plainKey || typeof plainKey !== 'string') {
    throw new Error('Key 為空');
  }
  const enc = safeStorage.encryptString(plainKey);
  fs.writeFileSync(KEY_FILE(), enc);
  return true;
}

function loadApiKey() {
  if (!fs.existsSync(KEY_FILE())) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const enc = fs.readFileSync(KEY_FILE());
    return safeStorage.decryptString(enc);
  } catch (e) {
    return null;
  }
}

function hasApiKey() {
  return fs.existsSync(KEY_FILE());
}

function clearApiKey() {
  if (fs.existsSync(KEY_FILE())) fs.unlinkSync(KEY_FILE());
}

// ===== 偏好設定（明碼 JSON）=====

function loadPrefs() {
  if (!fs.existsSync(PREFS_FILE())) return { ...DEFAULT_PREFS };
  try {
    const raw = fs.readFileSync(PREFS_FILE(), 'utf-8');
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(partial) {
  const cur = loadPrefs();
  const next = { ...cur, ...partial };
  fs.writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// ===== 連線測試 =====

async function testConnection() {
  const key = loadApiKey();
  if (!key) return { ok: false, error: '尚未儲存 API Key' };

  const prefs = loadPrefs();
  try {
    const res = await fetch(`${prefs.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}：${txt.slice(0, 120) || res.statusText}` };
    }
    const data = await res.json().catch(() => null);
    const modelCount = data?.data?.length || 0;
    return { ok: true, modelCount };
  } catch (e) {
    return { ok: false, error: `連線失敗：${e.message}` };
  }
}

module.exports = {
  saveApiKey,
  loadApiKey,
  hasApiKey,
  clearApiKey,
  loadPrefs,
  savePrefs,
  testConnection,
  DEFAULT_PREFS,
};
