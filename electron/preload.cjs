const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nizyla', {
  openProject: () => ipcRenderer.invoke('project:open'),
  scanProject: (rootPath) => ipcRenderer.invoke('project:scan', rootPath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  readFileDataUrl: (filePath) => ipcRenderer.invoke('file:read-data-url', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
  createFile: (filePath) => ipcRenderer.invoke('file:create', filePath),
  createFolder: (folderPath) => ipcRenderer.invoke('folder:create', folderPath),
  deletePath: (targetPath) => ipcRenderer.invoke('path:delete', targetPath),
  movePath: (sourcePath, targetFolderPath) => ipcRenderer.invoke('path:move', sourcePath, targetFolderPath),
  createTerminal: (cwd) => ipcRenderer.invoke('terminal:create', cwd),
  terminalInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  closeTerminal: (id) => ipcRenderer.send('terminal:close', id),
  onTerminalData: (callback) => {
    const handler = (_event, id, data) => callback(id, data);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event, id) => callback(id);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },
  runCommand: (command, cwd) => ipcRenderer.invoke('terminal:run', command, cwd),
  listPlugins: (rootPaths) => ipcRenderer.invoke('plugins:list', rootPaths),
  openDetachedWindow: (config) => ipcRenderer.invoke('detached:open', config),
  getDetachedState: (windowId) => ipcRenderer.invoke('detached:get-state', windowId),
  updateDetachedState: (windowId, state) => ipcRenderer.send('detached:update-state', windowId, state),
  dockDetachedWindow: (windowId, state) => ipcRenderer.send('detached:dock', windowId, state),
  closeDetachedWindow: (windowId) => ipcRenderer.invoke('detached:close-window', windowId),
  openFileInMainWindow: (file) => ipcRenderer.send('detached:open-file-in-main', file),
  onDetachedDockBack: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('detached:dock-back', handler);
    return () => ipcRenderer.removeListener('detached:dock-back', handler);
  },
  onDetachedClosed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('detached:closed', handler);
    return () => ipcRenderer.removeListener('detached:closed', handler);
  },
  onMainOpenFile: (callback) => {
    const handler = (_event, file) => callback(file);
    ipcRenderer.on('main:open-file', handler);
    return () => ipcRenderer.removeListener('main:open-file', handler);
  },
  syncFolderToMainWindow: (folderPath) => ipcRenderer.send('detached:sync-folder-to-main', folderPath),
  onMainSyncFolder: (callback) => {
    const handler = (_event, folderPath) => callback(folderPath);
    ipcRenderer.on('main:sync-folder', handler);
    return () => ipcRenderer.removeListener('main:sync-folder', handler);
  }
});
