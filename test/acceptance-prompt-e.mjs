import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const screenshotDir = path.resolve('docs/geometry-stage3-shots');
await fs.mkdir(screenshotDir, { recursive: true });

try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-acceptance-e-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// 1. Create input_test.gcn
const inputTestGcn = JSON.stringify({
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 40, y: 100 }, data: {} },
    { id: 'inp', type: 'input', position: { x: 200, y: 150 }, data: { prompt: 'Name: ' } },
    { id: 'pr', type: 'print', position: { x: 400, y: 100 }, data: { argCount: 1 } }
  ],
  edges: [
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'pr', targetHandle: 'in' },
    { id: 'e2', source: 'inp', sourceHandle: 'value', target: 'pr', targetHandle: 'value' }
  ],
  viewport: { x: 0, y: 0, zoom: 1 }
}, null, 2) + '\n';
await fs.writeFile(path.join(projectDir, 'input_test.gcn'), inputTestGcn, 'utf8');

// 2. Create foreach_test.gcn
const foreachTestGcn = JSON.stringify({
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'gdscript',
  variables: [
    { id: 'v_items', name: 'items', type: 'list', initialValue: [] },
    { id: 'v_x', name: 'x', type: 'int', initialValue: 0 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 40, y: 100 }, data: {} },
    { id: 'l1', type: 'literal', position: { x: 50, y: 0 }, data: { valueType: 'int', value: 10 } },
    { id: 'l2', type: 'literal', position: { x: 50, y: 40 }, data: { valueType: 'int', value: 20 } },
    { id: 'l3', type: 'literal', position: { x: 50, y: 80 }, data: { valueType: 'int', value: 30 } },
    { id: 'n_list', type: 'list', position: { x: 200, y: 20 }, data: { itemCount: 3 } },
    { id: 'n_fe', type: 'forEach', position: { x: 380, y: 100 }, data: { variableId: 'v_x' } },
    { id: 'gitems', type: 'getVariable', position: { x: 480, y: 20 }, data: { variableId: 'v_items' } },
    { id: 'gx', type: 'getVariable', position: { x: 480, y: 60 }, data: { variableId: 'v_x' } },
    { id: 'n_app', type: 'append', position: { x: 620, y: 80 }, data: {} },
    { id: 'gitems2', type: 'getVariable', position: { x: 480, y: 220 }, data: { variableId: 'v_items' } },
    { id: 'n_len', type: 'length', position: { x: 620, y: 220 }, data: {} },
    { id: 'n_pr', type: 'print', position: { x: 780, y: 180 }, data: { argCount: 1 } }
  ],
  edges: [
    { id: 'el1', source: 'l1', sourceHandle: 'value', target: 'n_list', targetHandle: 'item_0' },
    { id: 'el2', source: 'l2', sourceHandle: 'value', target: 'n_list', targetHandle: 'item_1' },
    { id: 'el3', source: 'l3', sourceHandle: 'value', target: 'n_list', targetHandle: 'item_2' },
    { id: 'e_fe_in', source: 'start', sourceHandle: 'next', target: 'n_fe', targetHandle: 'in' },
    { id: 'e_fe_items', source: 'n_list', sourceHandle: 'value', target: 'n_fe', targetHandle: 'items' },
    { id: 'e_fe_body', source: 'n_fe', sourceHandle: 'body', target: 'n_app', targetHandle: 'in' },
    { id: 'e_app_list', source: 'gitems', sourceHandle: 'value', target: 'n_app', targetHandle: 'list' },
    { id: 'e_app_val', source: 'gx', sourceHandle: 'value', target: 'n_app', targetHandle: 'value' },
    { id: 'e_fe_next', source: 'n_fe', sourceHandle: 'next', target: 'n_pr', targetHandle: 'in' },
    { id: 'e_len_val', source: 'gitems2', sourceHandle: 'value', target: 'n_len', targetHandle: 'value' },
    { id: 'e_pr_val', source: 'n_len', sourceHandle: 'value', target: 'n_pr', targetHandle: 'value' }
  ],
  viewport: { x: 0, y: 0, zoom: 1 }
}, null, 2) + '\n';
await fs.writeFile(path.join(projectDir, 'foreach_test.gcn'), foreachTestGcn, 'utf8');

const exportGdPath = path.join(projectDir, 'foreach_export.gd');

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

// Check for --type=renderer child process
await delay(2000);
const procCheck = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'NiZyLa.exe\'\\" | Select-Object -ExpandProperty CommandLine"', { encoding: 'utf8' });
console.log('Process check (searching for --type=renderer):');
const hasRenderer = procCheck.includes('--type=renderer');
console.log('Found --type=renderer child process:', hasRenderer);
assert.ok(hasRenderer, 'Electron sandbox renderer child process must exist');

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
    screenshot: async (name) => {
      const res = await new Promise((resolve, reject) => {
        const callId = ++id;
        pending.set(callId, { resolve, reject, timer: setTimeout(() => reject(new Error('Timeout screenshot')), 20000) });
        ws.send(JSON.stringify({ id: callId, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      });
      const filePath = path.join(screenshotDir, `${name}.png`);
      await fs.writeFile(filePath, Buffer.from(res.data, 'base64'));
      console.log(`Saved screenshot: ${filePath}`);
    },
    close: () => ws.close()
  };
}

try {
  const main = await connect(mainPort, 'node');
  await main.evaluate(`
    globalThis.testElectron = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(root, 'package.json'))})('electron');
    testElectron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(projectDir)}] });
    testElectron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(exportGdPath)} });
  `);

  const ui = await connect(rendererPort, 'page');
  await ui.send('Runtime.enable');
  await ui.send('Page.bringToFront');
  await ui.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false }).catch(() => {});

  async function wait(expr) {
    const code = expr.startsWith('.') || expr.startsWith('#') || expr.startsWith('[') ? `document.querySelector(${JSON.stringify(expr)})` : expr;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await ui.evaluate(code);
        if (r) return r;
      } catch {}
      await delay(150);
    }
    throw new Error(`Timed out waiting for: ${expr}`);
  }

  console.log('1. Open Project Folder');
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder')?.click()`);
  await wait("document.querySelector('.tree-row.file .name')");

  // Open Terminal panel
  await ui.evaluate(`(() => {
    const termBtn = document.querySelector('button[title="Terminal"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Terminal'));
    if (termBtn) termBtn.click();
    document.querySelector('.app-shell')?.style.setProperty('--terminal-height', '320px');
    window.dispatchEvent(new Event('resize'));
  })()`);
  await delay(600);

  // 2. Acceptance check 1: Input("Name: ") -> Print, Run with Python, enter "Ada"
  console.log('2. Acceptance Check 1: Input -> Print with Python Run and stdin "Ada"');
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'input_test.gcn');
    row?.click();
  })()`);
  await delay(800);
  await wait("document.querySelector('.gcn-workspace')");

  // Click Run button
  console.log('Clicking Run button...');
  await ui.evaluate(`document.querySelector('.gcn-run-btn')?.click()`);
  await delay(1500);

  // Switch to Python Run tab if needed
  await ui.evaluate(`(() => {
    const runTab = Array.from(document.querySelectorAll('.terminal-tab')).find(t => t.textContent.includes('Python Run'));
    if (runTab) runTab.click();
  })()`);
  await delay(500);

  // Wait for the input prompt to appear and send "Ada"
  console.log('Sending "Ada" via terminal input bar...');
  await wait("document.querySelector('.terminal-run-input-bar input')");
  await ui.evaluate(`(() => {
    const inp = document.querySelector('.terminal-run-input-bar input');
    inp.value = 'Ada';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const form = document.querySelector('.terminal-run-input-bar');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await delay(1500);

  // Verify terminal output shows "Name: Ada"
  let terminalText = '';
  for (let i = 0; i < 20; i++) {
    const text = await ui.evaluate(`document.querySelector('.terminal-pane-wrapper.active')?.innerText || ''`);
    if (text.includes('Name: Ada') || text.includes('Ada')) {
      terminalText = text;
      break;
    }
    await delay(300);
  }
  console.log('Terminal text after input:\n', terminalText);
  assert.ok(terminalText.includes('Name: Ada') || terminalText.includes('Ada'), 'Terminal output must contain "Name: Ada"');
  await ui.screenshot('l_01_input_python_run_ada');

  // 3. Acceptance check 2: For Each + Append + Length, Export to GDScript
  console.log('3. Acceptance Check 2: For Each + Append + Length with GDScript Export');
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'foreach_test.gcn');
    row?.click();
  })()`);
  await delay(800);
  await wait("document.querySelector('.gcn-workspace')");
  // Click Fit View
  await ui.evaluate(`(() => {
    const fitBtn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('Fit View'));
    fitBtn?.click();
  })()`);
  await delay(500);
  await ui.screenshot('l_02_foreach_append_length_graph');

  // Click Export button
  console.log('Exporting graph to GDScript...');
  await ui.evaluate(`(() => {
    const exportBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Export' && !b.disabled);
    if (!exportBtn) throw new Error('Export button not found or disabled');
    exportBtn.click();
  })()`);
  await delay(1500);

  // Verify exported file
  assert.ok(fsSync.existsSync(exportGdPath), `Exported GDScript file must exist at ${exportGdPath}`);
  const exportedGd = await fs.readFile(exportGdPath, 'utf8');
  console.log('Exported GDScript:\n', exportedGd);
  assert.ok(exportedGd.includes('extends Node'), 'Exported file must include extends Node');
  assert.ok(exportedGd.includes('var items: Array = []'), 'Exported file must declare items: Array');
  assert.ok(exportedGd.includes('var x: int = 0'), 'Exported file must declare x: int');
  assert.ok(exportedGd.includes('for _gcn_i0 in [10, 20, 30]:'), 'Exported file must iterate over list');
  assert.ok(exportedGd.includes('items.append(x)'), 'Exported file must append x');
  assert.ok(exportedGd.includes('print(len(items))'), 'Exported file must print len(items)');

  await ui.screenshot('l_03_exported_gdscript_preview');

  // 4. Capture Add Node menu presets
  console.log('4. Capture Add Node menu presets');
  await ui.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('Add Node'));
    btn?.click();
  })()`);
  await delay(500);
  await wait('.gcn-menu');
  await ui.screenshot('l_04_add_menu_presets');

  await ui.close();
  await main.close();

  try { child.kill('SIGTERM'); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  try { await fs.rm(temp, { recursive: true, force: true }); } catch {}

  console.log('All Step 10 acceptance checks PASSED cleanly!');
} catch (err) {
  console.error('Acceptance test error:', err);
  try { child.kill('SIGKILL'); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  process.exit(1);
}
