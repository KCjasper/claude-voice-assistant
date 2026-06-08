// preload.js — 安全的 IPC 橋

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ===== 視窗控制 =====
  closeWindow: () => ipcRenderer.send('window:close'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  expandToFullscreen: () => ipcRenderer.send('window:expand'),
  collapseToFloating: () => ipcRenderer.send('window:collapse'),

  // ===== 設定視窗 =====
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),

  // ===== 偏好設定 =====
  getPrefs: () => ipcRenderer.invoke('config:get-prefs'),
  savePrefs: (partial) => ipcRenderer.invoke('config:save-prefs', partial),

  // ===== API Key（加密）=====
  saveApiKey: (key) => ipcRenderer.invoke('config:save-api-key', key),
  hasApiKey: () => ipcRenderer.invoke('config:has-api-key'),
  clearApiKey: () => ipcRenderer.invoke('config:clear-api-key'),
  testConnection: () => ipcRenderer.invoke('config:test-connection'),

  // ===== 通用加密 secret（搜尋 key 等）=====
  saveSecret: (name, value) => ipcRenderer.invoke('config:save-secret', name, value),
  hasSecret: (name) => ipcRenderer.invoke('config:has-secret', name),
  clearSecret: (name) => ipcRenderer.invoke('config:clear-secret', name),

  // ===== 音訊 =====
  saveRecording: (uint8) => ipcRenderer.invoke('audio:save-recording', uint8),

  // ===== 語音轉文字 =====
  transcribe: (wavPath, opts) => ipcRenderer.invoke('stt:transcribe', wavPath, opts || {}),
  onSttProgress: (callback) => {
    ipcRenderer.on('stt:progress', (_e, p) => callback(p));
  },

  // ===== 文字轉語音 =====
  speak: (text, opts) => ipcRenderer.invoke('tts:speak', text, opts || {}),
  listElevenVoices: () => ipcRenderer.invoke('tts:list-eleven-voices'),

  // ===== AI 對話 =====
  chat: (text, opts) => ipcRenderer.invoke('ai:chat', text, opts || {}),
  resetConversation: () => ipcRenderer.invoke('ai:reset'),
  onAiProgress: (callback) => {
    ipcRenderer.on('ai:progress', (_e, p) => callback(p));
  },

  // ===== 全域熱鍵推送 =====
  onHotkeyToggleRecord: (callback) => {
    ipcRenderer.on('hotkey:toggle-record', () => callback());
  },
});
