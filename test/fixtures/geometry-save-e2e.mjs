// Run after npm run build. NIZYLA_TEST_EXE optionally selects the installed executable.
// Both debuggers belong to our child process. Only native dialog choices are stubbed;
// graph editing, Save, Export, project scanning and terminal creation use the actual app.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-save-e2e-'));
const project = path.join(temp, 'project');
const folder = path.join(project, 'โฟลเดอร์ A');
const other = path.join(project, 'Folder B');
await fs.mkdir(folder, { recursive: true });
await fs.mkdir(other);
const port = async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
};
const rendererPort = await port(), mainPort = await port();
const exe = process.env.NIZYLA_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe');
const child = spawn(exe, [
  ...(process.env.NIZYLA_TEST_EXE ? [] : ['.']),
  `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${rendererPort}`,
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--user-data-dir=${path.join(temp, 'profile')}`
], { cwd: root, env: { ...process.env, NIZYLA_DEV: '0', NIZYLA_DISABLE_UPDATE_CHECK: '1' }, stdio: 'ignore' });
let launchError;
child.on('error', (error) => { launchError = error; });
let main, ui;

async function connect(portNumber, type) {
  let targets;
  for (let i = 0; i < 80; i++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, 'Test instance must still be running');
    try {
      targets = await (await fetch(`http://127.0.0.1:${portNumber}/json`, { signal: AbortSignal.timeout(1000) })).json();
      if (targets.some((target) => target.type === type)) break;
    } catch {}
    await delay(150);
  }
  const owners = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-NetTCPConnection -State Listen -LocalPort ${portNumber} | Select-Object -ExpandProperty OwningProcess`
  ], { encoding: 'utf8', timeout: 15000 }).trim().split(/\s+/).map(Number);
  assert.ok(owners.length && owners.every((pid) => pid === child.pid), 'Only connect to our child process');
  const target = targets?.find((target) => target.type === type);
  assert.ok(target, 'Debug target exists');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data), call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error || message.result?.exceptionDetails) call.reject(new Error(JSON.stringify(message)));
    else call.resolve(message.result);
  };
  ws.onclose = ws.onerror = () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Debugger disconnected')); }
    pending.clear();
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id;
    const timer = setTimeout(() => { pending.delete(request); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(request, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  })).result.value;
  return { send, evaluate, close: () => ws.close() };
}

async function wait(expression, label = expression) {
  for (let i = 0; i < 80; i++) {
    if (await ui.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`UI condition timed out: ${label}`);
}
async function click(text, scope = 'document') {
  console.log('Click:', text);
  await ui.evaluate(`(() => {
    const b = Array.from(${scope}.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!b || b.disabled) throw new Error('Missing/disabled button: ' + ${JSON.stringify(text)});
    b.click();
  })()`);
  await delay(100);
}
async function input(selector, value) {
  await ui.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('blur')); })()`);
}
async function center(selector) {
  return ui.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
}
async function drag(from, to) {
  await ui.evaluate(`(() => {
    const from = ${JSON.stringify(from)}, to = ${JSON.stringify(to)};
    const options = {bubbles:true, view:window, button:0, buttons:1};
    document.elementFromPoint(from.x, from.y).dispatchEvent(new MouseEvent('mousedown', {...options,clientX:from.x,clientY:from.y}));
    window.dispatchEvent(new MouseEvent('mousemove', {...options,clientX:to.x,clientY:to.y}));
    window.dispatchEvent(new MouseEvent('mouseup', {...options,buttons:0,clientX:to.x,clientY:to.y}));
  })()`);
  await delay(150);
}
async function wire(source, target) {
  for (const selector of [source, target]) {
    await ui.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('click',{bubbles:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    await delay(100);
  }
}
async function selectFolder(name) {
  await ui.evaluate(`Array.from(document.querySelectorAll('.tree-row.folder')).find(e => e.querySelector('.name')?.textContent === ${JSON.stringify(name)}).click()`);
  await delay(100);
}
async function saveName(name) {
  await wait("document.querySelector('form.modal input')");
  await input('form.modal input', name);
  await click('Save', "document.querySelector('form.modal')");
  await wait("!document.querySelector('form.modal')");
}

try {
  main = await connect(mainPort, 'node');
  await main.evaluate(`globalThis.testElectron = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root, 'package.json'))})('electron');
    globalThis.testExportOptions = [];
    testElectron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(project)}] });
    testElectron.dialog.showSaveDialog = async (_win, options) => {
      testExportOptions.push(options);
      return { canceled: false, filePath: options.defaultPath };
    };
    globalThis.testTerminalCwds = [];
  `);
  ui = await connect(rendererPort, 'page');
  await ui.send('Page.bringToFront');
  await wait("document.querySelector('.app-shell')");
  // Capture the actual terminal:create handler without replacing its implementation.
  await main.evaluate(`const handlers = testElectron.ipcMain._invokeHandlers;
    const originalTerminal = handlers.get('terminal:create');
    handlers.set('terminal:create', (event, cwd) => { testTerminalCwds.push(cwd); return originalTerminal(event, cwd); });`);
  await click('Open Folder');
  await wait("document.querySelector('.tree-row.folder .name')");
  await selectFolder('โฟลเดอร์ A');
  await click('Geometry Code');
  await click('Fit View');
  await delay(300);
  for (const label of ['Integer', 'Print']) {
    await click('+ Add Node');
    await wait("document.querySelector('.gcn-menu')");
    await ui.evaluate(`Array.from(document.querySelectorAll('.gcn-menu button')).find(b => b.querySelector('span').textContent === ${JSON.stringify(label)}).click()`);
    await delay(200);
    const type = label === 'Integer' ? 'literal' : 'print';
    const from = await center(`[data-node-type="${type}"] .gcn-node-head`);
    const to = await ui.evaluate(`(() => {const r = document.querySelector('.gcn-canvas').getBoundingClientRect(); return {x:r.left+r.width*${type === 'literal' ? 0.25 : 0.73},y:r.top+r.height*${type === 'literal' ? 0.62 : 0.4}};})()`);
    await drag(from, to);
  }
  await input('[aria-label="Literal value"]', '42');
  console.log('Connecting execution wire');
  await wire('[data-node-type="start"] .source', '[data-node-type="print"] [data-port="in"] .target');
  await wire('[data-node-type="literal"] .source', '[data-node-type="print"] [data-port="value"] .target');
  console.log('Waiting for wires');
  await wait("document.querySelectorAll('.svelte-flow__edge').length === 2");
  await click('Save', "document.querySelector('.app-shell header')");
  await wait("document.querySelector('form.modal input')");
  await click('Cancel', "document.querySelector('form.modal')");
  assert.equal(await ui.evaluate("document.querySelectorAll('.svelte-flow__edge').length"), 2);
  assert.equal(await ui.evaluate("document.querySelectorAll('.gcn-node').length"), 3);
  await click('Save', "document.querySelector('.app-shell header')");
  await saveName('connected');
  const savedPath = path.join(folder, 'connected.gcn');
  const saved = JSON.parse(await fs.readFile(savedPath, 'utf8'));
  assert.equal(saved.nodes.length, 3);
  assert.equal(saved.edges.length, 2);
  assert.equal(saved.nodes.find(n => n.type === 'literal').data.value, 42);
  assert.equal(await ui.evaluate("document.querySelectorAll('.svelte-flow__edge').length"), 2);
  assert.equal(await ui.evaluate("Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b=>b.textContent==='Undo').disabled"), false);
  console.log('PASS: first Save uses the connected scratch graph and selected folder; history survives');

  await click('Close Graph');
  await ui.evaluate("Array.from(document.querySelectorAll('.tree-row.file')).find(e=>e.querySelector('.name')?.textContent==='connected.gcn').click()");
  await wait("document.querySelectorAll('.svelte-flow__edge').length === 2");
  await input('[aria-label="Literal value"]', '43');
  await ui.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', modifiers: 2, windowsVirtualKeyCode: 83 });
  await ui.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', modifiers: 2, windowsVirtualKeyCode: 83 });
  await wait("!document.querySelector('.gcn-file-badge.dirty')");
  const savedAgain = JSON.parse(await fs.readFile(savedPath, 'utf8'));
  assert.equal(savedAgain.edges.length, 2);
  assert.equal(savedAgain.nodes.find(n => n.type === 'literal').data.value, 43);
  console.log('PASS: reopen and Ctrl+S preserve all nodes/wires and updated values');

  await selectFolder('Folder B');
  await click('Export', "document.querySelector('.app-shell header')");
  await wait("Array.from(document.querySelectorAll('.tree-row.file .name')).some(e=>e.textContent==='connected.py')");
  assert.match(await fs.readFile(path.join(other, 'connected.py'), 'utf8'), /print\(43\)/);
  const options = await main.evaluate('testExportOptions.at(-1)');
  assert.equal(options.defaultPath, path.join(other, 'connected.py'));
  console.log('PASS: Export defaults to selected folder and appears without Refresh');

  await click('Save As');
  await saveName('copy.gcn');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(other, 'copy.gcn'), 'utf8')), savedAgain);
  assert.deepEqual(JSON.parse(await fs.readFile(savedPath, 'utf8')), savedAgain);
  console.log('PASS: Save As copies the graph to the selected folder and preserves original');

  await input('[aria-label="Literal value"]', '44');
  await click('Save As');
  await wait("document.querySelector('form.modal input')");
  await input('form.modal input', 'copy.gcn');
  await click('Save', "document.querySelector('form.modal')");
  await wait("document.querySelector('.statusbar').textContent.includes('EEXIST')");
  assert.equal(await ui.evaluate("document.querySelector('[aria-label=\"Literal value\"]').value"), '44');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(other, 'copy.gcn'), 'utf8')), savedAgain);
  await click('Cancel', "document.querySelector('form.modal')");
  assert.equal(await ui.evaluate("!!document.querySelector('.gcn-file-badge.dirty')"), true);
  await click('Save', "document.querySelector('.app-shell header')");
  await wait("!document.querySelector('.gcn-file-badge.dirty')");
  assert.equal(JSON.parse(await fs.readFile(path.join(other, 'copy.gcn'), 'utf8')).nodes.find(n => n.type === 'literal').data.value, 44);
  console.log('PASS: cancelled/failed Save As retains graph edits and does not overwrite existing files');

  await click('Code');
  await click('Terminal', "document.querySelector('.app-shell header')");
  await wait("document.querySelector('.terminal-tab-label') && !document.querySelector('.terminal-tab-label').textContent.includes('…')");
  assert.deepEqual(await main.evaluate('testTerminalCwds'), [other]);
  await selectFolder('โฟลเดอร์ A');
  await ui.evaluate("document.querySelector('.terminal-new-tab').click()");
  await wait("document.querySelectorAll('.terminal-tab').length === 2 && !Array.from(document.querySelectorAll('.terminal-tab-label')).some(e=>e.textContent.includes('…'))");
  assert.deepEqual(await main.evaluate('testTerminalCwds'), [other, folder]);
  assert.equal(await ui.evaluate("Array.from(document.querySelectorAll('.terminal-tab-label')).some(e=>e.textContent.includes('unavailable'))"), false);
  console.log('PASS: real terminal sessions start in selected folders; existing session is preserved');
  console.log(`All UI regressions passed: ${exe}`);
} catch (error) {
  console.error(error);
  if (ui) {
    const shot = await ui.send('Page.captureScreenshot');
    await fs.writeFile(path.join(temp, 'test-window.png'), Buffer.from(shot.data, 'base64'));
  }
  process.exitCode = 1;
} finally {
  if (main) {
    // Only our dedicated test instance; no user documents were opened.
    await main.evaluate('setTimeout(() => testElectron.app.exit(0), 100); true').catch(() => {});
    main.close();
  }
  ui?.close();
  if (child.exitCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  }
  if (child.exitCode === null) child.kill();
  console.log(`Test-only files: ${temp}`);
}
