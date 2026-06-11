// src/config/store.js — 加密設定儲存
// 用 Electron safeStorage（Windows DPAPI / macOS Keychain）保護 API Key

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const workspacePolicy = require('./workspace-policy');

const CONFIG_DIR = () => app.getPath('userData');
const KEY_FILE   = () => path.join(CONFIG_DIR(), 'apikey.enc');
const PREFS_FILE = () => path.join(CONFIG_DIR(), 'prefs.json');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_PREFS = {
  baseUrl: 'https://clawrouter.com/v1',
  defaultModel: 'claude-sonnet-4-6',
  ttsVoice: 'zh-TW-HsiaoChenNeural',
  ttsRate: 1.0,
  pttHotkey: 'Control+Space',
  wakeWordEnabled: false,
  wakeWordSensitivity: 0.55,
  wakeWordDeviceIndex: -1,
  wakeWordKeywordPath: '',
  wakeWordModelPath: '',
  remoteEnabled: false,
  remotePort: 8787,
  remoteTunnelBinaryPath: '',
  monthlyCapUsd: 50,
  maxAiRequestUsd: 1,
  maxAiOutputTokens: 2048,
  elevenLabsCostPer1KCharsUsd: 0.30,
  usage: { days: {}, months: {} },
  modelRouting: true,
  searchProvider: 'tavily',    // 'tavily' | 'brave' | 'google'
  googleCx: '',                // Google Custom Search 引擎 ID（用 google 時才需要）
  sttUseGpu: true,             // 用 GPU (CUDA) 跑 Whisper；失敗會自動退回 CPU
  jarvisMode: false,           // 英文 Jarvis 人格（英國管家口吻、英文回答）
  ttsEngine: 'edge',           // 'edge'（免費）| 'elevenlabs'（真人級）
  elevenVoiceId: '',           // ElevenLabs 選定的聲音 ID
  elevenModel: 'eleven_multilingual_v2',
  workspaceDir: '',            // 空字串代表內建 repo root
  approvedFolders: [],         // 使用者透過原生 picker 明確授權的外部資料夾
};

// ===== 通用加密 secret（搜尋 key、未來 OAuth token 等）=====
function secretFile(name) {
  const safe = String(name).replace(/[^a-z0-9_-]/gi, '_');
  return path.join(CONFIG_DIR(), `secret-${safe}.enc`);
}
function saveSecret(name, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系統加密不可用');
  if (!value) throw new Error('內容為空');
  fs.writeFileSync(secretFile(name), safeStorage.encryptString(String(value)));
  return true;
}
function loadSecret(name) {
  const f = secretFile(name);
  if (!fs.existsSync(f) || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(f)); } catch { return null; }
}
function hasSecret(name) { return fs.existsSync(secretFile(name)); }
function clearSecret(name) { try { fs.unlinkSync(secretFile(name)); } catch {} }

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
    const prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    // 遷移：舊版用了不存在的 anthropic/ 前綴 model ID → 改回有效預設
    if (typeof prefs.defaultModel === 'string' && prefs.defaultModel.startsWith('anthropic/')) {
      prefs.defaultModel = DEFAULT_PREFS.defaultModel;
    }
    prefs.approvedFolders = workspacePolicy.normalizeApprovedFolders(prefs.approvedFolders);
    if (typeof prefs.workspaceDir !== 'string') prefs.workspaceDir = '';
    return prefs;
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(next) {
  const file = PREFS_FILE();
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf-8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function savePrefs(partial) {
  const cur = loadPrefs();
  const editable = { ...(partial || {}) };
  delete editable.usage;
  delete editable.workspaceDir;
  delete editable.approvedFolders;
  delete editable.wakeWordAccessKey;
  delete editable.picovoiceAccessKey;
  const next = { ...cur, ...editable };
  writePrefs(next);
  return next;
}

function saveUsage(usage) {
  const cur = loadPrefs();
  const next = { ...cur, usage };
  writePrefs(next);
  return next;
}

function workspaceValidationOptions(options = {}) {
  return {
    homeDir: app.getPath('home'),
    ...options,
  };
}

function getWorkspaceState(options = {}) {
  const prefs = loadPrefs();
  const activePath = workspacePolicy.resolveActiveWorkspace(
    prefs,
    PROJECT_ROOT,
    workspaceValidationOptions(options)
  );
  return {
    workspaceDir: activePath,
    isDefault: workspacePolicy.samePath(activePath, PROJECT_ROOT),
    approvedFolders: prefs.approvedFolders,
  };
}

function approveWorkspace(folderPath, options = {}) {
  const approved = workspacePolicy.validateWorkspaceCandidate(
    folderPath,
    workspaceValidationOptions(options)
  );
  const cur = loadPrefs();
  const approvedFolders = workspacePolicy.normalizeApprovedFolders([
    ...cur.approvedFolders,
    approved,
  ]);
  const next = {
    ...cur,
    workspaceDir: approved.path,
    approvedFolders,
  };
  writePrefs(next);
  return getWorkspaceState(options);
}

function setWorkspace(folderPath, options = {}) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    throw new workspacePolicy.WorkspacePolicyError(
      'WORKSPACE_INVALID_PATH',
      'A workspace path is required.'
    );
  }

  const cur = loadPrefs();
  if (workspacePolicy.samePath(path.resolve(folderPath), PROJECT_ROOT)) {
    writePrefs({ ...cur, workspaceDir: '' });
    return getWorkspaceState(options);
  }

  const approved = workspacePolicy.findApprovedFolder(cur.approvedFolders, folderPath);
  if (!approved) {
    throw new workspacePolicy.WorkspacePolicyError(
      'WORKSPACE_NOT_APPROVED',
      'The folder has not been approved by the user.'
    );
  }
  const validated = workspacePolicy.validateWorkspaceCandidate(
    approved.path,
    workspaceValidationOptions(options)
  );
  writePrefs({ ...cur, workspaceDir: validated.path });
  return getWorkspaceState(options);
}

function removeWorkspace(folderPath, options = {}) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    throw new workspacePolicy.WorkspacePolicyError(
      'WORKSPACE_INVALID_PATH',
      'A workspace path is required.'
    );
  }

  const cur = loadPrefs();
  const approvedFolders = cur.approvedFolders.filter(
    (entry) => !workspacePolicy.samePath(entry.path, path.resolve(folderPath))
  );
  const removedActive = cur.workspaceDir
    && workspacePolicy.samePath(cur.workspaceDir, path.resolve(folderPath));
  writePrefs({
    ...cur,
    workspaceDir: removedActive ? '' : cur.workspaceDir,
    approvedFolders,
  });
  return getWorkspaceState(options);
}

// ===== 連線測試 =====

async function testConnection() {
  const key = loadApiKey();
  if (!key) return { ok: false, error: '尚未儲存 API Key' };

  const prefs = loadPrefs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000); // 10 秒逾時
  try {
    const res = await fetch(`${prefs.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}：${txt.slice(0, 120) || res.statusText}` };
    }
    const data = await res.json().catch(() => null);
    const modelCount = data?.data?.length || 0;
    return { ok: true, modelCount };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: '連線逾時（超過 10 秒沒回應）' };
    return { ok: false, error: `連線失敗：${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  saveApiKey,
  loadApiKey,
  hasApiKey,
  clearApiKey,
  loadPrefs,
  savePrefs,
  saveUsage,
  getWorkspaceState,
  approveWorkspace,
  setWorkspace,
  removeWorkspace,
  testConnection,
  saveSecret,
  loadSecret,
  hasSecret,
  clearSecret,
  DEFAULT_PREFS,
};
