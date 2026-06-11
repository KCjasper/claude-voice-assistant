'use strict';

function registerConnectorIpc({ ipcMain, taskRegistry, registry }) {
  ipcMain.handle('connector:list', () => ({
    ok: true,
    connectors: registry.list(),
  }));
  ipcMain.handle('connector:set-credential', (event, connectorId, credential) => {
    try {
      return registry.setCredential(connectorId, credential);
    } catch (error) {
      return { ok: false, code: 'CONNECTOR_CREDENTIAL_SAVE_FAILED', error: error.message };
    }
  });
  ipcMain.handle('connector:clear-credential', (event, connectorId) => {
    try {
      return registry.clearCredential(connectorId);
    } catch (error) {
      return { ok: false, code: 'CONNECTOR_CREDENTIAL_CLEAR_FAILED', error: error.message };
    }
  });
  ipcMain.handle('connector:health', async (event, connectorId) => {
    const task = taskRegistry.start('connector', { connectorId, operation: 'health' });
    let status = 'failed';
    try {
      const result = await registry.health(connectorId, { signal: task.signal });
      status = result.ok ? 'completed' : 'failed';
      return { ...result, requestId: task.id };
    } catch (error) {
      if (task.signal.aborted) {
        status = 'cancelled';
        return { ok: false, code: 'CANCELLED', cancelled: true, requestId: task.id };
      }
      return { ok: false, code: 'CONNECTOR_HEALTH_FAILED', error: error.message, requestId: task.id };
    } finally {
      taskRegistry.finish(task.id, status);
    }
  });
  ipcMain.handle('connector:pending-confirmations', () => ({
    ok: true,
    confirmations: registry.pendingConfirmations(),
  }));
  ipcMain.handle('connector:approve', async (event, confirmationId) => {
    const task = taskRegistry.start('connector', { confirmationId, operation: 'approve' });
    let status = 'failed';
    try {
      const result = await registry.approve(confirmationId, {
        signal: task.signal,
        requestId: task.id,
      });
      status = result.ok ? 'completed' : 'failed';
      return { ...result, requestId: task.id };
    } catch (error) {
      if (task.signal.aborted) {
        status = 'cancelled';
        return { ok: false, code: 'CANCELLED', cancelled: true, requestId: task.id };
      }
      return { ok: false, code: 'CONNECTOR_ACTION_FAILED', error: error.message, requestId: task.id };
    } finally {
      taskRegistry.finish(task.id, status);
    }
  });
  ipcMain.handle('connector:reject', (event, confirmationId) => registry.reject(confirmationId));
}

module.exports = {
  registerConnectorIpc,
};
