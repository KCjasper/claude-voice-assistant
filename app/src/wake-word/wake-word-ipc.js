'use strict';

const path = require('path');

const ACCESS_KEY_SECRET = 'picovoice-access-key';
const CONFIG_KEYS = new Set([
  'wakeWordEnabled',
  'wakeWordSensitivity',
  'wakeWordDeviceIndex',
  'wakeWordKeywordPath',
  'wakeWordModelPath',
]);

function sanitizeConfig(partial = {}) {
  const next = {};
  for (const key of CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) next[key] = partial[key];
  }
  if (
    Object.prototype.hasOwnProperty.call(next, 'wakeWordEnabled')
    && typeof next.wakeWordEnabled !== 'boolean'
  ) {
    throw new Error('wakeWordEnabled must be a boolean.');
  }
  if (Object.prototype.hasOwnProperty.call(next, 'wakeWordSensitivity')) {
    const value = Number(next.wakeWordSensitivity);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('wakeWordSensitivity must be between 0 and 1.');
    }
    next.wakeWordSensitivity = value;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'wakeWordDeviceIndex')) {
    const value = Number(next.wakeWordDeviceIndex);
    if (!Number.isInteger(value) || value < -1) {
      throw new Error('wakeWordDeviceIndex must be -1 or a valid device index.');
    }
    next.wakeWordDeviceIndex = value;
  }
  for (const [key, extension] of [
    ['wakeWordKeywordPath', '.ppn'],
    ['wakeWordModelPath', '.pv'],
  ]) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    if (typeof next[key] !== 'string') throw new Error(`${key} must be a path string.`);
    const value = next[key].trim();
    if (value && (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== extension)) {
      throw new Error(`${key} must be an absolute ${extension} file path.`);
    }
    next[key] = value;
  }
  return next;
}

function registerWakeWordIpc({ ipcMain, dialog, store, service }) {
  ipcMain.handle('wake-word:get', () => ({
    ok: true,
    accessKeyConfigured: store.hasSecret(ACCESS_KEY_SECRET),
    ...service.state(),
  }));
  ipcMain.handle('wake-word:list-devices', () => service.listDevices());
  ipcMain.handle('wake-word:set-config', (event, partial) => {
    try {
      const prefs = store.savePrefs(sanitizeConfig(partial));
      return {
        ok: true,
        accessKeyConfigured: store.hasSecret(ACCESS_KEY_SECRET),
        ...service.configure(prefs),
      };
    } catch (error) {
      return { ok: false, code: 'WAKE_CONFIG_INVALID', error: error.message };
    }
  });
  ipcMain.handle('wake-word:set-access-key', (event, accessKey) => {
    try {
      store.saveSecret(ACCESS_KEY_SECRET, accessKey);
      return {
        ok: true,
        accessKeyConfigured: true,
        ...service.configure(store.loadPrefs()),
      };
    } catch (error) {
      return { ok: false, code: 'WAKE_ACCESS_KEY_SAVE_FAILED', error: error.message };
    }
  });
  ipcMain.handle('wake-word:clear-access-key', () => {
    store.clearSecret(ACCESS_KEY_SECRET);
    return {
      ok: true,
      accessKeyConfigured: false,
      ...service.configure(store.loadPrefs()),
    };
  });
  ipcMain.handle('wake-word:choose-keyword', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Porcupine keyword', extensions: ['ppn'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, cancelled: true, ...service.state() };
    }
    const prefs = store.savePrefs({ wakeWordKeywordPath: result.filePaths[0] });
    return {
      ok: true,
      path: result.filePaths[0],
      accessKeyConfigured: store.hasSecret(ACCESS_KEY_SECRET),
      ...service.configure(prefs),
    };
  });
  ipcMain.handle('wake-word:retry', () => ({
    ok: true,
    accessKeyConfigured: store.hasSecret(ACCESS_KEY_SECRET),
    ...service.configure(store.loadPrefs()),
  }));
}

module.exports = {
  ACCESS_KEY_SECRET,
  registerWakeWordIpc,
  sanitizeConfig,
};
