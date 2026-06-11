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

  // ===== Workspace folders =====
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  setActiveWorkspace: (folderPath) => ipcRenderer.invoke('workspace:set', folderPath),
  setWorkspace: (folderPath) => ipcRenderer.invoke('workspace:set', folderPath),
  removeWorkspace: (folderPath) => ipcRenderer.invoke('workspace:remove', folderPath),
  onWorkspaceChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },

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
  listModels: (opts) => ipcRenderer.invoke('ai:list-models', opts || {}),
  resetConversation: () => ipcRenderer.invoke('ai:reset'),
  onAiProgress: (callback) => {
    ipcRenderer.on('ai:progress', (_e, p) => callback(p));
  },

  // ===== Task cancellation =====
  cancelTask: (target) => ipcRenderer.invoke('task:cancel', target || {}),
  cancelAi: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
  cancelStt: (requestId) => ipcRenderer.invoke('stt:cancel', requestId),
  cancelTts: (requestId) => ipcRenderer.invoke('tts:cancel', requestId),
  onTaskState: (callback) => {
    ipcRenderer.on('task:state', (_e, state) => callback(state));
  },
  // 全面中斷（取消後端 ai/tts/stt + 停止 renderer 播放）
  interrupt: () => ipcRenderer.invoke('app:interrupt'),
  onPlaybackStop: (callback) => ipcRenderer.on('playback:stop', () => callback()),

  // ===== Ops Center session 同步 =====
  pushSession: (snapshot) => ipcRenderer.send('session:update', snapshot),
  getSession: () => ipcRenderer.invoke('session:get'),
  onSessionState: (callback) => ipcRenderer.on('session:state', (_e, s) => callback(s)),

  // ===== 全域熱鍵推送 =====
  onHotkeyToggleRecord: (callback) => {
    ipcRenderer.on('hotkey:toggle-record', () => callback());
  },
  getPttHotkey: () => ipcRenderer.invoke('hotkey:get'),
  setPttHotkey: (accelerator) => ipcRenderer.invoke('hotkey:set', accelerator),
  onPttHotkeyChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('hotkey:changed', listener);
    return () => ipcRenderer.removeListener('hotkey:changed', listener);
  },

  // ===== Offline wake word =====
  getWakeWordState: () => ipcRenderer.invoke('wake-word:get'),
  listWakeWordDevices: () => ipcRenderer.invoke('wake-word:list-devices'),
  setWakeWordConfig: (partial) => ipcRenderer.invoke('wake-word:set-config', partial),
  setWakeWordAccessKey: (accessKey) => ipcRenderer.invoke('wake-word:set-access-key', accessKey),
  clearWakeWordAccessKey: () => ipcRenderer.invoke('wake-word:clear-access-key'),
  chooseWakeWordKeyword: () => ipcRenderer.invoke('wake-word:choose-keyword'),
  retryWakeWord: () => ipcRenderer.invoke('wake-word:retry'),
  onWakeWordState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('wake-word:state', listener);
    return () => ipcRenderer.removeListener('wake-word:state', listener);
  },
  onWakeWordDetected: (callback) => {
    const listener = (_event, detection) => callback(detection);
    ipcRenderer.on('wake-word:detected', listener);
    return () => ipcRenderer.removeListener('wake-word:detected', listener);
  },

  // ===== External connectors =====
  listConnectors: () => ipcRenderer.invoke('connector:list'),
  setConnectorCredential: (connectorId, credential) => (
    ipcRenderer.invoke('connector:set-credential', connectorId, credential)
  ),
  clearConnectorCredential: (connectorId) => (
    ipcRenderer.invoke('connector:clear-credential', connectorId)
  ),
  checkConnectorHealth: (connectorId) => ipcRenderer.invoke('connector:health', connectorId),
  getPendingConnectorConfirmations: () => ipcRenderer.invoke('connector:pending-confirmations'),
  approveConnectorAction: (confirmationId) => ipcRenderer.invoke('connector:approve', confirmationId),
  rejectConnectorAction: (confirmationId) => ipcRenderer.invoke('connector:reject', confirmationId),
  onConnectorEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('connector:event', listener);
    return () => ipcRenderer.removeListener('connector:event', listener);
  },

  // ===== Mobile remote =====
  getRemoteStatus: () => ipcRenderer.invoke('remote:get-status'),
  startRemote: (options) => ipcRenderer.invoke('remote:start', options || {}),
  stopRemote: () => ipcRenderer.invoke('remote:stop'),
  rotateRemoteToken: () => ipcRenderer.invoke('remote:rotate-token'),
  getRemoteProtocol: () => ipcRenderer.invoke('remote:get-protocol'),
  onRemoteState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('remote:state', listener);
    return () => ipcRenderer.removeListener('remote:state', listener);
  },
});
