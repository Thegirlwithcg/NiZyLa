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

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-acceptance-f-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// Create test.gcn
const testGcn = JSON.stringify({
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 40, y: 100 }, data: {} }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
}, null, 2) + '\n';
await fs.writeFile(path.join(projectDir, 'test.gcn'), testGcn, 'utf8');

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

// Check for --type=renderer child process (Electron renderer sandbox active)
await delay(2500);
const procCheck = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'NiZyLa.exe\'\\" | Select-Object -ExpandProperty CommandLine"', { encoding: 'utf8' });
console.log('Process check: searching for --type=renderer child process...');
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
  `);

  const ui = await connect(rendererPort, 'page');
  await ui.send('Runtime.enable');
  await ui.send('Page.bringToFront');

  // Set real BrowserWindow size to 1400x860
  await main.evaluate(`
    const win = testElectron.BrowserWindow.getAllWindows()[0];
    win.setSize(1400, 860);
    win.center();
  `);
  await delay(800);

  async function wait(expr) {
    const code = expr.startsWith('.') || expr.startsWith('#') || expr.startsWith('[') ? `document.querySelector(${JSON.stringify(expr)})` : expr;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await ui.evaluate(code);
        if (r) return r;
      } catch {}
      await delay(200);
    }
    throw new Error(`Timeout waiting for ${expr}`);
  }

  // 1. Open project folder
  console.log('1. Open Project Folder...');
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder')?.click()`);
  await wait("document.querySelector('.tree-row.file .name')");

  // Open test.gcn
  console.log('Opening test.gcn...');
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'test.gcn');
    row?.click();
  })()`);
  await delay(800);
  await wait('.gcn-canvas');

  // Verify real window innerWidth/innerHeight
  const windowDims = await ui.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
  console.log('Real window inner dimensions at 1400x860:', windowDims);

  // m7: the toolbar showing "+ Node" / "Close Node"
  console.log('Checking m7: toolbar buttons + Node and Close Node...');
  const toolbarBtnLabels = await ui.evaluate(`
    Array.from(document.querySelectorAll('.topbar .actions button')).map(b => ({
      text: b.textContent.trim(),
      title: b.title
    }))
  `);
  console.log('Toolbar buttons:', toolbarBtnLabels);
  const plusNodeBtn = toolbarBtnLabels.find(b => b.text === '+ Node');
  const closeNodeBtn = toolbarBtnLabels.find(b => b.text === 'Close Node');
  assert.ok(plusNodeBtn, '+ Node toolbar button must exist');
  assert.equal(plusNodeBtn.title, 'Create a new Geometry Code Node (.gcn) in the project');
  assert.ok(closeNodeBtn, 'Close Node toolbar button must exist');
  assert.equal(closeNodeBtn.title, 'Close the current Geometry Code Node');

  await ui.screenshot('m_07_toolbar_node_buttons');
  await ui.screenshot('m7');

  // m1: the menu with the Value flyout open (Integer / Float / String / Boolean)
  console.log('Checking m1: Add menu with Value flyout...');
  await ui.evaluate(`(() => {
    const addBtn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('+ Add Node'));
    addBtn?.click();
  })()`);
  await delay(400);
  await wait('.gcn-menu');

  // Hover over the first category ("Value")
  await ui.evaluate(`(() => {
    const valueBtn = Array.from(document.querySelectorAll('.gcn-category-list li button')).find(b => b.textContent.includes('Value'));
    valueBtn?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  })()`);
  await delay(400);
  await wait('.gcn-flyout');

  const flyoutPresets = await ui.evaluate(`
    Array.from(document.querySelectorAll('.gcn-flyout li button')).map(b => b.textContent.trim())
  `);
  console.log('Value flyout presets:', flyoutPresets);
  assert.deepEqual(flyoutPresets, ['Integer', 'Float', 'String', 'Boolean']);

  await ui.screenshot('m_01_value_flyout');
  await ui.screenshot('m1');

  async function closeMenuIfOpen() {
    for (let i = 0; i < 4; i++) {
      const open = await ui.evaluate('Boolean(document.querySelector(".gcn-menu"))');
      if (!open) return;
      await ui.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
      await delay(200);
    }
  }

  // Close flyout and menu with Escape
  await closeMenuIfOpen();

  // m2: keyboard only: Down, Right, Down, Enter creates a Float value node
  console.log('Checking m2: keyboard only: Down, Right, Down, Enter...');
  await ui.evaluate(`(() => {
    const addBtn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('+ Add Node'));
    addBtn?.click();
  })()`);
  await delay(400);
  await wait('.gcn-menu');

  const nodesBeforeM2 = await ui.evaluate(`document.querySelectorAll('.svelte-flow__node').length`);

  // Send keyboard events to the focused menu input
  await ui.evaluate(`(() => {
    const input = document.querySelector('.gcn-menu input');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
  })()`);
  await delay(200);

  await ui.evaluate(`(() => {
    const input = document.querySelector('.gcn-menu input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
  })()`);
  await delay(200);

  await ui.evaluate(`(() => {
    const input = document.querySelector('.gcn-menu input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
  })()`);
  await delay(200);

  await ui.evaluate(`(() => {
    const input = document.querySelector('.gcn-menu input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  })()`);
  await delay(600);

  const nodesAfterM2 = await ui.evaluate(`document.querySelectorAll('.svelte-flow__node').length`);
  console.log(`Node count before: ${nodesBeforeM2}, after: ${nodesAfterM2}`);
  assert.equal(nodesAfterM2, nodesBeforeM2 + 1, 'A new node should have been created by keyboard navigation');

  const nodeHeadTitles = await ui.evaluate(`
    Array.from(document.querySelectorAll('.gcn-node .gcn-node-head-main strong')).map(el => el.textContent.trim())
  `);
  console.log('Nodes on canvas:', nodeHeadTitles);
  assert.ok(nodeHeadTitles.includes('Value'), 'Value node must be present on canvas');

  const selectedValueType = await ui.evaluate(`
    document.querySelector('.gcn-node select[aria-label="Value type"]')?.value
  `);
  console.log('Selected value type on node:', selectedValueType);
  assert.equal(selectedValueType, 'float', 'Selected literal type must be float');

  await ui.screenshot('m_02_keyboard_float_created');
  await ui.screenshot('m2');

  // m3: the flyout flipped to the left when the menu opens near the right edge
  console.log('Checking m3: flyout flipped to the left near right edge...');
  // Toggle side panel off so canvas extends to the window right edge
  await ui.evaluate(`document.querySelector('.gcn-panel-toggle')?.click()`);
  await delay(300);

  const rightX = await ui.evaluate(`Math.round(document.querySelector('.gcn-canvas').getBoundingClientRect().right - 40)`);
  console.log('Target rightX near right edge for m3:', rightX);
  await ui.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rightX, y: 200 });
  await delay(200);
  await ui.evaluate(`(() => {
    const canvas = document.querySelector('.gcn-canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', shiftKey: true, bubbles: true }));
  })()`);
  await delay(400);
  await wait('.gcn-menu');

  // Hover over Value category
  const menuPos = await ui.evaluate(`(() => {
    const m = document.querySelector('.gcn-menu');
    return m ? { left: m.style.left, top: m.style.top, rect: m.getBoundingClientRect(), winW: window.innerWidth } : null;
  })()`);
  console.log('Menu position in m3:', menuPos);

  await ui.evaluate(`(() => {
    const valueBtn = Array.from(document.querySelectorAll('.gcn-category-list li button')).find(b => b.textContent.includes('Value'));
    valueBtn?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  })()`);
  await delay(400);
  await wait('.gcn-flyout');

  const flyoutFlipped = await ui.evaluate(`document.querySelector('.gcn-flyout')?.classList.contains('flipped')`);
  console.log('Flyout has .flipped class near right edge:', flyoutFlipped);
  assert.ok(flyoutFlipped, 'Flyout must flip to the left when menu is near right edge');

  await ui.screenshot('m_03_flyout_flipped_left');
  await ui.screenshot('m3');

  // Close menu
  await closeMenuIfOpen();

  // Restore side panel
  await ui.evaluate(`document.querySelector('.gcn-panel-toggle')?.click()`);
  await delay(300);

  // m4: searching "for" shows the flat list
  console.log('Checking m4: search "for" shows flat list...');
  await ui.evaluate(`(() => {
    const addBtn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('+ Add Node'));
    addBtn?.click();
  })()`);
  await delay(400);
  await wait('.gcn-menu');

  await ui.evaluate(`(() => {
    const input = document.querySelector('.gcn-menu input');
    input.focus();
    input.value = 'for';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(400);
  await wait('.gcn-flat-list');

  const searchResults = await ui.evaluate(`
    Array.from(document.querySelectorAll('.gcn-flat-list li button span')).map(s => s.textContent.trim())
  `);
  console.log('Search "for" results:', searchResults);
  assert.ok(searchResults.includes('For Range'), 'Search results should contain For Range');
  assert.ok(searchResults.includes('For Each'), 'Search results should contain For Each');
  assert.ok(searchResults.includes('Format String'), 'Search results should contain Format String');

  await ui.screenshot('m_04_search_for_flat_list');
  await ui.screenshot('m4');

  // Close menu
  await closeMenuIfOpen();

  // m5: right-click a dirty .gcn tab → Float. It opens in a floating window, still dirty, and Ctrl+Z still works.
  console.log('Checking m5: right-click dirty tab -> Float...');
  const isDirtyBeforeFloat = await ui.evaluate(`document.querySelector('.tab.tab-wrap.active button')?.textContent.includes('•')`);
  console.log('Tab is dirty before float:', isDirtyBeforeFloat);
  assert.ok(isDirtyBeforeFloat, 'Tab must be dirty before float test');

  // Right-click the active tab to open tab context menu
  await ui.evaluate(`(() => {
    const tabEl = document.querySelector('.tab.tab-wrap.active');
    const r = tabEl.getBoundingClientRect();
    tabEl.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.x + 20, clientY: r.y + 10, bubbles: true, cancelable: true }));
  })()`);
  await delay(400);
  await wait('.context-menu');

  const tabContextTitle = await ui.evaluate(`document.querySelector('.context-menu .context-title')?.textContent`);
  const floatBtnExists = await ui.evaluate(`Boolean(Array.from(document.querySelectorAll('.context-menu button')).find(b => b.textContent.trim() === 'Float'))`);
  console.log('Tab context menu title:', tabContextTitle, 'Float button exists:', floatBtnExists);
  assert.ok(floatBtnExists, 'Context menu must have Float button');

  // Click Float
  await ui.evaluate(`(() => {
    const floatBtn = Array.from(document.querySelectorAll('.context-menu button')).find(b => b.textContent.trim() === 'Float');
    floatBtn?.click();
  })()`);
  await delay(800);
  await wait('.editor-floating');

  const isFloatingTabDirty = await ui.evaluate(`document.querySelector('.editor-floating .tab.tab-wrap.active button')?.textContent.includes('•')`);
  console.log('Floated tab is still dirty:', isFloatingTabDirty);
  assert.ok(isFloatingTabDirty, 'Floated tab must remain dirty');

  // Test Ctrl+Z in the floating window undoes the float node addition
  console.log('Testing Ctrl+Z undo inside floating window...');
  await ui.evaluate(`(() => {
    const canvas = document.querySelector('.editor-floating .gcn-canvas');
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
  })()`);
  await delay(800);

  const nodeCountAfterUndo = await ui.evaluate(`document.querySelectorAll('.editor-floating .svelte-flow__node').length`);
  console.log(`Node count after Ctrl+Z undo: ${nodeCountAfterUndo} (expected ${nodesBeforeM2})`);
  assert.equal(nodeCountAfterUndo, nodesBeforeM2, 'Ctrl+Z must undo the node creation');

  await ui.screenshot('m_05_right_click_tab_float');
  await ui.screenshot('m5');

  // Verify sole-floating disabled state
  console.log('Verifying Float button disabled on sole tab of floating pane...');
  await ui.evaluate(`(() => {
    const tabEl = document.querySelector('.editor-floating .tab.tab-wrap.active');
    const r = tabEl.getBoundingClientRect();
    tabEl.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.x + 20, clientY: r.y + 10, bubbles: true, cancelable: true }));
  })()`);
  await delay(400);
  await wait('.context-menu');

  const floatDisabled = await ui.evaluate(`
    const btn = Array.from(document.querySelectorAll('.context-menu button')).find(b => b.textContent.trim() === 'Float');
    ({ disabled: btn?.disabled, title: btn?.title })
  `);
  console.log('Sole floating tab context button state:', floatDisabled);
  assert.equal(floatDisabled.disabled, true, 'Float button must be disabled for sole floating tab');
  assert.equal(floatDisabled.title, 'Already floating', 'Tooltip must say Already floating');

  // Close context menu
  await ui.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
  await delay(300);

  // m6: the unsaved-changes dialog in English
  console.log('Checking m6: unsaved-changes dialog in English...');
  // Redo to make tab dirty again
  await ui.evaluate(`(() => {
    const redoBtn = Array.from(document.querySelectorAll('.editor-floating .gcn-toolbar button')).find(b => b.title?.includes('Redo'));
    if (redoBtn && !redoBtn.disabled) {
      redoBtn.click();
    } else {
      const canvas = document.querySelector('.editor-floating .gcn-canvas');
      canvas?.focus();
      canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true }));
    }
  })()`);
  await delay(600);

  // Click close button on tab
  await ui.evaluate(`document.querySelector('.editor-floating .tab.tab-wrap.active .tab-close')?.click()`);
  await delay(500);
  await wait('.modal[role="dialog"]');

  const dialogTitle = await ui.evaluate(`document.querySelector('.modal[role="dialog"] h2')?.textContent`);
  const dialogMsg = await ui.evaluate(`document.querySelector('.modal[role="dialog"] p')?.textContent`);
  const dialogButtons = await ui.evaluate(`
    Array.from(document.querySelectorAll('.modal[role="dialog"] .modal-actions button')).map(b => b.textContent.trim())
  `);
  console.log('Unsaved changes dialog:', { title: dialogTitle, message: dialogMsg, buttons: dialogButtons });
  assert.equal(dialogTitle, 'Unsaved Changes');
  assert.ok(dialogMsg?.includes('has unsaved changes. Save before closing this tab?'));
  assert.deepEqual(dialogButtons, ['Cancel', "Don't Save", 'Save']);

  await ui.screenshot('m_06_unsaved_changes_dialog_english');
  await ui.screenshot('m6');

  // Click Don't Save to close dialog and tab cleanly
  await ui.evaluate(`Array.from(document.querySelectorAll('.modal[role="dialog"] .modal-actions button')).find(b => b.textContent.trim() === "Don't Save")?.click()`);
  await delay(600);

  // Test real window resize to 1000x680
  console.log('Testing real window resize to 1000x680...');
  await main.evaluate(`(() => {
    const win = testElectron.BrowserWindow.getAllWindows()[0];
    win.setSize(1000, 680);
    win.center();
  })()`);
  await delay(800);

  const windowDimsSmall = await ui.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
  console.log('Real window inner dimensions at 1000x680:', windowDimsSmall);
  assert.ok(windowDimsSmall.w <= 1000 && windowDimsSmall.w >= 960, 'Window width around 1000');
  assert.ok(windowDimsSmall.h <= 680 && windowDimsSmall.h >= 620, 'Window height around 680');

  console.log('All Prompt F acceptance checks completed successfully!');
} finally {
  try { child.kill('SIGKILL'); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
}
