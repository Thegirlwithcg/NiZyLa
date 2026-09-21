import assert from 'node:assert/strict';
import { spawn, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const screenshotDir = path.resolve('release/smoke-screenshots');
const screenshotPath = path.join(screenshotDir, 'main-guard-collapsed.png');

await fs.mkdir(screenshotDir, { recursive: true });

// Kill any old instance
try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-smoke-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

const pythonSource = `def main():
    if (5.0 <= 10.0):
        print((5.0 * 10.0))
    else:
        print(5.0)


if __name__ == "__main__":
    main()
`;

const samplePyPath = path.join(projectDir, 'sample.py');
await fs.writeFile(samplePyPath, pythonSource, 'utf8');

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

  async function clickText(text, containerSelector = 'body') {
    await ui.evaluate(`(() => {
      const container = document.querySelector(${JSON.stringify(containerSelector)}) || document.body;
      const el = Array.from(container.querySelectorAll('button, span, a, div')).find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.title === ${JSON.stringify(text)});
      if (!el) throw new Error('Element not found with text: ' + ${JSON.stringify(text)});
      el.click();
    })()`);
  }

  // 1. Open project folder
  await wait("document.querySelector('.app-shell')");
  await clickText('Open Folder');
  await wait("document.querySelector('.tree-row.file .name')");

  // 2. Select sample.py
  await ui.evaluate(`(() => {
    const fileRow = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent === 'sample.py');
    if (!fileRow) throw new Error('sample.py not found in tree');
    fileRow.click();
  })()`);
  await delay(400);

  // 3. Click Convert to .gcn
  await wait("document.querySelector('button[title*=\"Convert\"]')");
  await ui.evaluate(`document.querySelector('button[title*=\"Convert\"]').click()`);
  await delay(800);

  // 4. Verify we are in Geometry view
  await wait("document.querySelector('.gcn-workspace')");
  console.log('Opened Geometry Workspace');

  // Click Fit View to show all nodes nicely
  await ui.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Fit View'));
    if (btn) btn.click();
  })()`);
  await delay(500);

  // Check root nodes: exactly 3 nodes: start, functionDef, functionCall
  const nodeCount = await ui.evaluate(`document.querySelectorAll('.gcn-node').length`);
  console.log('Node count on canvas:', nodeCount);
  assert.equal(nodeCount, 3, `Expected 3 nodes, got ${nodeCount}`);

  const nodeTypes = await ui.evaluate(`Array.from(document.querySelectorAll('.gcn-node')).map(n => n.dataset.nodeType)`);
  console.log('Node types:', nodeTypes);
  assert.deepEqual(nodeTypes.sort(), ['functionCall', 'functionDef', 'start']);

  // Verify checkbox exists and is checked
  const isChecked = await ui.evaluate(`document.querySelector('.gcn-check input[type="checkbox"]')?.checked`);
  console.log('Main guard checkbox checked:', isChecked);
  assert.equal(isChecked, true, 'Main guard checkbox should be checked');

  // Verify Code Preview text
  const previewText = await ui.evaluate(`(() => {
    const lines = Array.from(document.querySelectorAll('.gcn-preview .cm-line'));
    return lines.map(l => l.textContent).join('\\n');
  })()`);
  console.log('Code preview:\n', previewText);
  const normalizedPreview = previewText.replace(/\r\n/g, '\n').trim();
  const expectedPreview = `def main():
    if (5.0 <= 10.0):
        print((5.0 * 10.0))
    else:
        print(5.0)

if __name__ == "__main__":
    main()`.trim();
  assert.equal(normalizedPreview, expectedPreview, 'Code preview should match expected code exactly');

  // Capture screenshot
  const screenshotRes = await ui.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(screenshotPath, Buffer.from(screenshotRes.data, 'base64'));
  console.log('Saved screenshot to:', screenshotPath);

  // 5. Uncheck the checkbox -> preview should lose guard, showing main()
  const clickResult = await ui.evaluate(`(() => {
    const cb = document.querySelector('.gcn-check input[type="checkbox"]');
    if (!cb) return 'NO_CB';
    const before = cb.checked;
    cb.click();
    return { before, after: cb.checked };
  })()`);
  console.log('Click result:', clickResult);
  await delay(500);

  const isCheckedAfter = await ui.evaluate(`document.querySelector('.gcn-check input[type="checkbox"]')?.checked`);
  console.log('isCheckedAfter:', isCheckedAfter);
  assert.equal(isCheckedAfter, false, 'Checkbox should be unchecked');

  const previewAfterUncheck = (await ui.evaluate(`(() => {
    const lines = Array.from(document.querySelectorAll('.gcn-preview .cm-line'));
    return lines.map(l => l.textContent).join('\\n');
  })()`)).trim();
  console.log('Code preview after uncheck:\n', previewAfterUncheck);
  assert.ok(!previewAfterUncheck.includes('if __name__ == "__main__":'), 'Preview should not have main guard');
  assert.ok(previewAfterUncheck.endsWith('main()'), 'Preview should have main() at the end');

  // 6. Undo -> guard should return
  await ui.evaluate(`(() => {
    const undoBtn = document.querySelector('button[title*="Undo"]');
    if (undoBtn) undoBtn.click();
    else throw new Error('Undo button not found');
  })()`);
  await delay(500);

  const isCheckedAfterUndo = await ui.evaluate(`document.querySelector('.gcn-check input[type="checkbox"]')?.checked`);
  console.log('Checkbox after Undo:', isCheckedAfterUndo);
  assert.equal(isCheckedAfterUndo, true, 'Checkbox should be checked again after Undo');

  const previewAfterUndo = (await ui.evaluate(`(() => {
    const lines = Array.from(document.querySelectorAll('.gcn-preview .cm-line'));
    return lines.map(l => l.textContent).join('\\n');
  })()`)).trim();
  console.log('Code preview after undo:\n', previewAfterUndo);
  assert.equal(previewAfterUndo, expectedPreview, 'Code preview should match expected code after Undo');

  // Also verify keyboard shortcut Ctrl+Z
  await ui.evaluate(`(() => {
    const cb = document.querySelector('.gcn-check input[type="checkbox"]');
    cb.click();
  })()`);
  await delay(400);
  assert.equal(await ui.evaluate(`document.querySelector('.gcn-check input[type="checkbox"]')?.checked`), false);

  await ui.evaluate(`(() => {
    const ws = document.querySelector('.gcn-workspace');
    ws.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
  })()`);
  await delay(400);
  assert.equal(await ui.evaluate(`document.querySelector('.gcn-check input[type="checkbox"]')?.checked`), true, 'Keyboard Ctrl+Z should undo');

  console.log('All smoke acceptance checks PASSED!');
} finally {
  try { child.kill(); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  try { await fs.rm(temp, { recursive: true, force: true }); } catch {}
}
