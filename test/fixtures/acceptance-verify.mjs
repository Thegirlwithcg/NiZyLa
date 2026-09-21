import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const screenshotDir = path.resolve('release/smoke-screenshots');
await fs.mkdir(screenshotDir, { recursive: true });

try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-accept-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// Construct document containing Example 1 (with player_name) and Example 4
const docData = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_name', name: 'player_name', type: 'string', initialValue: 'Erin' },
    { id: 'v_level', name: 'level', type: 'int', initialValue: 3 },
    { id: 'v_score', name: 'score', type: 'int', initialValue: 10 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 100 }, data: {} },
    // Example 1: formatText (fstring) + print
    { id: 'g_name', type: 'getVariable', position: { x: 50, y: 250 }, data: { variableId: 'v_name' } },
    { id: 'g_level', type: 'getVariable', position: { x: 50, y: 350 }, data: { variableId: 'v_level' } },
    { id: 'fmt1', type: 'formatText', position: { x: 260, y: 250 }, data: { style: 'fstring', template: 'Player: {player_name}, Level: {level}' } },
    { id: 'pr1', type: 'print', position: { x: 480, y: 100 }, data: { argCount: 1 } },
    // Example 4: formatText (concat) + print
    { id: 'g_score', type: 'getVariable', position: { x: 50, y: 480 }, data: { variableId: 'v_score' } },
    { id: 'fmt2', type: 'formatText', position: { x: 260, y: 480 }, data: { style: 'concat', template: 'Current score: {score} pts' } },
    { id: 'pr2', type: 'print', position: { x: 700, y: 100 }, data: { argCount: 1 } }
  ],
  edges: [
    { id: 'e0', source: 'start', sourceHandle: 'next', target: 'pr1', targetHandle: 'in' },
    { id: 'e1', source: 'g_name', sourceHandle: 'value', target: 'fmt1', targetHandle: '{player_name}' },
    { id: 'e2', source: 'g_level', sourceHandle: 'value', target: 'fmt1', targetHandle: '{level}' },
    { id: 'e3', source: 'fmt1', sourceHandle: 'value', target: 'pr1', targetHandle: 'value' },
    { id: 'e4', source: 'pr1', sourceHandle: 'next', target: 'pr2', targetHandle: 'in' },
    { id: 'e5', source: 'g_score', sourceHandle: 'value', target: 'fmt2', targetHandle: '{score}' },
    { id: 'e6', source: 'fmt2', sourceHandle: 'value', target: 'pr2', targetHandle: 'value' }
  ],
  viewport: { x: 0, y: 0, zoom: 0.85 }
};

const gcnFilePath = path.join(projectDir, 'mixed_print.gcn');
await fs.writeFile(gcnFilePath, JSON.stringify(docData, null, 2) + '\n', 'utf8');

const port = async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const val = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return val;
};

const rendererPort = await port();
const mainPort = await port();

console.log('Launching installed exe:', exePath);
const child = spawn(exePath, [
  `--inspect=127.0.0.1:${mainPort}`,
  `--remote-debugging-port=${rendererPort}`,
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  `--user-data-dir=${path.join(temp, 'profile')}`
], {
  cwd: root,
  env: { ...process.env, NIZYLA_DEV: '0', NIZYLA_DISABLE_UPDATE_CHECK: '1' },
  stdio: 'ignore'
});

async function connect(portNumber, type) {
  let targets;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${portNumber}/json`, { signal: AbortSignal.timeout(1000) })).json();
      if (targets.some((t) => t.type === type)) break;
    } catch {}
    await delay(200);
  }
  const target = targets?.find((t) => t.type === type);
  assert.ok(target, `Target of type ${type} found`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const call = pending.get(msg.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(msg.id);
    if (msg.error || msg.result?.exceptionDetails) call.reject(new Error(JSON.stringify(msg)));
    else call.resolve(msg.result);
  };
  ws.onclose = ws.onerror = () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('Debugger disconnected'));
    }
    pending.clear();
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const callId = ++id;
      const timer = setTimeout(() => { pending.delete(callId); reject(new Error(`Timeout ${method}`)); }, 20000);
      pending.set(callId, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: callId, method, params }));
    }),
    evaluate: async (expression) => {
      const callId = ++id;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(callId); reject(new Error('Timeout evaluate')); }, 20000);
        pending.set(callId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: callId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
      });
      return result.result?.value;
    },
    close: () => ws.close()
  };
}

try {
  const main = await connect(mainPort, 'node');
  await main.evaluate(`
    globalThis.testElectron = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root, 'package.json'))})('electron');
    testElectron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(projectDir)}] });
    console.log('Main hook ready');
  `);

  const ui = await connect(rendererPort, 'page');
  await ui.send('Page.bringToFront');
  await ui.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }).catch(() => {});

  async function wait(expr) {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await ui.evaluate(expr);
        if (r) return r;
      } catch {}
      await delay(150);
    }
    throw new Error(`Timed out waiting for: ${expr}`);
  }

  // Open Folder
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder');
    if (el) el.click();
  })()`);
  await delay(1000);

  // Click on mixed_print.gcn in tree
  await wait("document.querySelector('.tree-row.file .name')");
  await ui.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.tree-row.file'));
    const gcnRow = rows.find(r => r.querySelector('.name')?.textContent?.includes('mixed_print.gcn'));
    if (gcnRow) gcnRow.click();
  })()`);
  await delay(800);

  // It opens directly in Geometry Code mode!
  await wait("document.querySelector('.gcn-workspace')");
  await delay(500);

  // Fit view
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fit View'))?.click()`);
  await delay(400);

  // Verify Preview shows Python code
  const pyPreview = await ui.evaluate(`document.querySelector('.gcn-preview .cm-content')?.innerText || ''`);
  console.log('Python Preview:\n', pyPreview);
  assert.ok(pyPreview.includes('print(f"Player: {player_name}, Level: {level}")'));
  assert.ok(pyPreview.includes('print(("Current score: " + str(score) + " pts"))'));

  // Make sure Terminal panel is visible, mounted, and tall enough so all lines are visible
  await ui.evaluate(`(() => {
    // Open terminal if not open
    const termBtn = document.querySelector('button[title="Terminal"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terminal'));
    if (termBtn) termBtn.click();
    document.querySelector('.app-shell')?.style.setProperty('--terminal-height', '450px');
    window.dispatchEvent(new Event('resize'));
  })()`);
  await delay(1200);

  // Click Run button
  console.log('Clicking Run...');
  const mainLogs = [];
  await main.evaluate(`
    const origSend = testElectron.BrowserWindow.getAllWindows()[0].webContents.send;
    globalThis.sentMessages = [];
    testElectron.BrowserWindow.getAllWindows()[0].webContents.send = function(...args) {
      globalThis.sentMessages.push(args);
      return origSend.apply(this, args);
    };
  `);

  await ui.evaluate(`document.querySelector('.gcn-run-btn')?.click()`);
  await delay(2500);

  const sent = await main.evaluate(`globalThis.sentMessages`);
  console.log('Messages sent from main:', sent);

  // Inspect terminal tabs and host
  const debugTerm = await ui.evaluate(`(() => {
    const pane = document.querySelector('.terminal-pane.active');
    const xterm = pane?.querySelector('.xterm');
    const rows = pane?.querySelectorAll('.xterm-rows div');
    return {
      hasPane: !!pane,
      hasXterm: !!xterm,
      rowCount: rows ? rows.length : 0,
      rowTexts: rows ? Array.from(rows).map(r => r.textContent) : []
    };
  })()`);
  console.log('debugTerm:', debugTerm);

  // Click on the Python Run tab if not active
  await ui.evaluate(`(() => {
    const runTab = Array.from(document.querySelectorAll('.terminal-tab')).find(t => t.textContent.includes('Python Run'));
    if (runTab) runTab.click();
  })()`);
  await delay(500);

  // Wait for terminal output
  let termText = '';
  for (let i = 0; i < 30; i++) {
    const info = await ui.evaluate(`(() => {
      const activeTab = document.querySelector('.terminal-tab.active')?.textContent.trim();
      const rows = Array.from(document.querySelectorAll('.terminal-pane-wrapper.active .xterm-rows > div')).map(d => d.textContent).join('\\n');
      const text = document.querySelector('.terminal-pane-wrapper.active')?.innerText || '';
      return { activeTab, rows, text };
    })()`);
    termText = (info?.rows || '') + '\n' + (info?.text || '');
    if (termText.includes('Player: Erin, Level: 3') && termText.includes('Current score: 10 pts')) break;
    await delay(500);
  }
  console.log('Terminal Text:\n', termText);
  assert.ok(termText.includes('Player: Erin, Level: 3'), 'Terminal must show "Player: Erin, Level: 3"');
  assert.ok(termText.includes('Current score: 10 pts'), 'Terminal must show "Current score: 10 pts"');

  // Take screenshot of terminal output
  const termShot = await ui.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(screenshotDir, 'terminal-examples-output.png'), Buffer.from(termShot.data, 'base64'));
  console.log('Saved terminal-examples-output.png');

  // Now switch target language to GDScript
  console.log('Switching target to GDScript...');
  await ui.evaluate(`(() => {
    const sel = document.querySelector('select[aria-label="Target language"]');
    if (sel) {
      sel.value = 'gdscript';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await delay(800);

  // Verify Preview shows GDScript code
  const gdPreview = await ui.evaluate(`document.querySelector('.gcn-preview .cm-content')?.innerText || ''`);
  console.log('GDScript Preview:\n', gdPreview);
  assert.ok(gdPreview.includes('extends Node'));
  assert.ok(gdPreview.includes('var player_name: String = "Erin"'));
  assert.ok(gdPreview.includes('var level: int = 3'));
  assert.ok(gdPreview.includes('var score: int = 10'));
  assert.ok(gdPreview.includes('func _ready():'));
  assert.ok(gdPreview.includes('print("Player: {0}, Level: {1}".format([player_name, level]))'));
  assert.ok(gdPreview.includes('print(("Current score: " + str(score) + " pts"))'));

  // Screenshot the GDScript preview
  const gdShot = await ui.send('Page.captureScreenshot', { format: 'png' });
  const gdShotPath = path.join(screenshotDir, 'geometry-gdscript-preview.png');
  await fs.writeFile(gdShotPath, Buffer.from(gdShot.data, 'base64'));
  console.log('Saved GDScript preview screenshot to:', gdShotPath);

  console.log('\nAll installed app acceptance tests PASSED successfully!');
} finally {
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
