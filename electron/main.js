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

function getShellConfig() {
  if (process.platform === 'win32') {
    const shell = process.env.COMSPEC || 'cmd.exe';
    return { shell, args: [] };
  }

  return { shell: process.env.SHELL || '/bin/bash', args: ['--login'] };
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.thegirlwithcg.nizyla');

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
ipcMain.handle('terminal:create', async (event, cwd) => {
  const pty = await loadNodePty();
  if (!pty) throw new Error('Integrated terminal is unavailable because node-pty could not be installed.');

  const id = randomUUID();
  const { shell, args } = getShellConfig();
  const terminal = pty.spawn(shell, args, {
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
