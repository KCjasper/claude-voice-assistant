// main.js — Electron 主程序
// 管理三個視窗：floating（浮窗）、fullscreen（Ops Center）、settings（設定）

const { app, BrowserWindow, screen, ipcMain, globalShortcut, dialog } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const store = require('./src/config/store');
const workspaceIpc = require('./src/config/workspace-ipc');
const {
  HotkeyManager,
  registerHotkeyIpc,
  savePreferencesWithHotkey,
} = require('./src/config/hotkey-manager');
const whisper = require('./src/stt/whisper');
const tts = require('./src/tts/speak');
const eleven = require('./src/tts/elevenlabs');
const engine = require('./src/ai/engine');
const {
  ModelCatalogService,
  resolveModel,
} = require('./src/ai/model-catalog');
const usageLedger = require('./src/usage/ledger');
const usagePolicy = require('./src/usage/policy');
const { BudgetManager } = require('./src/usage/budget-manager');
const cancellation = require('./src/tasks/cancellation');
const interruption = require('./src/tasks/interrupt');
const { SessionManager } = require('./src/session/session-manager');
const { WakeWordService } = require('./src/wake-word/wake-word-service');
const {
  ACCESS_KEY_SECRET,
  registerWakeWordIpc,
  sanitizeConfig: sanitizeWakeWordConfig,
} = require('./src/wake-word/wake-word-ipc');
const connectorRegistry = require('./src/connectors/default-registry');
const { registerConnectorIpc } = require('./src/connectors/connector-ipc');
const { RemoteServer } = require('./src/remote/remote-server');
const { registerRemoteIpc } = require('./src/remote/remote-ipc');

const FLOATING_W = 340, FLOATING_H = 520, EDGE = 24;
const FULLSCREEN_PADDING = 0;
const SETTINGS_W = 520, SETTINGS_H = 720;

let floatingWindow = null;
let fullscreenWindow = null;
let settingsWindow = null;
let sessionManager = null;
let remoteServer = null;

function updateSession(method, ...args) {
  try {
    const snapshot = sessionManager?.[method](...args) || null;
    if (snapshot) remoteServer?.broadcastSession(snapshot);
    return snapshot;
  } catch (error) {
    console.error(`Session ${method} failed:`, error);
    return null;
  }
}

const taskRegistry = new cancellation.TaskRegistry({
  onState: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      try { window.webContents.send('task:state', state); } catch {}
    }
  },
});
const budgetManager = new BudgetManager();
const modelCatalog = new ModelCatalogService({
  getBaseUrl: () => store.loadPrefs().baseUrl,
  getApiKey: () => store.loadApiKey(),
});
const hotkeyManager = new HotkeyManager({
  globalShortcut,
  getWindows: () => BrowserWindow.getAllWindows(),
  onTrigger: () => {
    if (!floatingWindow) return;
    if (!floatingWindow.isVisible()) floatingWindow.show();
    floatingWindow.webContents.send('hotkey:toggle-record');
  },
});
const wakeWordService = new WakeWordService({
  getConfig: () => store.loadPrefs(),
  getAccessKey: () => store.loadSecret(ACCESS_KEY_SECRET),
  onState: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      try { window.webContents.send('wake-word:state', state); } catch {}
    }
  },
  onWake: (detection) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      try { window.webContents.send('wake-word:detected', detection); } catch {}
    }
    if (!floatingWindow || floatingWindow.isDestroyed()) return;
    if (!floatingWindow.isVisible()) floatingWindow.show();
    floatingWindow.webContents.send('hotkey:toggle-record');
  },
});
connectorRegistry.setEventSink((payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try { window.webContents.send('connector:event', payload); } catch {}
  }
});

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
  fullscreenWindow.webContents.on('before-input-event', (event, input) => {
    if (!interruption.isInterruptInput(input)) return;
    event.preventDefault();
    interruptApp();
  });
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
  let validatedPartial = partial;
  try {
    if (partial && Object.keys(partial).some((key) => key.startsWith('wakeWord'))) {
      validatedPartial = {
        ...partial,
        ...sanitizeWakeWordConfig(partial),
      };
    }
  } catch (error) {
    return { ok: false, code: 'WAKE_CONFIG_INVALID', error: error.message };
  }
  const result = savePreferencesWithHotkey({
    partial: validatedPartial,
    manager: hotkeyManager,
    store,
  });
  if (result?.ok === false) return result;
  if (
    validatedPartial
    && Object.keys(validatedPartial).some((key) => key.startsWith('wakeWord'))
  ) {
    wakeWordService.configure(result);
  }
  return result;
});

workspaceIpc.registerWorkspaceIpc({
  ipcMain,
  dialog,
  BrowserWindow,
  store,
});
registerHotkeyIpc({ ipcMain, manager: hotkeyManager, store });
registerWakeWordIpc({
  ipcMain,
  dialog,
  store,
  service: wakeWordService,
});
registerConnectorIpc({
  ipcMain,
  taskRegistry,
  registry: connectorRegistry,
});
registerRemoteIpc({
  ipcMain,
  store,
  getServer: () => remoteServer,
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

ipcMain.handle('ai:list-models', async (event, options = {}) => {
  const prefs = store.loadPrefs();
  try {
    const catalog = await modelCatalog.getCatalog({
      force: options.force === true,
      monthlyCapUsd: prefs.monthlyCapUsd,
    });
    return { ok: true, ...catalog };
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'MODEL_CATALOG_FAILED',
      error: error.message,
    };
  }
});

// ========== IPC：通用加密 secret（搜尋 key 等）==========
ipcMain.handle('config:save-secret', async (event, name, value) => {
  try { store.saveSecret(name, value); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('config:has-secret', async (event, name) => store.hasSecret(name));
ipcMain.handle('config:clear-secret', async (event, name) => { store.clearSecret(name); return { ok: true }; });

// ========== IPC: cancellable task control ==========
function cancelTasks(type, requestId) {
  const cancelled = taskRegistry.cancel({ type, id: requestId });
  return { ok: true, cancelled, count: cancelled.length };
}

function interruptApp() {
  return interruption.interruptRuntime({
    taskRegistry,
    windows: BrowserWindow.getAllWindows(),
  });
}

ipcMain.handle('task:cancel', async (event, target = {}) => {
  return cancelTasks(target.type, target.requestId);
});
ipcMain.handle('ai:cancel', async (event, requestId) => cancelTasks('ai', requestId));
ipcMain.handle('stt:cancel', async (event, requestId) => cancelTasks('stt', requestId));
ipcMain.handle('tts:cancel', async (event, requestId) => cancelTasks('tts', requestId));

// 全面中斷：取消後端任務，並通知所有 renderer 停止已合成或正在播放的 TTS。
ipcMain.handle('app:interrupt', async () => {
  return interruptApp();
});

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
async function transcribeAudio(
  wavPath,
  opts = {},
  onProgress = () => {},
  onTaskStart = () => {}
) {
  const prefs = store.loadPrefs();
  const model = (opts && opts.model) || prefs.sttModel || 'medium-q5';
  const task = taskRegistry.start('stt');
  try { onTaskStart({ type: 'stt', requestId: task.id }); } catch {}
  let status = 'failed';

  try {
    const result = await whisper.transcribe(wavPath, {
      model,
      language: (opts && opts.language) || 'zh',
      prompt: opts && opts.prompt,
      gpu: prefs.sttUseGpu !== false,
      signal: task.signal,
      onProgress: (p) => {
        try { onProgress({ ...p, requestId: task.id }); } catch {}
      },
    });

    if (task.signal.aborted || result.cancelled) {
      status = 'cancelled';
      return cancellation.cancelledResult(task.id);
    }

    status = result.ok ? 'completed' : 'failed';
    return { ...result, requestId: task.id };
  } catch (error) {
    if (cancellation.isAbortError(error) || task.signal.aborted) {
      status = 'cancelled';
      return cancellation.cancelledResult(task.id);
    }
    return { ok: false, requestId: task.id, error: error.message };
  } finally {
    // Remove temporary audio and whisper output even when cancelled.
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      const txt = wavPath.replace(/\.wav$/i, '.txt');
      if (fs.existsSync(txt)) fs.unlinkSync(txt);
    } catch {}
    taskRegistry.finish(task.id, status);
  }
}

ipcMain.handle('stt:transcribe', async (event, wavPath, opts) => (
  transcribeAudio(wavPath, opts, (progress) => {
    try { event.sender.send('stt:progress', progress); } catch {}
  })
));

// ========== IPC：TTS 語音合成（依引擎路由）==========
async function synthesizeSpeech(text, opts = {}, onTaskStart = () => {}) {
  const prefs = store.loadPrefs();
  const engineName = opts.engine || prefs.ttsEngine || 'edge';
  let reservation = null;
  let estimatedTts = null;
  if (engineName === 'elevenlabs') {
    estimatedTts = eleven.estimateCost(
      text,
      prefs.elevenLabsCostPer1KCharsUsd
    );
    if (
      Number(prefs.monthlyCapUsd) > 0
      && estimatedTts.characters > 0
      && estimatedTts.cost <= 0
    ) {
      return {
        ok: false,
        code: 'TTS_PRICE_UNKNOWN',
        error: 'ElevenLabs pricing must be configured while the spending cap is enabled.',
      };
    }
    reservation = budgetManager.reserve({
      usage: prefs.usage,
      monthlyCapUsd: prefs.monthlyCapUsd,
      requestedUsd: estimatedTts.cost,
      provider: 'elevenlabs',
      allowPartial: false,
    });
    if (!reservation.ok) return reservation;
  }
  const task = taskRegistry.start('tts');
  try { onTaskStart({ type: 'tts', requestId: task.id }); } catch {}
  let status = 'failed';

  try {
    const result = engineName === 'elevenlabs'
      ? await eleven.synthesize(text, {
          voiceId: opts.voiceId || prefs.elevenVoiceId,
          model: opts.model || prefs.elevenModel,
          signal: task.signal,
        })
      : await tts.synthesize(text, {
          voice: opts.voice || prefs.ttsVoice,
          rate: opts.rate || prefs.ttsRate,
          signal: task.signal,
        });

    if (task.signal.aborted || result.cancelled) {
      status = 'cancelled';
      return cancellation.cancelledResult(task.id);
    }

    status = result.ok ? 'completed' : 'failed';
    if (!result.ok || engineName !== 'elevenlabs') {
      return { ...result, requestId: task.id };
    }

    const latestPrefs = store.loadPrefs();
    const usage = usageLedger.recordUsage(latestPrefs.usage, {
      provider: 'elevenlabs',
      cost: estimatedTts.cost,
      characters: estimatedTts.characters,
    });
    store.saveUsage(usage);
    return {
      ...result,
      requestId: task.id,
      requestCost: estimatedTts.cost,
      usageRecorded: true,
      usageSummary: usageLedger.capStatus(usage, latestPrefs.monthlyCapUsd),
    };
  } catch (error) {
    if (cancellation.isAbortError(error) || task.signal.aborted) {
      status = 'cancelled';
      return cancellation.cancelledResult(task.id);
    }
    return { ok: false, requestId: task.id, error: error.message };
  } finally {
    budgetManager.release(reservation?.id);
    taskRegistry.finish(task.id, status);
  }
}

ipcMain.handle('tts:speak', async (event, text, opts = {}) => (
  synthesizeSpeech(text, opts)
));

// 列出 ElevenLabs 帳號可用聲音
ipcMain.handle('tts:list-eleven-voices', async () => await eleven.listVoices());

// ========== IPC：AI 對話（Claw Router agent loop）==========
async function chatWithAssistant(
  text,
  opts = {},
  onProgress = () => {},
  onTaskStart = () => {}
) {
  if (taskRegistry.hasType('ai')) {
    return { ok: false, code: 'AI_BUSY', error: 'AI is already processing another request.' };
  }

  const prefs = store.loadPrefs();
  let availableModels = null;
  let catalogError = null;
  try {
    const catalog = await modelCatalog.getCatalog({
      monthlyCapUsd: prefs.monthlyCapUsd,
    });
    availableModels = catalog.models;
  } catch (error) {
    catalogError = {
      code: error.code || 'MODEL_CATALOG_FAILED',
      error: error.message,
    };
  }
  const routing = resolveModel({
    requestedModel: opts && opts.model,
    defaultModel: prefs.defaultModel,
    modelRouting: prefs.modelRouting,
    monthlyCapUsd: prefs.monthlyCapUsd,
    text,
    availableModels,
  });
  if (!routing.ok) {
    return {
      ok: false,
      code: routing.code,
      error: routing.error,
      routing,
      catalogError,
    };
  }
  const model = routing.model;
  const clientTurnId = opts && opts.clientTurnId;
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

  const reservation = budgetManager.reserve({
    usage: prefs.usage,
    monthlyCapUsd: prefs.monthlyCapUsd,
    requestedUsd: prefs.maxAiRequestUsd,
    provider: 'ai',
    allowPartial: true,
  });
  if (!reservation.ok) return reservation;

  const task = taskRegistry.start('ai');
  try { onTaskStart({ type: 'ai', requestId: task.id }); } catch {}
  const sessionTurn = updateSession('startTurn', text, { clientTurnId });
  let status = 'failed';
  try {
    const result = await engine.chat(text, {
      model,
      maxCostUsd: reservation.amountUsd,
      maxOutputTokens: prefs.maxAiOutputTokens,
      requestId: task.id,
      signal: task.signal,
      onProgress: (p) => {
        updateSession('progress', sessionTurn?.id, p);
        try {
          onProgress({
            ...p,
            requestId: task.id,
            clientTurnId,
          });
        } catch {}
      },
    });

    if (task.signal.aborted || result.cancelled) {
      status = 'cancelled';
      updateSession('failTurn', sessionTurn?.id, 'Request cancelled');
      return cancellation.cancelledResult(task.id);
    }

    if (!result.ok) {
      updateSession('failTurn', sessionTurn?.id, result.error || 'Request failed');
      if (Number(result.cost) > 0 && result.usage) {
        const latestPrefs = store.loadPrefs();
        const usage = usageLedger.recordUsage(latestPrefs.usage, {
          provider: 'ai',
          cost: result.cost,
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
        });
        store.saveUsage(usage);
        return {
          ...result,
          requestId: task.id,
          usageRecorded: true,
          usageSummary: usageLedger.capStatus(usage, latestPrefs.monthlyCapUsd),
        };
      }
      return { ...result, requestId: task.id };
    }

    const latestPrefs = store.loadPrefs();
    const usage = usageLedger.recordUsage(latestPrefs.usage, {
      provider: 'ai',
      cost: result.cost,
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
    });
    store.saveUsage(usage);

    status = 'completed';
    const response = {
      ...result,
      requestId: task.id,
      clientTurnId,
      requestCost: result.cost,
      cost: undefined,
      usageRecorded: true,
      usageSummary: usageLedger.capStatus(usage, latestPrefs.monthlyCapUsd),
      routing,
      catalogError,
    };
    updateSession('completeTurn', sessionTurn?.id, response);
    return { ...response, turnId: sessionTurn?.id || null };
  } catch (error) {
    if (cancellation.isAbortError(error) || task.signal.aborted) {
      status = 'cancelled';
      updateSession('failTurn', sessionTurn?.id, 'Request cancelled');
      return cancellation.cancelledResult(task.id);
    }
    updateSession('failTurn', sessionTurn?.id, error.message);
    return { ok: false, requestId: task.id, error: error.message };
  } finally {
    budgetManager.release(reservation.id);
    taskRegistry.finish(task.id, status);
  }
}

ipcMain.handle('ai:chat', async (event, text, opts) => (
  chatWithAssistant(text, opts, (progress) => {
    try { event.sender.send('ai:progress', progress); } catch {}
  })
));

ipcMain.handle('ai:reset', async () => {
  const cancelled = taskRegistry.cancel({ type: 'ai' });
  engine.resetConversation();
  updateSession('reset');
  return { ok: true, cancelled };
});

ipcMain.on('session:update', (event, snapshot) => {
  wakeWordService.setActivity(snapshot?.state);
  updateSession('applyRendererSnapshot', snapshot);
});
ipcMain.handle('session:get', () => sessionManager?.snapshot() || { state: 'idle', convo: [] });

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

  app.whenReady().then(async () => {
    cleanupOldRecordings();
    sessionManager = new SessionManager({
      filePath: path.join(app.getPath('userData'), 'session.json'),
      getWindows: () => BrowserWindow.getAllWindows(),
    });
    engine.hydrateConversation(sessionManager.conversationHistory());
    remoteServer = new RemoteServer({
      staticDir: path.join(__dirname, 'mobile'),
      handlers: {
        chat: ({ text, options, onProgress, onTaskStart }) => (
          chatWithAssistant(text, options, onProgress, onTaskStart)
        ),
        transcribe: ({ audio, options, onProgress, onTaskStart }) => {
          const filePath = path.join(
            getRecordingDir(),
            `remote-${Date.now()}-${crypto.randomUUID()}.wav`
          );
          fs.writeFileSync(filePath, audio);
          return transcribeAudio(filePath, options, onProgress, onTaskStart);
        },
        speak: ({ text, options, onTaskStart }) => (
          synthesizeSpeech(text, options, onTaskStart)
        ),
        interrupt: () => interruptApp(),
        cancelTask: ({ type, requestId }) => cancelTasks(type, requestId),
        getSession: () => sessionManager?.snapshot() || null,
      },
      onState: (state) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          try { window.webContents.send('remote:state', state); } catch {}
        }
      },
    });
    createFloatingWindow();

    // 允許麥克風（不彈權限請求）
    floatingWindow.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
      if (perm === 'media' || perm === 'mediaKeySystem') return cb(true);
      cb(false);
    });

    const accelerator = store.loadPrefs().pttHotkey;
    const hotkey = hotkeyManager.setAccelerator(accelerator);
    if (!hotkey.ok) {
      hotkeyManager.markStartupFailure(accelerator, hotkey.error);
    }
    wakeWordService.configure(store.loadPrefs());
    const remotePrefs = store.loadPrefs();
    if (remotePrefs.remoteEnabled) {
      const result = await remoteServer.start({
        host: '0.0.0.0',
        port: remotePrefs.remotePort,
      });
      if (!result.ok) {
        store.savePrefs({ remoteEnabled: false });
        console.error('Remote server startup failed:', result.error);
      }
    }
  });

  app.on('will-quit', () => {
    taskRegistry.cancel();
    hotkeyManager.stop();
    wakeWordService.stop();
    void remoteServer?.stop();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createFloatingWindow();
  });
}
