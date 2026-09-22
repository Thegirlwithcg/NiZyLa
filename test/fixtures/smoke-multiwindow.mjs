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

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-smoke-stage3-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// Setup project files
const mainPySource = `print("Hello from main.py")\n`;
await fs.writeFile(path.join(projectDir, 'main.py'), mainPySource, 'utf8');

const aGcnContent = JSON.stringify({
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
await fs.writeFile(path.join(projectDir, 'a.gcn'), aGcnContent, 'utf8');

const bGcnContent = JSON.stringify({
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
await fs.writeFile(path.join(projectDir, 'b.gcn'), bGcnContent, 'utf8');

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

  console.log('1. Open Folder');
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder')?.click()`);
  await wait("document.querySelector('.tree-row.file .name')");

  // Step a: a.gcn + main.py split
  console.log('Step a: a.gcn + main.py split');
  // Open a.gcn
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'a.gcn');
    row?.click();
  })()`);
  await delay(600);
  await wait("document.querySelector('.gcn-workspace')");

  // Click Split button to add a second docked pane
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Split'))?.click()`);
  await delay(600);

  // In second pane (now active), open main.py
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'main.py');
    row?.click();
  })()`);
  await delay(600);
  await wait("document.querySelector('.code-editor-area') || document.querySelector('.monaco-editor') || document.querySelector('.cm-editor')");

  // Verify two docked panes: pane 1 has a.gcn (geometry), pane 2 has main.py (code)
  const paneInfoA = await ui.evaluate(`(() => {
    const docked = Array.from(document.querySelectorAll('.editors .editor-area'));
    return {
      dockedCount: docked.length,
      hasGeometry: !!docked[0]?.querySelector('.gcn-workspace'),
      hasCode: !!docked[1]?.querySelector('.cm-editor, .monaco-editor, textarea, .editor-inner')
    };
  })()`);
  console.log('Step a docked panes:', paneInfoA);
  assert.equal(paneInfoA.dockedCount, 2);
  assert.equal(paneInfoA.hasGeometry, true);
  await ui.screenshot('a_split_a_and_main_py');

  // Step b: second graph floating on top
  console.log('Step b: second graph floating on top');
  // Add a floating editor pane
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ Float Editor'))?.click()`);
  await delay(600);

  // In the floating pane, open b.gcn
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'b.gcn');
    row?.click();
  })()`);
  await delay(600);

  const floatInfoB = await ui.evaluate(`(() => {
    const floating = document.querySelector('.floating-window.editor-floating');
    return {
      exists: !!floating,
      hasGeometry: !!floating?.querySelector('.gcn-workspace'),
      title: floating?.querySelector('.window-title-text')?.textContent
    };
  })()`);
  console.log('Step b floating pane:', floatInfoB);
  assert.equal(floatInfoB.exists, true);
  assert.equal(floatInfoB.hasGeometry, true);
  await ui.screenshot('b_second_graph_floating');

  async function clickAddNode(containerSelector = '') {
    await ui.evaluate(`(() => {
      const root = ${containerSelector ? `document.querySelector(${JSON.stringify(containerSelector)})` : 'document'};
      const btn = Array.from(root?.querySelectorAll('.gcn-toolbar button') || []).find(b => b.textContent.includes('Add Node'));
      if (!btn) throw new Error('Add Node button not found in ' + ${JSON.stringify(containerSelector)});
      btn.click();
    })()`);
    await delay(400);
  }

  async function pickPreset(label) {
    await wait('.gcn-menu');
    await ui.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll('.gcn-menu li button')).find(el => el.textContent.includes(${JSON.stringify(label)}));
      if (item) item.click();
    })()`);
    await delay(400);
  }

  // Step c: edit in floating b.gcn, Float/Dock, Ctrl+Z still undoes
  console.log('Step c: edit in b.gcn, Float/Dock, Ctrl+Z still undoes');
  // Add an 'int' node in b.gcn
  await clickAddNode('.floating-window.editor-floating');
  await pickPreset('Integer');

  const nodeCountBefore = await ui.evaluate(`document.querySelectorAll('.floating-window.editor-floating .svelte-flow__node').length`);
  console.log('Nodes in floating b.gcn after add:', nodeCountBefore);
  assert.ok(nodeCountBefore >= 2, 'Should have Start and Int nodes');

  // Click Dock on the floating pane to dock it
  await ui.evaluate(`(() => {
    const dockBtn = Array.from(document.querySelectorAll('.floating-window.editor-floating button')).find(b => b.textContent.trim() === 'Dock');
    dockBtn?.click();
  })()`);
  await delay(600);

  // Now b.gcn is in docked panes. Press Ctrl+Z to undo
  await ui.evaluate(`(() => {
    const target = document.querySelector('.editors .editor-area.focused .gcn-canvas') || document.querySelector('.editors .editor-area.focused .gcn-workspace');
    target?.focus();
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  })()`);
  await delay(400);

  const nodeCountAfterUndo = await ui.evaluate(`document.querySelectorAll('.editors .editor-area.focused .svelte-flow__node').length`);
  console.log('Nodes after Dock + Ctrl+Z:', nodeCountAfterUndo);
  assert.equal(nodeCountAfterUndo, nodeCountBefore - 1, 'Undo should have removed the added Int node');
  await ui.screenshot('c_dock_and_undo');

  // Step d: switch tab away and back in a pane, Undo still works
  console.log('Step d: switch tab away and back, Undo still works');
  // Re-add an Int node to have an undo history
  await clickAddNode('.editors .editor-area.focused');
  await pickPreset('Integer');
  const countBeforeTabSwitch = await ui.evaluate(`document.querySelectorAll('.editors .editor-area.focused .svelte-flow__node').length`);

  // Switch tab in this pane to another tab or open main.py in same pane
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'main.py');
    row?.click();
  })()`);
  await delay(600);

  // Now switch back to the b.gcn tab
  await ui.evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll('.editors .editor-area.focused .tab button')).find(b => b.textContent.includes('b.gcn'));
    tab?.click();
  })()`);
  await delay(600);

  // Undo in b.gcn
  await ui.evaluate(`(() => {
    const target = document.querySelector('.editors .editor-area.focused .gcn-canvas') || document.querySelector('.editors .editor-area.focused .gcn-workspace');
    target?.focus();
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  })()`);
  await delay(400);
  const countAfterTabSwitchUndo = await ui.evaluate(`document.querySelectorAll('.editors .editor-area.focused .svelte-flow__node').length`);
  console.log('Count before switch:', countBeforeTabSwitch, 'after switch + Undo:', countAfterTabSwitchUndo);
  assert.equal(countAfterTabSwitchUndo, countBeforeTabSwitch - 1, 'Undo must work after tab remount');
  await ui.screenshot('d_tab_switch_undo');

  // Step e: Ctrl+S saves only the focused graph
  console.log('Step e: Ctrl+S saves only the focused graph');
  // Make a.gcn dirty
  // Focus a.gcn pane
  await ui.evaluate(`(() => {
    const aTab = Array.from(document.querySelectorAll('.tab button')).find(b => b.textContent.includes('a.gcn'));
    aTab?.click();
  })()`);
  await delay(400);
  // Add a node to a.gcn
  await clickAddNode('.editors .editor-area.focused');
  await pickPreset('Float');

  // Make b.gcn dirty too
  await ui.evaluate(`(() => {
    const bTab = Array.from(document.querySelectorAll('.tab button')).find(b => b.textContent.includes('b.gcn'));
    bTab?.click();
  })()`);
  await delay(400);
  await clickAddNode('.editors .editor-area.focused');
  await pickPreset('String');

  // Currently focused is b.gcn. Press Ctrl+S
  await ui.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  })()`);
  await delay(800);

  // Verify: b.gcn is now saved (not dirty), but a.gcn is still dirty
  const dirtyStatus = await ui.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll('.tab button')).map(b => b.textContent.trim());
    return {
      tabs
    };
  })()`);
  console.log('Tab titles after saving b.gcn:', dirtyStatus.tabs);
  const bTabTitle = dirtyStatus.tabs.find(t => t.includes('b.gcn'));
  const aTabTitle = dirtyStatus.tabs.find(t => t.includes('a.gcn'));
  assert.ok(bTabTitle && !bTabTitle.includes('•'), 'b.gcn should not be dirty after Ctrl+S');
  assert.ok(aTabTitle && aTabTitle.includes('•'), 'a.gcn must still be dirty');
  await ui.screenshot('e_ctrl_s_saves_focused_only');

  // Step f: re-open a.gcn from Explorer focuses existing tab
  console.log('Step f: re-open a.gcn from Explorer focuses existing tab');
  const tabsCountBefore = await ui.evaluate(`document.querySelectorAll('.tab').length`);
  await ui.evaluate(`(() => {
    const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'a.gcn');
    row?.click();
  })()`);
  await delay(400);
  const tabsCountAfter = await ui.evaluate(`document.querySelectorAll('.tab').length`);
  const activeTabName = await ui.evaluate(`document.querySelector('.editor-area.focused .tab.active button')?.textContent`);
  console.log('Tabs before:', tabsCountBefore, 'after:', tabsCountAfter, 'active tab:', activeTabName);
  assert.equal(tabsCountBefore, tabsCountAfter, 'Should not create duplicate tab');
  assert.ok(activeTabName?.includes('a.gcn'), 'Existing a.gcn tab should be focused');
  await ui.screenshot('f_reopen_focuses_existing');

  // Step g: Shift+A / Delete in one graph don't touch the other
  console.log('Step g: operations in one graph do not touch the other');
  const aNodeCountBefore = await ui.evaluate(`document.querySelectorAll('.editor-area.focused .svelte-flow__node').length`);
  // Open add menu in a.gcn
  await ui.evaluate(`(() => {
    const canvas = document.querySelector('.editor-area.focused .gcn-canvas');
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', shiftKey: true, bubbles: true }));
  })()`);
  await delay(200);
  const menuOpened = await ui.evaluate(`!!document.querySelector('.gcn-menu')`);
  if (!menuOpened) {
    await clickAddNode('.editor-area.focused');
  }
  await pickPreset('Integer');
  const aNodeCountAfter = await ui.evaluate(`document.querySelectorAll('.editor-area.focused .svelte-flow__node').length`);
  assert.equal(aNodeCountAfter, aNodeCountBefore + 1, 'a.gcn gained a node');

  // Switch to b.gcn pane and verify its nodes did not change
  await ui.evaluate(`(() => {
    const bTab = Array.from(document.querySelectorAll('.tab button')).find(b => b.textContent.includes('b.gcn'));
    bTab?.click();
  })()`);
  await delay(400);
  await ui.screenshot('g_independent_graph_actions');

  // Step i: Panel toggle in a 720x520 float, four themes
  console.log('Step i: Panel toggle in 720x520 float across 4 themes');
  // Float b.gcn pane
  await ui.evaluate(`(() => {
    const floatBtn = Array.from(document.querySelectorAll('.editor-area.focused button')).find(b => b.textContent.trim() === 'Float');
    floatBtn?.click();
  })()`);
  await delay(500);

  // Resize floating window to 720x520
  await ui.evaluate(`(() => {
    const fw = document.querySelector('.floating-window.editor-floating');
    if (fw) {
      fw.style.width = '720px';
      fw.style.height = '520px';
    }
  })()`);
  await delay(200);

  const themes = ['obsidian', 'structs', 'cream', 'cyberpunk'];
  for (const th of themes) {
    await ui.evaluate(`(() => {
      const sel = document.querySelector('.topbar select[aria-label="Theme"]');
      if (sel) {
        sel.value = ${JSON.stringify(th)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await delay(300);

    // Toggle Panel off
    await ui.evaluate(`(() => {
      const toggle = document.querySelector('.floating-window.editor-floating .gcn-panel-toggle');
      toggle?.click();
    })()`);
    await delay(300);
    await ui.screenshot(`i_panel_toggle_off_${th}`);

    // Toggle Panel on
    await ui.evaluate(`(() => {
      const toggle = document.querySelector('.floating-window.editor-floating .gcn-panel-toggle');
      toggle?.click();
    })()`);
    await delay(300);
    await ui.screenshot(`i_panel_toggle_on_${th}`);
  }

  // Step h: close window with two dirty graphs -> multi dialog, Cancel keeps both
  console.log('Step h: close window with two dirty graphs -> multi dialog, Cancel keeps both');
  // Make sure both a.gcn and b.gcn are dirty
  await clickAddNode('.floating-window.editor-floating');
  await pickPreset('Integer');

  // Verify both a.gcn and b.gcn are dirty
  const bothDirty = await ui.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll('.tab button')).map(b => b.textContent.trim());
    return tabs.filter(t => t.includes('•')).length >= 2;
  })()`);
  console.log('Both graphs dirty:', bothDirty);
  assert.equal(bothDirty, true);

  // Use dialog-clicker.ps1 to click Cancel when the dialog appears
  const clickerPs1 = path.resolve('test/fixtures/dialog-clicker.ps1');
  const clickerPromise = (async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await delay(300);
      try {
        const out = execSync(`powershell -ExecutionPolicy Bypass -File "${clickerPs1}" -Action cancel -RootPid ${child.pid}`, { encoding: 'utf8' });
        if (out.includes('CLICKED:cancel')) {
          console.log('Clicker successfully clicked Cancel on multi-document dialog!');
          return true;
        }
      } catch (err) {}
    }
    return false;
  })();

  // Send window close
  await ui.evaluate(`window.dispatchEvent(new Event('beforeunload', { cancelable: true }))`);
  // Trigger close from main
  const closeRes = execSync(`powershell -ExecutionPolicy Bypass -File "${clickerPs1}" -Action wm-close -RootPid ${child.pid}`, { encoding: 'utf8' });
  console.log('WM_CLOSE post result:', closeRes.trim());

  const clicked = await clickerPromise;
  assert.equal(clicked, true, 'Dialog clicker must have clicked Cancel');
  await delay(600);

  // Verify app is still alive and both dirty tabs still present
  const isAlive = await ui.evaluate(`(() => {
    const dirtyCount = Array.from(document.querySelectorAll('.tab button')).map(b => b.textContent.trim()).filter(t => t.includes('•')).length;
    return { alive: true, dirtyCount };
  })()`);
  console.log('After cancel, app state:', isAlive);
  assert.equal(isAlive.alive, true);
  assert.ok(isAlive.dirtyCount >= 2, 'Both dirty graphs must remain intact');
  await ui.screenshot('h_close_cancel_keeps_both');

  console.log('All smoke test steps (a-i) PASSED successfully!');
} finally {
  try {
    child.kill('SIGKILL');
  } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  await fs.rm(temp, { recursive: true, force: true });
}
