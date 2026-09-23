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

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-four-prints-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

const pythonSource = `name = "Alice"
level = 5
print(f"Player: {name}, Level: {level}")

x = 10
y = 20
items = ["sword"]
print("Position:", x, y, "Equipment:", items)

rank = 1
print("Rank {}: {}".format(rank, name))

score = 100
print("Current score: " + str(score) + " pts")
`;

const pyFilePath = path.join(projectDir, 'four_prints.py');
await fs.writeFile(pyFilePath, pythonSource, 'utf8');

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

let launchError;
child.on('error', (err) => { launchError = err; });

async function connect(portNumber, type) {
  let targets;
  for (let i = 0; i < 80; i++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, 'NiZyLa process should be running');
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
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('Renderer console:', ...(msg.params.args?.map((a) => a.value) || []));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('Renderer exception:', msg.params.exceptionDetails);
    }
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
  `);

  const ui = await connect(rendererPort, 'page');
  await ui.send('Runtime.enable');
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

  // 1. Open Folder
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder');
    if (el) el.click();
  })()`);
  await wait("document.querySelector('.tree-row.file .name')");

  // 2. Click four_prints.py in the file tree
  await ui.evaluate(`(() => {
    const fileRow = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'four_prints.py');
    if (fileRow) fileRow.click();
  })()`);
  await delay(500);

  // 3. Click Convert to .gcn
  await wait("document.querySelector('button[title*=\"Convert\"]')");
  console.log('Clicking Convert to .gcn...');
  await ui.evaluate(`document.querySelector('button[title*=\"Convert\"]').click()`);
  await delay(1000);
  await wait("document.querySelector('.gcn-workspace')");

  // Fit View
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fit View'))?.click()`);
  await delay(400);

  // 4. Verify Preview contains all four print styles
  const previewText = await ui.evaluate(`document.querySelector('.gcn-preview .cm-content')?.innerText || ''`);
  console.log('Preview text:\n', previewText);
  assert.ok(previewText.includes('print(f"Player: {name}, Level: {level}")'), 'Preview should include fstring');
  assert.ok(previewText.includes('print("Position:", x, y, "Equipment:", items)'), 'Preview should include multi-arg print');
  assert.ok(previewText.includes('print("Rank {}: {}".format(rank, name))'), 'Preview should include format');
  assert.ok(previewText.includes('print(("Current score: " + str(score) + " pts"))'), 'Preview should include concat');

  // Intercept stdout from main
  await main.evaluate(`
    globalThis.capturedOutput = [];
    const win = testElectron.BrowserWindow.getAllWindows()[0];
    const origSend = win.webContents.send;
    win.webContents.send = function(...args) {
      if (args[0] === 'geometry:run-stdout') {
        globalThis.capturedOutput.push(args[1]?.text || '');
      }
      return origSend.apply(this, args);
    };
  `);

  // 5. Open Terminal panel and size it tall enough
  await ui.evaluate(`(() => {
    const termBtn = document.querySelector('button[title="Terminal"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terminal'));
    if (termBtn) termBtn.click();
    document.querySelector('.app-shell')?.style.setProperty('--terminal-height', '450px');
    window.dispatchEvent(new Event('resize'));
  })()`);
  await delay(800);

  // 6. Click Run button
  console.log('Clicking Run button...');
  await ui.evaluate(`document.querySelector('.gcn-run-btn')?.click()`);
  await delay(2000);

  // Switch to Python Run tab if needed
  await ui.evaluate(`(() => {
    const runTab = Array.from(document.querySelectorAll('.terminal-tab')).find(t => t.textContent.includes('Python Run'));
    if (runTab) runTab.click();
  })()`);
  await delay(500);

  // 7. Wait for terminal output of all four prints
  let termText = '';
  let mainCaptured = '';
  for (let i = 0; i < 30; i++) {
    const info = await ui.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('.terminal-pane-wrapper.active .xterm-rows > div')).map(d => d.textContent).join('\\n');
      const text = document.querySelector('.terminal-pane-wrapper.active')?.innerText || '';
      return { rows, text };
    })()`);
    mainCaptured = await main.evaluate(`globalThis.capturedOutput.join('')`);
    termText = (info?.rows || '') + '\n' + (info?.text || '') + '\n' + mainCaptured;
    if (
      termText.includes('Player: Alice, Level: 5') &&
      termText.includes("Position: 10 20 Equipment: ['sword']") &&
      termText.includes('Rank 1: Alice') &&
      termText.includes('Current score: 100 pts')
    ) {
      break;
    }
    await delay(500);
  }
  console.log('Main Captured:\n', mainCaptured);
  console.log('Terminal Text:\n', termText);
  assert.ok(termText.includes('Player: Alice, Level: 5'), 'Output must contain Player output');
  assert.ok(termText.includes("Position: 10 20 Equipment: ['sword']"), 'Output must contain Position output');
  assert.ok(termText.includes('Rank 1: Alice'), 'Output must contain Rank output');
  assert.ok(termText.includes('Current score: 100 pts'), 'Output must contain Score output');

  // Scroll xterm to top so all printed lines are in view for the screenshot
  await ui.evaluate(`(() => {
    const vp = document.querySelector('.terminal-pane-wrapper.active .xterm-viewport');
    if (vp) vp.scrollTop = 0;
  })()`);
  await delay(400);

  // 8. Capture screenshot
  const shot = await ui.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const shotPath = path.join(screenshotDir, 'four_prints_installed_run.png');
  await fs.writeFile(shotPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot to:', shotPath);

  await ui.close();
  await main.close();
  console.log('Verification SUCCESS!');
} finally {
  try { child.kill('SIGKILL'); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  try { await fs.rm(temp, { recursive: true, force: true }); } catch {}
}
