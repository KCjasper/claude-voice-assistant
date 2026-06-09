'use strict';

function isInterruptInput(input = {}) {
  return (
    input.type === 'keyDown'
    && String(input.key || '').toLowerCase() === 'q'
    && Boolean(input.control || input.meta)
    && !input.alt
  );
}

function interruptRuntime({ taskRegistry, windows = [], types = ['ai', 'tts', 'stt'] }) {
  const cancelled = {};
  for (const type of types) {
    cancelled[type] = taskRegistry.cancel({ type });
  }

  let notifiedWindows = 0;
  for (const window of windows) {
    if (!window || window.isDestroyed?.()) continue;
    try {
      window.webContents.send('playback:stop');
      notifiedWindows += 1;
    } catch {}
  }

  return {
    ok: true,
    cancelled,
    count: Object.values(cancelled).reduce((total, ids) => total + ids.length, 0),
    notifiedWindows,
  };
}

module.exports = { interruptRuntime, isInterruptInput };
