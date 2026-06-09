'use strict';

function clientWorkspaceState(state) {
  return {
    active: state.workspaceDir,
    folders: state.approvedFolders,
    isDefault: !!state.isDefault,
  };
}

function workspaceResult(state, extra = {}) {
  return {
    ok: true,
    ...extra,
    state,
  };
}

function workspaceError(error) {
  return {
    ok: false,
    error: error?.message || 'Workspace operation failed.',
    code: error?.code || 'WORKSPACE_ERROR',
    details: error?.details || {},
  };
}

function broadcastWorkspaceChanged(BrowserWindow, state) {
  const payload = clientWorkspaceState(state);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send('workspace:changed', payload);
    } catch {}
  }
  return payload;
}

function registerWorkspaceIpc({
  ipcMain,
  dialog,
  BrowserWindow,
  store,
}) {
  ipcMain.handle('workspace:get', async () => {
    try {
      return workspaceResult(store.getWorkspaceState());
    } catch (error) {
      return workspaceError(error);
    }
  });

  const pickWorkspace = async (event) => {
    try {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Choose workspace folder',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || !result.filePaths[0]) {
        return workspaceResult(store.getWorkspaceState(), { canceled: true });
      }

      const state = store.approveWorkspace(result.filePaths[0]);
      broadcastWorkspaceChanged(BrowserWindow, state);
      return workspaceResult(state, { canceled: false });
    } catch (error) {
      return workspaceError(error);
    }
  };
  ipcMain.handle('workspace:choose', pickWorkspace);
  ipcMain.handle('workspace:pick', pickWorkspace);

  ipcMain.handle('workspace:set', async (event, folderPath) => {
    try {
      const state = store.setWorkspace(folderPath);
      broadcastWorkspaceChanged(BrowserWindow, state);
      return workspaceResult(state);
    } catch (error) {
      return workspaceError(error);
    }
  });

  ipcMain.handle('workspace:remove', async (event, folderPath) => {
    try {
      const state = store.removeWorkspace(folderPath);
      broadcastWorkspaceChanged(BrowserWindow, state);
      return workspaceResult(state);
    } catch (error) {
      return workspaceError(error);
    }
  });
}

module.exports = {
  broadcastWorkspaceChanged,
  clientWorkspaceState,
  registerWorkspaceIpc,
  workspaceError,
  workspaceResult,
};
