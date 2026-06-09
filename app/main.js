// main.js — Electron 主程序
// 管理三個視窗：floating（浮窗）、fullscreen（Ops Center）、settings（設定）

const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./src/config/store');
const whisper = require('./src/stt/whisper');
const tts = require('./src/tts/speak');
const eleven = require('./src/tts/elevenlabs');
const engine = require('./src/ai/engine');
const usageLedger = require('./src/usage/ledger');
const usagePolicy = require('./src/usage/policy');

const FLOATING_W = 340, FLOATING_H = 520, EDGE = 24;
const FULLSCREEN_PADDING = 0;
const SETTINGS_W = 520, SETTINGS_H = 720;

let floatingWindow = null;
let fullscreenWindow = null;
let settingsWindow = null;
let aiChatInFlight = false;

// ========== 浮動視窗 ==========
function createFloatingWindow() {
  const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;
  floatingWindow = new BrowserWindow({
    width: FLOATING_W, height: FLOATING_H,
    x: scrW - FLOATING_W - EDGE,
    y: scrH - FLOATING_H - EDGE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingWindow.loadFile(path.join(__dirname, 'index.html'));
  floatingWindow.once('ready-to-show', () => floatingWindow.show());
  floatingWindow.on('closed', () => { floatingWindow = null; });
}

// ========== 全螢幕 Ops Center ==========
function createFullscreenWindow() {
  const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;
  fullscreenWindow = new BrowserWindow({
    width: scrW, height: scrH, x: 0, y: 0,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  fullscreenWindow.setAlwaysOnTop(true, 'screen-saver');
  fullscreenWindow.loadFile(path.join(__dirname, 'fullscreen.html'));
  fullscreenWindow.on('closed', () => { fullscreenWindow = null; });
}

// ========== 設定視窗 ==========
function createSettingsWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: scrW, height: scrH } = display.workAreaSize;
  settingsWindow = new BrowserWindow({
    width: SETTINGS_W, height: SETTINGS_H,
    x: Math.round((scrW - SETTINGS_W) / 2),
    y: Math.round((scrH - SETTINGS_H) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ========== IPC：視窗控制 ==========
ipcMain.on('window:expand', () => {
  if (!fullscreenWindow) {
    createFullscreenWindow();
    fullscreenWindow.once('ready-to-show', () => {
      fullscreenWindow.show();
      if (floatingWindow) floatingWindow.hide();
    });
  } else {
    fullscreenWindow.show();
    if (floatingWindow) floatingWindow.hide();
  }
});

ipcMain.on('window:collapse', () => {
  if (fullscreenWindow) fullscreenWindow.hide();
  if (floatingWindow) floatingWindow.show();
});

ipcMain.on('window:close', () => {
  app.quit();
});

ipcMain.on('window:minimize', () => {
  if (floatingWindow) floatingWindow.minimize();
});

// ========== IPC：設定視窗 ==========
ipcMain.on('settings:open', () => {
  if (!settingsWindow) createSettingsWindow();
  else settingsWindow.show();
});

ipcMain.on('settings:close', () => {
  if (settingsWindow) settingsWindow.close();
});

// ========== IPC：偏好讀寫 ==========
ipcMain.handle('config:get-prefs', async () => {
  return store.loadPrefs();
});

ipcMain.handle('config:save-prefs', async (event, partial) => {
  return store.savePrefs(partial);
});

// ========== IPC：API Key 加密讀寫 ==========
ipcMain.handle('config:save-api-key', async (event, key) => {
  try {
    store.saveApiKey(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('config:has-api-key', async () => {
  return store.hasApiKey();
});

ipcMain.handle('config:clear-api-key', async () => {
  store.clearApiKey();
  return { ok: true };
});

ipcMain.handle('config:test-connection', async () => {
  return await store.testConnection();
});

// ========== IPC：通用加密 secret（搜尋 key 等）==========
ipcMain.handle('config:save-secret', async (event, name, value) => {
  try { store.saveSecret(name, value); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('config:has-secret', async (event, name) => store.hasSecret(name));
ipcMain.handle('config:clear-secret', async (event, name) => { store.clearSecret(name); return { ok: true }; });

// ========== IPC：錄音檔儲存 ==========
function getRecordingDir() {
  const dir = path.join(app.getPath('temp'), 'voice-assistant', 'recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 啟動時清掃孤兒暫存檔（crash 後殘留的；正常流程會在轉錄後即時刪除）
function cleanupOldRecordings(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const dir = getRecordingDir();
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > maxAgeMs) fs.unlinkSync(fp);
      } catch {}
    }
  } catch {}
}

ipcMain.handle('audio:save-recording', async (event, uint8) => {
  try {
    const dir = getRecordingDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `rec-${ts}.wav`);
    const buf = Buffer.from(uint8);
    fs.writeFileSync(filePath, buf);

    // 從 WAV 標頭算秒數：sampleRate 在 byte 24~27、bytes per sample = 2、mono
    const sampleRate = buf.readUInt32LE(24);
    const dataBytes = buf.length - 44;
    const durationSec = dataBytes / (sampleRate * 2);

    return { ok: true, path: filePath, durationSec };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ========== IPC：Whisper 語音轉文字 ==========
ipcMain.handle('stt:transcribe', async (event, wavPath, opts) => {
  const sender = event.sender;
  const prefs = store.loadPrefs();
  const model = (opts && opts.model) || prefs.sttModel || 'medium-q5';

  const result = await whisper.transcribe(wavPath, {
    model,
    language: (opts && opts.language) || 'zh',
    prompt: opts && opts.prompt,
    gpu: prefs.sttUseGpu !== false,
    onProgress: (p) => {
      try { sender.send('stt:progress', p); } catch {}
    },
  });

  // 用完即刪：暫存錄音 + whisper 產生的同名 .txt（避免暫存資料夾無限膨脹）
  try {
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    const txt = wavPath.replace(/\.wav$/i, '.txt');
    if (fs.existsSync(txt)) fs.unlinkSync(txt);
  } catch {}

  return result;
});

// ========== IPC：TTS 語音合成（依引擎路由）==========
ipcMain.handle('tts:speak', async (event, text, opts = {}) => {
  const prefs = store.loadPrefs();
  const engineName = opts.engine || prefs.ttsEngine || 'edge';
  if (engineName === 'elevenlabs') {
    return await eleven.synthesize(text, {
      voiceId: opts.voiceId || prefs.elevenVoiceId,
      model: opts.model || prefs.elevenModel,
    });
  }
  return await tts.synthesize(text, {
    voice: opts.voice || prefs.ttsVoice,
    rate: opts.rate || prefs.ttsRate,
  });
});

// 列出 ElevenLabs 帳號可用聲音
ipcMain.handle('tts:list-eleven-voices', async () => await eleven.listVoices());

// ========== IPC：AI 對話（Claw Router agent loop）==========
ipcMain.handle('ai:chat', async (event, text, opts) => {
  if (aiChatInFlight) {
    return { ok: false, code: 'AI_BUSY', error: 'AI is already processing another request.' };
  }

  const sender = event.sender;
  const prefs = store.loadPrefs();
  const model = (opts && opts.model) || prefs.defaultModel || 'claude-sonnet-4-6';
  const policy = usagePolicy.evaluateRequest({
    usage: prefs.usage,
    monthlyCapUsd: prefs.monthlyCapUsd,
    model,
  });

  if (!policy.allowed) {
    return {
      ok: false,
      code: policy.code,
      error: policy.error,
      usageSummary: policy.usageSummary,
    };
  }

  aiChatInFlight = true;
  try {
    const result = await engine.chat(text, {
      model,
      onProgress: (p) => { try { sender.send('ai:progress', p); } catch {} },
    });

    if (!result.ok) return result;

    const latestPrefs = store.loadPrefs();
    const usage = usageLedger.recordUsage(latestPrefs.usage, {
      cost: result.cost,
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
    });
    store.saveUsage(usage);

    return {
      ...result,
      requestCost: result.cost,
      cost: undefined,
      usageRecorded: true,
      usageSummary: usageLedger.capStatus(usage, latestPrefs.monthlyCapUsd),
    };
  } finally {
    aiChatInFlight = false;
  }
});

ipcMain.handle('ai:reset', async () => {
  engine.resetConversation();
  return { ok: true };
});

// ========== IPC：Ops Center session 中繼 ==========
// 浮窗推送 session 快照 → main 暫存 → 轉發給全螢幕視窗
let lastSession = { state: 'idle', convo: [] };
ipcMain.on('session:update', (event, snapshot) => {
  lastSession = snapshot || lastSession;
  if (fullscreenWindow && !fullscreenWindow.isDestroyed()) {
    try { fullscreenWindow.webContents.send('session:state', lastSession); } catch {}
  }
});
ipcMain.handle('session:get', () => lastSession);

// ========== App 生命週期 ==========
// 單一實例鎖：避免重複啟動開出多個浮窗
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 有人想再開一次 → 聚焦既有浮窗，而不是開新的
  app.on('second-instance', () => {
    if (!floatingWindow) return;
    if (floatingWindow.isMinimized()) floatingWindow.restore();
    if (!floatingWindow.isVisible()) floatingWindow.show();
    floatingWindow.focus();
  });

  app.whenReady().then(() => {
    cleanupOldRecordings();
    createFloatingWindow();

    // 允許麥克風（不彈權限請求）
    floatingWindow.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
      if (perm === 'media' || perm === 'mediaKeySystem') return cb(true);
      cb(false);
    });

    // 全域熱鍵：Ctrl+Shift+Space = 切換錄音（之後改成喚醒詞）
    globalShortcut.register('Control+Shift+Space', () => {
      if (!floatingWindow) return;
      if (!floatingWindow.isVisible()) floatingWindow.show();
      floatingWindow.webContents.send('hotkey:toggle-record');
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createFloatingWindow();
  });
}
