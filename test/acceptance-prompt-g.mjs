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

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-acceptance-g-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// 1. Create a Python file for the editor screenshots
const samplePy = `"""Signal Processing and Pipeline Controller."""
import sys
import math

class DataProcessor:
    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate
        self.channels = 2
        self.active = True

    def process_signal(self, buffer):
        # Apply gain and filtering
        gain = 1.25
        result = [sample * gain for sample in buffer]
        return result

def main():
    processor = DataProcessor(48000)
    print(f"Processor ready at {processor.sample_rate} Hz")

if __name__ == "__main__":
    main()
`;
await fs.writeFile(path.join(projectDir, 'main.py'), samplePy, 'utf8');

// 2. Create test.gcn with >= 6 nodes and 1 error diagnostic
// A break node placed outside a loop produces a loop-control-outside-loop error diagnostic!
const testGcn = JSON.stringify({
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_count', name: 'count', type: 'int', initialValue: 0 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 40, y: 120 }, data: {} },
    { id: 'l1', type: 'literal', position: { x: 220, y: 50 }, data: { valueType: 'int', value: 42 } },
    { id: 'l2', type: 'literal', position: { x: 220, y: 150 }, data: { valueType: 'int', value: 10 } },
    { id: 'add1', type: 'binary', position: { x: 400, y: 80 }, data: { operator: '+' } },
    { id: 'pr1', type: 'print', position: { x: 600, y: 120 }, data: { argCount: 1 } },
    { id: 'brk1', type: 'break', position: { x: 780, y: 120 }, data: {} }
  ],
  edges: [
    { id: 'e_start_pr', source: 'start', sourceHandle: 'next', target: 'pr1', targetHandle: 'in' },
    { id: 'e_l1_add', source: 'l1', sourceHandle: 'value', target: 'add1', targetHandle: 'a' },
    { id: 'e_l2_add', source: 'l2', sourceHandle: 'value', target: 'add1', targetHandle: 'b' },
    { id: 'e_add_pr', source: 'add1', sourceHandle: 'value', target: 'pr1', targetHandle: 'value' },
    { id: 'e_pr_brk', source: 'pr1', sourceHandle: 'next', target: 'brk1', targetHandle: 'in' }
  ],
  viewport: { x: 0, y: 0, zoom: 0.95 }
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
await delay(3000);
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
  await delay(1000);

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

  // Load Google Fonts so document.fonts.check returns true
  console.log('Loading and checking Google Fonts...');
  await ui.evaluate(`(async () => {
    try {
      await Promise.all([
        document.fonts.load('16px "Saira"'),
        document.fonts.load('16px "Share Tech Mono"'),
        document.fonts.load('16px "Chakra Petch"'),
        document.fonts.load('16px "Kode Mono"'),
        document.fonts.load('16px "Archivo Narrow"'),
        document.fonts.load('16px "IBM Plex Mono"')
      ]);
    } catch {}
  })()`);
  await delay(600);

  const fontsChecked = await ui.evaluate(`({
    saira: document.fonts.check('16px "Saira"'),
    shareTech: document.fonts.check('16px "Share Tech Mono"'),
    chakraPetch: document.fonts.check('16px "Chakra Petch"'),
    kodeMono: document.fonts.check('16px "Kode Mono"'),
    archivoNarrow: document.fonts.check('16px "Archivo Narrow"'),
    ibmPlexMono: document.fonts.check('16px "IBM Plex Mono"')
  })`);
  console.log('Loaded fonts check results:', fontsChecked);

  // Helper to change theme in topbar select
  async function selectThemeInTopBar(themeId) {
    await ui.evaluate(`(() => {
      const sel = Array.from(document.querySelectorAll('.topbar select')).find(s => s.getAttribute('aria-label') === 'Theme')
        || document.querySelector('.topbar select');
      if (sel) {
        sel.value = ${JSON.stringify(themeId)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await delay(500);
  }

  // Helper to activate a file (from tab if open, or explorer)
  async function activateFile(fileName) {
    await ui.evaluate(`(() => {
      const tabBtn = Array.from(document.querySelectorAll('.tab-wrap > button:first-child')).find(b => b.textContent.trim() === ${JSON.stringify(fileName)});
      if (tabBtn) {
        tabBtn.click();
        return;
      }
      const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === ${JSON.stringify(fileName)});
      row?.click();
    })()`);
    await delay(700);
  }

  // 2. Acceptance Behaviour Checks:
  console.log('2. Running Behaviour Checks...');

  // A. Choose Hazard Acid in the TOP-BAR select
  console.log('Behaviour A: Choose Hazard Acid in top bar select');
  await selectThemeInTopBar('acid');

  // Open main.py
  await activateFile('main.py');
  await wait('.cm-editor');

  // Check: editor shows Kode Mono, UI shows Chakra Petch
  const acidFonts = await ui.evaluate(`(() => {
    const cm = document.querySelector('.cm-content') || document.querySelector('.cm-editor');
    const edFont = cm ? getComputedStyle(cm).fontFamily : '';
    const uiFont = getComputedStyle(document.body).fontFamily;
    return { edFont, uiFont };
  })()`);
  console.log('Acid fonts:', acidFonts);
  assert.ok(acidFonts.edFont.includes('Kode Mono'), 'Editor should show Kode Mono in acid theme');
  assert.ok(acidFonts.uiFont.includes('Chakra Petch'), 'UI should show Chakra Petch in acid theme');

  // B. Preferences -> Fonts shows Kode Mono as active
  console.log('Behaviour B: Preferences -> Fonts shows Kode Mono as active');
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preferences'))?.click()`);
  await wait('.pref-modal');
  // Switch to fonts tab
  await ui.evaluate(`Array.from(document.querySelectorAll('.pref-tab')).find(t => t.textContent.includes('Fonts'))?.click()`);
  await delay(300);
  const activeFontCard = await ui.evaluate(`(() => {
    const active = document.querySelector('.font-card.active') || document.querySelector('.font-option.active');
    return active ? active.textContent : '';
  })()`);
  console.log('Active font card in preferences:', activeFontCard);
  assert.ok(activeFontCard.includes('Kode Mono'), 'Active font in Preferences should be Kode Mono');

  // C. Turn "Apply font to entire UI" on: the UI switches to Kode Mono
  console.log('Behaviour C: Turn Apply font to entire UI on');
  await ui.evaluate(`(() => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    if (checkbox && !checkbox.checked) {
      checkbox.click();
    }
  })()`);
  await delay(400);
  const uiFontAfterToggle = await ui.evaluate(`getComputedStyle(document.body).fontFamily`);
  console.log('UI font after fontUi toggle:', uiFontAfterToggle);
  assert.ok(uiFontAfterToggle.includes('Kode Mono'), 'UI should switch to Kode Mono when fontUi is active');

  // Close preferences modal
  await ui.evaluate(`(() => {
    const closeBtn = document.querySelector('.pref-close-btn');
    if (closeBtn) closeBtn.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  })()`);
  await delay(400);

  // D. Switch back to Obsidian: JetBrains Mono returns
  console.log('Behaviour D: Switch back to Obsidian');
  await selectThemeInTopBar('obsidian');
  const obsidianFont = await ui.evaluate(`(() => {
    const cm = document.querySelector('.cm-content') || document.querySelector('.cm-editor');
    return cm ? getComputedStyle(cm).fontFamily : '';
  })()`);
  console.log('Obsidian editor font:', obsidianFont);
  assert.ok(obsidianFont.includes('JetBrains Mono'), 'Obsidian should use JetBrains Mono');

  // E. The Preferences cards and the command palette list all 7 themes
  console.log('Behaviour E: Preferences cards and command palette list all 7 themes');
  // Open preferences modal
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preferences'))?.click()`);
  await wait('.pref-modal');
  // Switch to theme tab
  await ui.evaluate(`Array.from(document.querySelectorAll('.pref-tab')).find(t => t.textContent.includes('Color Theme') || t.textContent.includes('Theme'))?.click()`);
  await delay(300);
  const themeCardNames = await ui.evaluate(`
    Array.from(document.querySelectorAll('.theme-card strong')).map(s => s.textContent.trim())
  `);
  console.log('Theme card names:', themeCardNames);
  const expectedThemes = [
    'Structs Teal (Indie Sci-Fi)',
    'Obsidian Dark',
    'Cream Light',
    'Cyberpunk Neon',
    'Signal Sage',
    'Hazard Acid',
    'Swiss Mono'
  ];
  for (const name of expectedThemes) {
    assert.ok(themeCardNames.includes(name), `Preferences cards must include ${name}`);
  }

  // Close preferences modal
  await ui.evaluate(`(() => {
    const closeBtn = document.querySelector('.pref-close-btn');
    if (closeBtn) closeBtn.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  })()`);
  await delay(400);

  // Open Command Palette (Ctrl+P or Ctrl+K)
  await ui.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true }))`);
  await wait('.palette');
  const paletteThemeButtons = await ui.evaluate(`
    Array.from(document.querySelectorAll('.palette button'))
      .map(b => b.textContent.trim())
      .filter(t => t.startsWith('Theme:'))
  `);
  console.log('Palette theme buttons:', paletteThemeButtons);
  for (const name of expectedThemes) {
    assert.ok(
      paletteThemeButtons.some(b => b.includes(name)),
      `Command palette must include Theme: ${name}`
    );
  }
  // Close palette
  await ui.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
  await delay(400);

  // 3. CAPTURE REAL-WINDOW SCREENSHOTS AT 1400x860
  console.log('3. Capturing real-window screenshots at 1400x860...');

  // Open test.gcn first so both tabs are present
  await activateFile('test.gcn');
  await wait('.gcn-canvas');

  const newThemes = ['sage', 'acid', 'swiss'];

  for (const tid of newThemes) {
    console.log(`--- Theme ${tid} ---`);
    await selectThemeInTopBar(tid);

    // Shot 1: n_<id>_editor: a .py file plus the Explorer
    await activateFile('main.py');
    await wait('.cm-editor');
    await delay(600);
    await ui.screenshot(`n_${tid}_editor`);

    // Shot 2: n_<id>_gcn: at least 6 nodes, one error diagnostic, the Add menu open
    await activateFile('test.gcn');
    await wait('.gcn-canvas');
    await delay(600);

    // Open the Add menu
    await ui.evaluate(`(() => {
      const addBtn = Array.from(document.querySelectorAll('.gcn-toolbar button')).find(b => b.textContent.includes('+ Add Node'));
      addBtn?.click();
    })()`);
    await delay(500);
    await wait('.gcn-menu');
    await ui.screenshot(`n_${tid}_gcn`);

    // Close Add menu
    await ui.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
    await delay(400);

    // Shot 3: n_<id>_prefs: the Preferences theme cards
    await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preferences'))?.click()`);
    await wait('.pref-modal');
    await ui.evaluate(`Array.from(document.querySelectorAll('.pref-tab')).find(t => t.textContent.includes('Color Theme') || t.textContent.includes('Theme'))?.click()`);
    await delay(600);
    await ui.screenshot(`n_${tid}_prefs`);

    // Close Preferences modal
    await ui.evaluate(`(() => {
      const closeBtn = document.querySelector('.pref-close-btn');
      if (closeBtn) closeBtn.click();
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    })()`);
    await delay(400);
  }

  // Regression shots for existing themes: obsidian, cream, structs, cyberpunk
  console.log('Capturing regression screenshots for existing themes...');
  const existingThemes = ['obsidian', 'cream', 'structs', 'cyberpunk'];
  for (const tid of existingThemes) {
    console.log(`Regression shot for ${tid}...`);
    await selectThemeInTopBar(tid);
    await activateFile('test.gcn');
    await wait('.gcn-canvas');
    await delay(600);
    await ui.screenshot(`n_regression_${tid}`);
  }

  console.log('ALL ACCEPTANCE CHECKS AND SCREENSHOTS COMPLETED SUCCESSFULLY!');
} finally {
  try { child.kill(); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
}
