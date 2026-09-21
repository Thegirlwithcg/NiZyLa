import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { scanProject, readTextFile, readFileDataUrl, writeTextFile } from './scanner.js';
import { discoverPlugins } from './plugins.js';

const execAsync = promisify(exec);
let ptyModule;
const terminals = new Map();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NIZYLA_DEV === '1';
if (isDev) app.setPath('userData', path.join(app.getPath('temp'), 'nizyla-dev'));
const iconFile = process.platform === 'win32' ? 'Logo NiZyLa.ico' : 'Logo NiZyLa.png';
const appIconPath = isDev
  ? path.join(__dirname, '..', 'resource', iconFile)
  : path.join(process.resourcesPath, 'resource', iconFile);

let mainWindow;
const detachedWindows = new Map();
const detachedStates = new Map();

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return Math.sign(diff);
  }

  return 0;
}

async function readPackageJson() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const content = await fs.readFile(packagePath, 'utf8');
  return JSON.parse(content);
}

async function checkForNpmUpdate() {
  if (isDev || process.env.NIZYLA_DISABLE_UPDATE_CHECK === '1') return;

  try {
    const packageJson = await readPackageJson();
    const packageName = packageJson.name;
    const currentVersion = packageJson.version;
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      headers: { accept: 'application/json' }
    });

    if (!response.ok) return;

    const latest = await response.json();
    const latestVersion = latest.version;
    if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) return;

    const updateCommand = `npm install -g ${packageName}@latest`;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'NiZyLa update available',
      message: `NiZyLa ${latestVersion} is available`,
      detail: `You are using ${currentVersion}. To update, run:\n\n${updateCommand}`,
      buttons: ['Later', 'Copy update command', 'Open npm page'],
      defaultId: 1,
      cancelId: 0
    });

    if (result.response === 1) clipboard.writeText(updateCommand);
    if (result.response === 2) shell.openExternal(`https://www.npmjs.com/package/${packageName}`);
  } catch (error) {
    console.warn('Update check failed:', error.message);
  }
}

async function loadNodePty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = await import('node-pty');
  } catch (error) {
    console.warn('node-pty is unavailable; integrated terminal disabled:', error.message);
    ptyModule = null;
  }
  return ptyModule;
}

async function getShellConfig() {
  if (process.platform === 'win32') {
    const shell = process.env.COMSPEC || 'cmd.exe';
    return { shell, args: ['/d', '/k', 'chcp 65001 > nul'], shellName: path.basename(shell) };
  }

  const shell = process.env.SHELL || '/bin/bash';
  return { shell, args: ['--login'], shellName: path.basename(shell) };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    title: 'NiZyLa',
    icon: appIconPath,
    backgroundColor: '#15141b',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['ยกเลิก', 'ทิ้งกราฟ'],
      defaultId: 0,
      cancelId: 0,
      title: 'NiZyLa',
      message: 'มีกราฟทดลองที่ยังไม่ได้บันทึก',
      detail: 'หากปิดหน้าต่างหรือรีโหลด การเปลี่ยนแปลงทั้งหมดจะหายไป ต้องการทิ้งกราฟหรือไม่?'
    });
    if (choice === 1) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const win of detachedWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    detachedWindows.clear();
    detachedStates.clear();
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function createDetachedWindow({ windowId, type, title, bounds, state }) {
  if (detachedWindows.has(windowId)) {
    const existing = detachedWindows.get(windowId);
    if (!existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return windowId;
    }
  }

  detachedStates.set(windowId, state);

  const win = new BrowserWindow({
    width: Math.max(480, Math.round(bounds?.width || 800)),
    height: Math.max(360, Math.round(bounds?.height || 600)),
    x: bounds?.x !== undefined ? Math.round(bounds.x) : undefined,
    y: bounds?.y !== undefined ? Math.round(bounds.y) : undefined,
    minWidth: 400,
    minHeight: 280,
    title: title || `NiZyLa - ${type}`,
    icon: appIconPath,
    backgroundColor: '#15141b',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  });

  detachedWindows.set(windowId, win);

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.on('close', () => {
    const lastState = detachedStates.get(windowId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('detached:closed', { windowId, type, state: lastState });
    }
  });

  win.on('closed', () => {
    detachedWindows.delete(windowId);
    detachedStates.delete(windowId);
  });

  const queryObj = {
    detached: type,
    windowId: windowId,
    cwd: (state?.cwd || state?.project?.rootPath || '')
  };

  const queryParams = new URLSearchParams(queryObj).toString();

  if (isDev) {
    win.loadURL(`http://127.0.0.1:5174?${queryParams}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: queryObj
    });
  }

  return windowId;
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.thegirlwithcg.nizyla');

  Menu.setApplicationMenu(null);
  createWindow();
  setTimeout(() => checkForNpmUpdate(), 3000);
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
ipcMain.handle('file:read-data-url', async (_event, filePath) => readFileDataUrl(filePath));
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
ipcMain.handle('path:move', async (_event, sourcePath, targetFolderPath) => {
  const source = path.resolve(sourcePath);
  const targetFolder = path.resolve(targetFolderPath);
  const destination = path.join(targetFolder, path.basename(source));
  if (source === targetFolder || targetFolder.startsWith(`${source}${path.sep}`)) throw new Error('A folder cannot be moved into itself.');
  const targetStat = await fs.stat(targetFolder);
  if (!targetStat.isDirectory()) throw new Error('The destination must be a folder.');
  await fs.access(destination).then(() => { throw new Error(`${path.basename(source)} already exists in this folder.`); }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await fs.rename(source, destination);
  return { ok: true, path: destination };
});
ipcMain.on('window:control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (action === 'minimize') win.minimize();
  if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  if (action === 'close') win.close();
});

ipcMain.handle('terminal:create', async (event, cwd) => {
  const pty = await loadNodePty();
  if (!pty) throw new Error('Integrated terminal is unavailable because node-pty could not be installed.');

  const id = randomUUID();
  const { shell, args, shellName } = await getShellConfig();
  const targetCwd = (cwd && typeof cwd === 'string' && cwd.trim()) ? cwd.trim() : (app.getPath('home') || process.cwd());
  const terminal = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 24,
    cwd: targetCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      TERM_PROGRAM: process.env.TERM_PROGRAM,
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
      PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8'
    }
  });
  terminals.set(id, terminal);
  terminal.onData((data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('terminal:data', id, data);
    }
  });
  terminal.onExit(() => {
    terminals.delete(id);
    if (!event.sender.isDestroyed()) {
      event.sender.send('terminal:exit', id);
    }
  });
  return { id, title: shellName || 'terminal' };
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

ipcMain.handle('detached:open', async (_event, config) => {
  const windowId = config.windowId || randomUUID();
  return createDetachedWindow({ ...config, windowId });
});

ipcMain.handle('detached:get-state', async (_event, windowId) => {
  return detachedStates.get(windowId) || null;
});

ipcMain.on('detached:update-state', (_event, windowId, state) => {
  detachedStates.set(windowId, state);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('detached:state-updated', { windowId, state });
  }
});

ipcMain.on('detached:dock', (_event, windowId, state) => {
  const win = detachedWindows.get(windowId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('detached:dock-back', { windowId, state });
  }
});

ipcMain.on('detached:open-file-in-main', (_event, file) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main:open-file', file);
    mainWindow.focus();
  }
});

ipcMain.on('detached:sync-folder-to-main', (_event, folderPath) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main:sync-folder', folderPath);
  }
});

ipcMain.handle('detached:close-window', async (_event, windowId) => {
  const win = detachedWindows.get(windowId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  detachedWindows.delete(windowId);
  detachedStates.delete(windowId);
  return true;
});
