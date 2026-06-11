'use strict';

const { PROTOCOL_VERSION, validPort } = require('./remote-server');
const { getRemoteAccess } = require('./remote-access');

function registerRemoteIpc({ ipcMain, store, getServer, getTunnel }) {
  ipcMain.handle('remote:get-status', () => {
    const server = getServer();
    return server
      ? { ok: true, ...server.state() }
      : { ok: true, running: false, protocolVersion: PROTOCOL_VERSION };
  });
  ipcMain.handle('remote:get-access', async () => getRemoteAccess({
    server: getServer(),
    tunnel: getTunnel?.(),
  }));
  ipcMain.handle('remote:start', async (event, options = {}) => {
    const server = getServer();
    if (!server) return { ok: false, code: 'REMOTE_UNAVAILABLE', error: 'Remote server is unavailable.' };
    const prefs = store.loadPrefs();
    const requestedPort = options.port ?? prefs.remotePort ?? 8787;
    const port = validPort(requestedPort);
    if (!port) return { ok: false, code: 'REMOTE_PORT_INVALID', error: 'Remote port must be between 1024 and 65535.' };
    const result = await server.start({ host: '0.0.0.0', port });
    if (result.ok) store.savePrefs({ remoteEnabled: true, remotePort: port });
    return result;
  });
  ipcMain.handle('remote:stop', async () => {
    await getTunnel?.()?.stop();
    const server = getServer();
    const result = server ? await server.stop() : { ok: true, running: false };
    store.savePrefs({ remoteEnabled: false });
    return result;
  });
  ipcMain.handle('remote:start-tunnel', async (event, options = {}) => {
    const server = getServer();
    const tunnel = getTunnel?.();
    if (!server || !server.state().running) {
      return { ok: false, code: 'REMOTE_NOT_RUNNING', error: 'Start the remote server before starting a tunnel.' };
    }
    if (!tunnel) {
      return { ok: false, code: 'REMOTE_TUNNEL_UNAVAILABLE', error: 'Remote tunnel support is unavailable.' };
    }
    const prefs = store.loadPrefs();
    const binaryPath = typeof options.binaryPath === 'string' && options.binaryPath
      ? options.binaryPath
      : prefs.remoteTunnelBinaryPath || '';
    const result = await tunnel.start({
      port: server.state().port,
      binaryPath,
      acknowledgeRisk: options.acknowledgeRisk === true,
    });
    if (result.ok && binaryPath) store.savePrefs({ remoteTunnelBinaryPath: result.binaryPath });
    return result;
  });
  ipcMain.handle('remote:stop-tunnel', async () => {
    const tunnel = getTunnel?.();
    return tunnel
      ? tunnel.stop()
      : { ok: true, status: 'stopped', publicUrl: null };
  });
  ipcMain.handle('remote:rotate-token', () => {
    const server = getServer();
    return server
      ? server.rotatePairingToken()
      : { ok: false, code: 'REMOTE_UNAVAILABLE', error: 'Remote server is unavailable.' };
  });
  ipcMain.handle('remote:get-protocol', () => ({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    clientMessages: [
      'ping',
      'session.get',
      'chat.send',
      'stt.transcribe',
      'tts.synthesize',
      'request.cancel',
      'interrupt',
    ],
  }));
}

module.exports = {
  registerRemoteIpc,
};
