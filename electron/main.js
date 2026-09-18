import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { scanProject, readTextFile, writeTextFile } from './scanner.js';
import { discoverPlugins } from './plugins.js';
import pty from 'node-pty';

const execAsync = promisify(exec);
const terminals = new Map();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NIZYLA_DEV === '1';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    title: 'NiZyLa',
    backgroundColor: '#15141b',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' }
      ]
    },
    { role: 'windowMenu' },
    { role: 'help' }
  ]));
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open project folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return scanProject(result.filePaths[0]);
});

ipcMain.handle('project:scan', async (_event, rootPath) => scanProject(rootPath));
ipcMain.handle('file:read', async (_event, filePath) => readTextFile(filePath));
ipcMain.handle('file:write', async (_event, filePath, content) => writeTextFile(filePath, content));
ipcMain.handle('file:create', async (_event, filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '', { flag: 'wx' });
  return { ok: true, path: filePath };
});
ipcMain.handle('folder:create', async (_event, folderPath) => {
  await fs.mkdir(folderPath, { recursive: true });
  return { ok: true, path: folderPath };
});
ipcMain.handle('path:delete', async (_event, targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: false });
  return { ok: true, path: targetPath };
});
ipcMain.handle('terminal:create', (event, cwd) => {
  const id = crypto.randomUUID();
  const shell = process.env.SHELL || '/bin/bash';
  const terminal = pty.spawn(shell, ['--login'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  terminals.set(id, terminal);
  terminal.onData((data) => event.sender.send('terminal:data', id, data));
  terminal.onExit(() => {
    terminals.delete(id);
    event.sender.send('terminal:exit', id);
  });
  return id;
});
ipcMain.on('terminal:input', (_event, id, data) => terminals.get(id)?.write(data));
ipcMain.on('terminal:resize', (_event, id, cols, rows) => terminals.get(id)?.resize(cols, rows));
ipcMain.on('terminal:close', (_event, id) => terminals.get(id)?.kill());

ipcMain.handle('terminal:run', async (_event, command, cwd) => {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message, code: error.code ?? 1 };
  }
});
ipcMain.handle('plugins:list', async (_event, rootPaths) => discoverPlugins(rootPaths));
