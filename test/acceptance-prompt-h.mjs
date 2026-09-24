import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const screenshotDir = path.resolve('docs/geometry-stage3-shots');
await fs.mkdir(screenshotDir, { recursive: true });

try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-acceptance-h-'));
const projectDir = path.join(temp, 'project');
await fs.mkdir(projectDir, { recursive: true });

// --- Prepare 7 GCN files for each screenshot requirement ---

// 1. o_01: Canvas with a freshly dropped 'Var' node showing inline name, type, and starting value. Side panel OFF.
const shot01 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_val', name: 'value', type: 'int', initialValue: 0 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    { id: 'var1', type: 'getVariable', position: { x: 300, y: 180 }, data: { variableId: 'v_val' } }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_01.gcn'), JSON.stringify(shot01, null, 2), 'utf8');

// 2. o_02: Canvas with two 'Var' nodes: one unselected showing inline fields, one selected showing BOTH inline fields and outer-variable dropdown. Side panel OFF.
const shot02 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_score', name: 'score', type: 'int', initialValue: 100 },
    { id: 'v_player', name: 'player_name', type: 'string', initialValue: 'Ada' }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    { id: 'var_unsel', type: 'getVariable', position: { x: 300, y: 100 }, data: { variableId: 'v_score' } },
    { id: 'var_sel', type: 'getVariable', position: { x: 300, y: 280 }, data: { variableId: 'v_player' } }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_02.gcn'), JSON.stringify(shot02, null, 2), 'utf8');

// 3. o_03: Canvas with a Var node inside a Function body pointing to an outer module variable, showing '(outer)' annotation in picker. Side panel OFF.
const shot03 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_score', name: 'score', type: 'int', initialValue: 100 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    {
      id: 'fn_calc',
      type: 'functionDef',
      position: { x: 280, y: 120 },
      data: {
        name: 'calc_bonus',
        parameters: [],
        returnType: 'void',
        graph: {
          nodes: [
            { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
            { id: 'var_outer', type: 'getVariable', position: { x: 300, y: 180 }, data: { variableId: 'v_score' } }
          ],
          edges: [],
          variables: [
            { id: 'v_bonus', name: 'bonus', type: 'int', initialValue: 25 }
          ],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }
    }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_03.gcn'), JSON.stringify(shot03, null, 2), 'utf8');

// 4. o_04: Canvas with a String Literal node containing a 4-line text auto-expanded to fit, plus '↵ New line' tick visible. Side panel OFF.
const shot04 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    {
      id: 'sql_lit',
      type: 'literal',
      position: { x: 280, y: 100 },
      data: {
        valueType: 'string',
        value: 'SELECT user_id, username, score\nFROM leaderboards\nWHERE active = true\nORDER BY score DESC;\n'
      }
    }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_04.gcn'), JSON.stringify(shot04, null, 2), 'utf8');

// 5. o_05: Canvas with a Format Text node containing a multi-line template and '↵ New line' tick. Side panel OFF.
const shot05 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [
    { id: 'v_user', name: 'username', type: 'string', initialValue: 'Alice' },
    { id: 'v_lvl', name: 'level', type: 'int', initialValue: 12 }
  ],
  nodes: [
    { id: 'start', type: 'start', position: { x: 60, y: 180 }, data: {} },
    { id: 'g_user', type: 'getVariable', position: { x: 60, y: 260 }, data: { variableId: 'v_user' } },
    { id: 'g_lvl', type: 'getVariable', position: { x: 60, y: 400 }, data: { variableId: 'v_lvl' } },
    {
      id: 'fmt1',
      type: 'formatText',
      position: { x: 320, y: 120 },
      data: {
        style: 'fstring',
        template: 'Player Profile:\n- Name: {username}\n- Level: {level}\nStatus: Active\n'
      }
    }
  ],
  edges: [
    { id: 'e_u', source: 'g_user', sourceHandle: 'value', target: 'fmt1', targetHandle: '{username}' },
    { id: 'e_l', source: 'g_lvl', sourceHandle: 'value', target: 'fmt1', targetHandle: '{level}' }
  ],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_05.gcn'), JSON.stringify(shot05, null, 2), 'utf8');

// 6. o_06: Canvas with a Function node showing inline parameters ('name: string', 'count: int = 1') and 'returns int', plus '+ Param' button. Side panel OFF.
const shot06 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    {
      id: 'fn_greet',
      type: 'functionDef',
      position: { x: 280, y: 80 },
      data: {
        name: 'greet_user',
        parameters: [
          { id: 'p_name', name: 'name', type: 'string', defaultValue: null },
          { id: 'p_count', name: 'count', type: 'int', defaultValue: 1 }
        ],
        returnType: 'int',
        graph: {
          nodes: [{ id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} }],
          edges: [],
          variables: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }
    }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_06.gcn'), JSON.stringify(shot06, null, 2), 'utf8');

// 7. o_07: Canvas with an invalid parameter name showing red error ring and inline message on function node. Side panel OFF.
const shot07 = {
  format: 'nizyla.geometry-code',
  version: 2,
  target: 'python',
  variables: [],
  nodes: [
    { id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} },
    {
      id: 'fn_err',
      type: 'functionDef',
      position: { x: 280, y: 80 },
      data: {
        name: 'calculate',
        parameters: [
          { id: 'p_bad', name: '123invalid', type: 'int' }
        ],
        returnType: 'void',
        graph: {
          nodes: [{ id: 'start', type: 'start', position: { x: 80, y: 180 }, data: {} }],
          edges: [],
          variables: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }
    }
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
};
await fs.writeFile(path.join(projectDir, 'o_07.gcn'), JSON.stringify(shot07, null, 2), 'utf8');

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

  // Open project folder
  console.log('Opening project folder...');
  await wait("document.querySelector('.app-shell')");
  await ui.evaluate(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Open Folder')?.click()`);
  await wait("document.querySelector('.tree-row.file .name')");
  await delay(500);

  // Helper to activate a file from explorer
  async function activateFile(fileName, expectedNodeId = null) {
    await ui.evaluate(`(() => {
      const tabBtn = Array.from(document.querySelectorAll('.tab-wrap > button:first-child')).find(b => b.textContent.trim() === ${JSON.stringify(fileName)});
      if (tabBtn) {
        tabBtn.click();
        return;
      }
      const row = Array.from(document.querySelectorAll('.tree-row.file')).find(r => r.querySelector('.name')?.textContent?.trim() === ${JSON.stringify(fileName)});
      row?.click();
    })()`);
    if (expectedNodeId) {
      await wait(`[data-id="${expectedNodeId}"]`);
    } else {
      await wait('.gcn-node');
    }
    await delay(600);
  }

  // Helper to ensure side panel is TOGGLED OFF
  async function ensureSidePanelOff() {
    await ui.evaluate(`(() => {
      const btn = document.querySelector('button.gcn-panel-toggle');
      if (btn && btn.classList.contains('active')) {
        btn.click();
      }
    })()`);
    await delay(300);
  }

  // Helper to deselect all nodes
  async function deselectAll() {
    await ui.evaluate(`(() => {
      const pane = document.querySelector('.svelte-flow__pane');
      if (pane) {
        pane.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    })()`);
    await delay(200);
  }

  // --- Capture o_01 ---
  console.log('Capturing o_01.png: Freshly dropped Var node...');
  await activateFile('o_01.gcn', 'var1');
  await ensureSidePanelOff();
  await deselectAll();
  await delay(400);
  await ui.screenshot('o_01');

  // --- Capture o_02 ---
  console.log('Capturing o_02.png: Two Var nodes, one unselected, one selected with dropdown...');
  await activateFile('o_02.gcn', 'var_sel');
  await ensureSidePanelOff();
  // Select the second var node (var_sel)
  await ui.evaluate(`(() => {
    const nodeEl = document.querySelector('[data-id="var_sel"]');
    if (nodeEl) nodeEl.click();
  })()`);
  await delay(400);
  await ui.screenshot('o_02');

  // --- Capture o_03 ---
  console.log('Capturing o_03.png: Var node inside Function body pointing to outer variable with (outer) annotation...');
  await activateFile('o_03.gcn', 'fn_calc');
  await ensureSidePanelOff();
  // Click "Open Subgraph ⏎" on fn_calc
  await ui.evaluate(`(() => {
    const openBtn = document.querySelector('[data-id="fn_calc"] button.gcn-open-subgraph')
      || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Open Subgraph'));
    if (openBtn) openBtn.click();
  })()`);
  await wait('[data-id="var_outer"]');
  await delay(500);
  await ensureSidePanelOff();
  // Select var_outer so its dropdown is expanded / active
  await ui.evaluate(`(() => {
    const nodeEl = document.querySelector('[data-id="var_outer"]');
    if (nodeEl) nodeEl.click();
  })()`);
  await delay(400);
  await ui.screenshot('o_03');

  // --- Capture o_04 ---
  console.log('Capturing o_04.png: String Literal node auto-expanded with newline tick...');
  await activateFile('o_04.gcn', 'sql_lit');
  await ensureSidePanelOff();
  await deselectAll();
  await delay(400);
  await ui.screenshot('o_04');

  // --- Capture o_05 ---
  console.log('Capturing o_05.png: Format Text node multi-line template with newline tick...');
  await activateFile('o_05.gcn', 'fmt1');
  await ensureSidePanelOff();
  await deselectAll();
  await delay(400);
  await ui.screenshot('o_05');

  // --- Capture o_06 ---
  console.log('Capturing o_06.png: Function node with inline parameters and returns int...');
  await activateFile('o_06.gcn', 'fn_greet');
  await ensureSidePanelOff();
  await deselectAll();
  await delay(400);
  await ui.screenshot('o_06');

  // --- Capture o_07 ---
  console.log('Capturing o_07.png: Function node with invalid parameter name and error ring...');
  await activateFile('o_07.gcn', 'fn_err');
  await ensureSidePanelOff();
  await deselectAll();
  await delay(400);
  await ui.screenshot('o_07');

  console.log('All 7 screenshots captured successfully!');
  await ui.close();
  await main.close();
} finally {
  try { child.kill(); } catch {}
  try { execSync('taskkill /IM NiZyLa.exe /F /T', { stdio: 'ignore' }); } catch {}
  await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
}
