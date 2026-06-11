'use strict';

class HotkeyManager {
  constructor({ globalShortcut, getWindows, onTrigger }) {
    this.globalShortcut = globalShortcut;
    this.getWindows = getWindows;
    this.onTrigger = onTrigger;
    this.accelerator = '';
    this.registered = false;
    this.error = null;
  }

  state() {
    return {
      accelerator: this.accelerator,
      registered: this.registered,
      error: this.error,
    };
  }

  broadcast() {
    const state = this.state();
    for (const window of this.getWindows()) {
      if (window.isDestroyed()) continue;
      try {
        window.webContents.send('hotkey:changed', state);
      } catch {}
    }
    return state;
  }

  setAccelerator(value) {
    const accelerator = typeof value === 'string' ? value.trim() : '';
    if (!accelerator || accelerator.length > 128 || /[\r\n\0]/.test(accelerator)) {
      return {
        ...this.state(),
        ok: false,
        code: 'HOTKEY_INVALID',
        error: 'A valid Electron accelerator is required.',
      };
    }

    if (this.registered && accelerator === this.accelerator) {
      return { ok: true, ...this.state() };
    }

    let registered = false;
    try {
      registered = this.globalShortcut.register(accelerator, () => this.onTrigger());
    } catch (error) {
      return {
        ...this.state(),
        ok: false,
        code: 'HOTKEY_REGISTRATION_FAILED',
        error: error.message,
      };
    }

    if (!registered) {
      return {
        ...this.state(),
        ok: false,
        code: 'HOTKEY_REGISTRATION_FAILED',
        error: `The shortcut ${accelerator} is unavailable or already in use.`,
      };
    }

    const previous = this.accelerator;
    if (this.registered && previous && previous !== accelerator) {
      this.globalShortcut.unregister(previous);
    }

    this.accelerator = accelerator;
    this.registered = true;
    this.error = null;
    return { ok: true, ...this.broadcast() };
  }

  markStartupFailure(accelerator, error) {
    this.accelerator = accelerator;
    this.registered = false;
    this.error = error;
    return this.broadcast();
  }

  stop() {
    if (this.registered && this.accelerator) {
      this.globalShortcut.unregister(this.accelerator);
    }
    this.registered = false;
  }
}

function registerHotkeyIpc({ ipcMain, manager, store }) {
  ipcMain.handle('hotkey:get', () => ({ ok: true, ...manager.state() }));
  ipcMain.handle('hotkey:set', (event, accelerator) => {
    const result = manager.setAccelerator(accelerator);
    if (!result.ok) return result;
    store.savePrefs({ pttHotkey: result.accelerator });
    return result;
  });
}

function savePreferencesWithHotkey({ partial, manager, store }) {
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'pttHotkey')) {
    const result = manager.setAccelerator(partial.pttHotkey);
    if (!result.ok) return result;
    return store.savePrefs({
      ...partial,
      pttHotkey: result.accelerator,
    });
  }
  return store.savePrefs(partial);
}

module.exports = {
  HotkeyManager,
  registerHotkeyIpc,
  savePreferencesWithHotkey,
};
