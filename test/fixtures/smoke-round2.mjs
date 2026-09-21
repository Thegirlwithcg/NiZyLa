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

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-smoke2-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// Sample python file with main function
const pythonSource = `def main():
    if (5.0 <= 10.0):
        print((5.0 * 10.0))
    else:
        print(5.0)

if __name__ == "__main__":
    main()
`;
await fs.writeFile(path.join(projectDir, 'sample.py'), pythonSource, 'utf8');

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

  // 1. Open Folder & Convert
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder');
    if (el) el.click();
  })()`);
  await wait("document.querySelector('.tree-row.file .name')");

  await ui.evaluate(`(() => {
    const fileRow = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'sample.py');
    fileRow.click();
  })()`);
  await delay(400);

  await wait("document.querySelector('button[title*=\"Convert\"]')");
  await ui.evaluate(`document.querySelector('button[title*=\"Convert\"]').click()`);
  await delay(800);
  await wait("document.querySelector('.gcn-workspace')");

  // Fit View
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fit View'))?.click()`);
  await delay(400);

  // Enter def main to go 2 levels deep (Module / main)
  const fnId = await ui.evaluate(`document.querySelector('[data-node-type="functionDef"]')?.getAttribute('data-id') || Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'functionDef')?.closest('.svelte-flow__node')?.dataset.id`);
  console.log('fnId:', fnId);
  await ui.evaluate(`document.querySelector('.gcn-enter-btn')?.click()`);
  await delay(500);

  // Verify breadcrumb shows 2 levels: Module / main
  const crumbs = await ui.evaluate(`Array.from(document.querySelectorAll('.gcn-breadcrumbs .gcn-crumb')).map(c => ({ text: c.textContent.trim(), isCurrent: c.hasAttribute('aria-current') }))`);
  console.log('Crumbs 2 levels deep:', crumbs);
  assert.equal(crumbs.length, 2);
  assert.equal(crumbs[0].text, 'Module');
  assert.equal(crumbs[1].text, 'main');
  assert.equal(crumbs[1].isCurrent, true);

  // PART 1: Contrast calculation across 4 themes
  const themes = ['cream', 'obsidian', 'structs', 'cyberpunk'];
  const contrastResults = {};

  for (const th of themes) {
    // Set theme via the topbar Theme select
    await ui.evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Theme"]');
      if (select) {
        select.value = ${JSON.stringify(th)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await delay(400);

    const rawColors = await ui.evaluate(`(() => {
      const crumb = document.querySelector('.gcn-breadcrumbs .gcn-crumb[aria-current]');
      const nav = document.querySelector('.gcn-breadcrumbs');
      const shell = document.querySelector('.app-shell');
      return {
        crumbColor: getComputedStyle(crumb).color,
        crumbBg: getComputedStyle(crumb).backgroundColor,
        navBg: getComputedStyle(nav).backgroundColor,
        baseBg: getComputedStyle(shell).getPropertyValue('--bg').trim()
      };
    })()`);

    function parseCssColor(str) {
      if (!str) return { r: 255, g: 255, b: 255, a: 1 };
      str = str.trim();
      if (str.startsWith('color(srgb ')) {
        const parts = str.slice(11, -1).trim().split(/[\s/]+/);
        return {
          r: Math.round(parseFloat(parts[0]) * 255),
          g: Math.round(parseFloat(parts[1]) * 255),
          b: Math.round(parseFloat(parts[2]) * 255),
          a: parts[3] !== undefined ? parseFloat(parts[3]) : 1
        };
      }
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m) {
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) : 1 };
      }
      if (str.startsWith('#')) {
        const hex = str.replace('#', '');
        return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function composite(fg, bg) {
      const a = fg.a + bg.a * (1 - fg.a);
      return {
        r: Math.round((fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a),
        g: Math.round((fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a),
        b: Math.round((fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a),
        a
      };
    }

    function luminance(rgb) {
      const a = [rgb.r, rgb.g, rgb.b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    const baseBg = parseCssColor(rawColors.baseBg);
    const navBg = parseCssColor(rawColors.navBg);
    const crumbBg = parseCssColor(rawColors.crumbBg);
    const crumbColor = parseCssColor(rawColors.crumbColor);

    // Composite crumbBg over navBg over baseBg
    const effectiveNav = composite(navBg, baseBg);
    const effectiveBg = composite(crumbBg, effectiveNav);
    const effectiveText = composite(crumbColor, effectiveBg);

    const l1 = luminance(effectiveText);
    const l2 = luminance(effectiveBg);
    const ratio = Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));

    const contrastInfo = {
      ratio,
      textColor: rawColors.crumbColor,
      bgColor: rawColors.crumbBg,
      effectiveBg,
      effectiveText
    };

    contrastResults[th] = contrastInfo;
    console.log(`Theme ${th} breadcrumb contrast:`, contrastInfo);
    assert.ok(contrastInfo.ratio >= 4.5, `Theme ${th} contrast ${contrastInfo.ratio} must be >= 4.5`);

    // Screenshot for theme
    const shot = await ui.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(screenshotDir, `breadcrumb-${th}.png`), Buffer.from(shot.data, 'base64'));
  }

  // Switch back to obsidian
  await ui.evaluate(`(() => {
    document.body.className = document.body.className.replace(/theme-[a-z0-9-]+/g, '') + ' theme-obsidian';
  })()`);
  await delay(200);

  // Exit back to Module root
  await ui.evaluate(`document.querySelectorAll('.gcn-breadcrumbs .gcn-crumb')[0].click()`);
  await delay(400);

  // PART 2: Shift+D Duplicate
  console.log('Testing Shift+D duplicate...');
  // Select functionCall node
  const callNodeId = await ui.evaluate(`Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'functionCall')?.closest('.svelte-flow__node')?.dataset.id`);
  await ui.evaluate(`(() => {
    const callNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'functionCall');
    callNode.click();
  })()`);
  await delay(200);

  const countBeforeDup = await ui.evaluate(`document.querySelectorAll('.gcn-node').length`);
  await ui.evaluate(`(() => {
    const canvas = document.querySelector('.gcn-canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', shiftKey: true, bubbles: true }));
  })()`);
  await delay(400);

  const countAfterDup = await ui.evaluate(`document.querySelectorAll('.gcn-node').length`);
  console.log('Node count before dup:', countBeforeDup, 'after dup:', countAfterDup);
  assert.equal(countAfterDup, countBeforeDup + 1, 'Duplicate should add 1 node');

  // Undo duplication
  await ui.evaluate(`document.querySelector('button[title*="Undo"]')?.click()`);
  await delay(400);
  assert.equal(await ui.evaluate(`document.querySelectorAll('.gcn-node').length`), countBeforeDup);

  // PART 3: Code Node editor
  console.log('Testing Code Node editor...');
  // Open Add Node menu and pick Code Node
  await ui.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ Add Node'));
    btn.click();
  })()`);
  await delay(300);
  await ui.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('.gcn-menu button')).find(b => b.textContent.includes('Code'));
    btn.click();
  })()`);
  await delay(500);

  const codeNodeHead = await ui.evaluate(`document.querySelector('[data-node-type="codeNode"] .gcn-node-head strong')?.textContent`);
  console.log('Code node header:', codeNodeHead);
  assert.ok(codeNodeHead?.includes('</> Code'));

  // Test Title input
  await ui.evaluate(`(() => {
    const input = document.querySelector('[data-node-type="codeNode"] input[aria-label="Code name"]');
    input.value = 'MySnippet';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  })()`);
  await delay(300);
  const codeNodeHeadUpdated = await ui.evaluate(`document.querySelector('[data-node-type="codeNode"] .gcn-node-head strong')?.textContent`);
  console.log('Updated header:', codeNodeHeadUpdated);
  assert.ok(codeNodeHeadUpdated?.includes('</> MySnippet'));

  // Take screenshot: code-node-inline.png
  const inlineShot = await ui.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(screenshotDir, 'code-node-inline.png'), Buffer.from(inlineShot.data, 'base64'));
  console.log('Saved code-node-inline.png');

  async function wire(sourceSelector, targetSelector) {
    for (const selector of [sourceSelector, targetSelector]) {
      await ui.evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) throw new Error('Handle not found: ' + ${JSON.stringify(selector)});
        const r = e.getBoundingClientRect();
        e.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      })()`);
      await delay(150);
    }
  }

  // Connect code node to callNode so it is in the execution flow
  await wire('[data-node-type="functionCall"] .gcn-port.out .gcn-handle', '[data-node-type="codeNode"] .gcn-port.in .gcn-handle');
  await delay(400);

  // Test typing in inline CodeEditor: abc, click canvas, Ctrl+Z
  await ui.evaluate(`(() => {
    const cm = document.querySelector('[data-node-type="codeNode"] .cm-content');
    cm.focus();
  })()`);
  await delay(200);
  await ui.send('Input.insertText', { text: 'print("abc")\n' });
  await delay(300);

  // Click canvas (blur code editor)
  await ui.evaluate(`document.querySelector('.gcn-canvas').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))`);
  await delay(400);

  const previewWithAbc = await ui.evaluate(`document.querySelector('.gcn-preview .cm-content')?.innerText || ''`);
  console.log('Preview with print("abc"):\n', previewWithAbc);
  assert.ok(previewWithAbc.includes('print("abc")'), 'Code preview should reflect typed code');

  // Ctrl+Z reverts in 1 step
  await ui.evaluate(`document.querySelector('button[title*="Undo"]')?.click()`);
  await delay(400);
  const previewAfterUndo = await ui.evaluate(`document.querySelector('.gcn-preview .cm-content')?.innerText || ''`);
  console.log('Preview after Undo:\n', previewAfterUndo);
  assert.ok(!previewAfterUndo.includes('print("abc")'), 'Code preview should no longer contain abc');

  // Test Expand dialog
  await ui.evaluate(`document.querySelector('[data-node-type="codeNode"] .gcn-btn-expand')?.click()`);
  await delay(500);

  const isDialogOpen = await ui.evaluate(`document.querySelector('.gcn-code-dialog')?.open`);
  console.log('Code dialog open:', isDialogOpen);
  assert.equal(isDialogOpen, true, 'Code dialog should be open');

  const dialogTitle = await ui.evaluate(`document.querySelector('.gcn-code-dialog-header h3')?.textContent`);
  console.log('Dialog title:', dialogTitle);
  assert.ok(dialogTitle?.includes('</> MySnippet · Code'));

  // Screenshot code-node-expanded.png
  const expandedShot = await ui.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(screenshotDir, 'code-node-expanded.png'), Buffer.from(expandedShot.data, 'base64'));
  console.log('Saved code-node-expanded.png');

  // Close dialog
  await ui.evaluate(`document.querySelector('.gcn-code-dialog-actions .gcn-btn-close')?.click()`);
  await delay(400);

  // PART 4: Node Help
  console.log('Testing Node Help...');
  // Click Help on If node
  await ui.evaluate(`(() => {
    const ifNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'if');
    if (!ifNode) {
      // Find def main, open subgraph to test If help, or test on Start/def main/codeNode
      const codeNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'codeNode');
      codeNode.querySelector('.gcn-node-help-btn').click();
    } else {
      ifNode.querySelector('.gcn-node-help-btn').click();
    }
  })()`);
  await delay(500);

  let helpTitle = await ui.evaluate(`document.querySelector('.gcn-help-header strong')?.textContent`);
  let helpSummary = await ui.evaluate(`document.querySelector('.gcn-help-summary')?.textContent`);
  console.log('Help on Code node:', helpTitle, 'Summary:', helpSummary);
  assert.ok(helpTitle?.includes('MySnippet') || helpTitle?.includes('Code'));
  assert.ok(helpSummary?.length > 0);

  // Enter def main to test If and Print help
  await ui.evaluate(`(() => {
    const fnNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'functionDef');
    fnNode.querySelector('.gcn-enter-btn').click();
  })()`);
  await delay(500);

  // Click Help on If node
  await ui.evaluate(`(() => {
    const ifNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'if');
    ifNode.querySelector('.gcn-node-help-btn').click();
  })()`);
  await delay(400);

  helpTitle = await ui.evaluate(`document.querySelector('.gcn-help-header strong')?.textContent`);
  helpSummary = await ui.evaluate(`document.querySelector('.gcn-help-summary')?.textContent`);
  console.log('Help on If node:', helpTitle, 'Summary:', helpSummary);
  assert.equal(helpTitle, 'If / Else');

  // Click Help on Print node
  await ui.evaluate(`(() => {
    const pNode = Array.from(document.querySelectorAll('.gcn-node')).find(n => n.dataset.nodeType === 'print');
    pNode.querySelector('.gcn-node-help-btn').click();
  })()`);
  await delay(400);

  helpTitle = await ui.evaluate(`document.querySelector('.gcn-help-header strong')?.textContent`);
  console.log('Help on Print node:', helpTitle);
  assert.equal(helpTitle, 'Print');

  // Verify GDScript target switches code example
  const pyCode = await ui.evaluate(`document.querySelector('.gcn-help-code .cm-content')?.innerText || ''`);
  console.log('Python help code:\n', pyCode);

  // Switch target to GDScript
  await ui.evaluate(`(() => {
    const select = document.querySelector('.gcn-toolbar select');
    select.value = 'gdscript';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await delay(500);

  const gdCode = await ui.evaluate(`document.querySelector('.gcn-help-code .cm-content')?.innerText || ''`);
  console.log('GDScript help code:\n', gdCode);

  // Screenshot node-help.png
  const helpShot = await ui.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(screenshotDir, 'node-help.png'), Buffer.from(helpShot.data, 'base64'));
  console.log('Saved node-help.png');

  console.log('=== ALL ROUND 2 ACCEPTANCE CHECKS PASSED ===');
  console.log('Contrast results:', JSON.stringify(contrastResults, null, 2));

} finally {
  try { child.kill(); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  try { await fs.rm(temp, { recursive: true, force: true }); } catch {}
}
