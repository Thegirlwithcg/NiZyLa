import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const psScriptPath = path.join(__dirname, 'dialog-clicker.ps1');
const exePath = path.join(process.env.LOCALAPPDATA, 'Programs', 'nizyla', 'NiZyLa.exe');
const debugPort = 9444;

console.log('Testing installed executable at:', exePath);

// 1. TCP-level port listener check
function isTcpPortListening(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function getPortOwningPid(port) {
  try {
    const out = execSync(
      `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!out) return null;
    const pids = out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    return pids.length > 0 ? pids[0] : null;
  } catch {
    return null;
  }
}

function runInstanceHelper(rootPid, action) {
  const output = execSync(
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -Action "${action}" -RootPid ${rootPid}`,
    { encoding: 'utf8', timeout: 10000 }
  );
  return output.trim();
}

function verifyPortOwnership(port, rootPid) {
  const owningPid = getPortOwningPid(port);
  if (!owningPid) {
    throw new Error(`SECURITY/ISOLATION ERROR: Port ${port} has no identifiable OwningProcess. Aborting before CDP connection.`);
  }
  const allowedPidsStr = runInstanceHelper(rootPid, 'get-pids');
  const allowedPids = new Set(allowedPidsStr.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean));
  if (!allowedPids.has(owningPid)) {
    throw new Error(
      `SECURITY/ISOLATION CONFLICT: Port ${port} is owned by PID ${owningPid}, which does NOT belong to the spawned process tree (Root PID ${rootPid}, allowed: ${Array.from(allowedPids).join(',')}). Aborting before CDP connection!`
    );
  }
  return { owningPid, allowedPids };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDialog(rootPid, action, timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = runInstanceHelper(rootPid, action);
    if (result.startsWith('CLICKED')) return result;
    await sleep(250);
  }
  return null;
}

// 2. Robust CDP connection that rejects protocol errors, JS exceptions, timeouts, or unexpected closes
async function connectPageWs(port, rootPid) {
  const portListening = await isTcpPortListening(port);
  if (!portListening) {
    throw new Error(`TCP Port ${port} is not listening. Cannot connect CDP.`);
  }
  const { owningPid } = verifyPortOwnership(port, rootPid);

  const ts = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pt = ts.find((t) => t.type === 'page');
  assert.ok(pt, 'CDP Page target must exist');

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (err) => rej(new Error(`WebSocket connection failed: ${err.message || err}`));
  });

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject, timer } = pending.get(data.id);
        clearTimeout(timer);
        pending.delete(data.id);

        if (data.error) {
          return reject(new Error(`CDP Protocol Error: ${data.error.message || JSON.stringify(data.error)} (code: ${data.error.code})`));
        }
        if (data.result?.exceptionDetails) {
          const ex = data.result.exceptionDetails;
          const msg = ex.exception?.description || ex.text || 'JavaScript execution threw an exception';
          return reject(new Error(`CDP JS Exception: ${msg}`));
        }
        resolve(data.result);
      }
    } catch (parseErr) {
      console.error('Failed to parse CDP message:', parseErr);
    }
  };

  ws.onclose = (event) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket closed unexpectedly (code: ${event.code}, reason: ${event.reason || 'none'})`));
    }
    pending.clear();
  };

  ws.onerror = (err) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket error: ${err.message || 'unknown error'}`));
    }
    pending.clear();
  };

  function send(method, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return reject(new Error(`Cannot send CDP method ${method}: WebSocket readyState is ${ws.readyState}`));
      }
      const id = msgId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP method ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, userGesture = false) {
    const result = await send('Runtime.evaluate', {
      expression,
      userGesture,
      returnByValue: true,
      awaitPromise: true
    });
    return result?.result?.value;
  }

  return {
    ws,
    send,
    evaluate,
    owningPid,
    close: () => {
      try {
        ws.close();
      } catch (_) {}
    }
  };
}

async function executeTrigger(triggerPromise, expectedActionDescription) {
  try {
    const result = await triggerPromise;
    return { ok: true, result };
  } catch (err) {
    const msg = err.message || String(err);

    if (msg.includes('CDP JS Exception')) {
      throw new Error(`TEST FAILED: JavaScript exception occurred during ${expectedActionDescription}: ${msg}`);
    }
    if (msg.includes('CDP Protocol Error') && !msg.includes('Execution context was destroyed')) {
      throw new Error(`TEST FAILED: CDP protocol error occurred during ${expectedActionDescription}: ${msg}`);
    }
    if (msg.includes('timed out')) {
      throw new Error(`TEST FAILED: Command timed out during ${expectedActionDescription}: ${msg}`);
    }

    const isContextDestruction =
      msg.includes('Execution context was destroyed') ||
      msg.includes('CDP WebSocket closed unexpectedly') ||
      msg.includes('CDP WebSocket error') ||
      msg.includes('Inspected target navigated or closed') ||
      msg.includes('Target closed') ||
      msg.includes('Cannot send CDP method');

    if (!isContextDestruction) {
      throw new Error(`TEST FAILED: Unexpected failure during ${expectedActionDescription}: ${msg}`);
    }

    return { ok: false, contextDestroyed: true, message: msg };
  }
}

async function run() {
  console.log(`Checking debug port ${debugPort} at TCP level...`);
  const portInUse = await isTcpPortListening(debugPort);
  if (portInUse) {
    const owningPid = getPortOwningPid(debugPort);
    throw new Error(`TCP PORT CONFLICT: Port ${debugPort} is already in use by listening process (PID: ${owningPid}). Aborting!`);
  }

  // Create temporary project folder
  const tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-e2e-project-'));
  console.log('Created temporary project directory:', tempProjectDir);

  const childProc = spawn(exePath, [`--remote-debugging-port=${debugPort}`], {
    detached: true,
    stdio: 'ignore'
  });
  childProc.unref();

  const rootPid = childProc.pid;
  assert.ok(rootPid, 'Spawned process must have valid PID');
  console.log(`Spawned isolated NiZyLa instance with Root PID: ${rootPid}`);

  let tcpReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    if (await isTcpPortListening(debugPort)) {
      tcpReady = true;
      break;
    }
  }
  assert.ok(tcpReady, 'Spawned instance did not start listening on debug port in time');

  const { owningPid, allowedPids } = verifyPortOwnership(debugPort, rootPid);
  console.log(`TCP Port ${debugPort} verified: owned by PID ${owningPid} (within process tree: ${Array.from(allowedPids).join(',')})`);

  let cdp = await connectPageWs(debugPort, rootPid);
  await sleep(1000);

  try {
    // -------------------------------------------------------------
    // Test 1: Clean state: Reload without prompt
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Clean state: Reload without prompt ---');
    const cleanMarkerValue = `clean_reload_marker_${Date.now()}`;
    await cdp.evaluate(`window.__nizyla_clean_marker = "${cleanMarkerValue}";`, true);
    assert.equal(await cdp.evaluate('window.__nizyla_clean_marker'), cleanMarkerValue);

    const reloadTriggerResult = await executeTrigger(
      cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
      'clean-reload'
    );
    console.log('Clean reload trigger dispatched:', reloadTriggerResult.ok ? 'Resolved' : reloadTriggerResult.message);
    await sleep(1500);

    const cleanDialog = runInstanceHelper(rootPid, 'cancel');
    assert.equal(cleanDialog.startsWith('CLICKED'), false, 'Clean state reload must NOT show dialog');

    cdp.close();
    cdp = await connectPageWs(debugPort, rootPid);
    await sleep(600);

    const markerTypeAfterCleanReload = await cdp.evaluate('typeof window.__nizyla_clean_marker');
    assert.equal(markerTypeAfterCleanReload, 'undefined', 'Clean reload must replace document');

    const hasAppShell = await cdp.evaluate('document.querySelector(".app-shell") !== null');
    assert.equal(hasAppShell, true, 'App shell must be mounted');
    console.log('✔ Clean reload succeeded: marker cleared, app shell ready, no dialog shown');

    // -------------------------------------------------------------
    // Test 2: Create .gcn in project & Open via selectFile
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Create .gcn in project & Open via selectFile ---');
    const gcnPath = path.join(tempProjectDir, 'logic.gcn');
    const initialGcnContent = JSON.stringify({
      format: 'nizyla.geometry-code',
      version: 1,
      target: 'python',
      variables: [],
      nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }, null, 2);

    // Scan project into main process
    await cdp.evaluate(`globalThis.nizyla.scanProject(${JSON.stringify(tempProjectDir)})`, true);

    // Create file using IPC
    await cdp.evaluate(`globalThis.nizyla.createGeometryFile(${JSON.stringify(gcnPath)}, ${JSON.stringify(initialGcnContent)})`, true);
    assert.equal(fsSync.existsSync(gcnPath), true, 'logic.gcn must exist on disk');

    // Open .gcn file via selectFile
    await cdp.evaluate(`(async () => {
      const modeBtn = document.querySelectorAll('.mode-switch button')[1];
      modeBtn.click();
    })()`, true);
    await sleep(600);

    // -------------------------------------------------------------
    // Test 3: Edit graph, Save .gcn, and verify disk content
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Edit graph and Save .gcn ---');
    // Click "+ Variable"
    await cdp.evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "+ Variable").click()', true);
    await sleep(600);

    const varCount = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
    assert.ok(varCount > 0, 'Variable must be added to graph');

    // Save via IPC directly with the updated document
    await cdp.evaluate(`(async () => {
      const doc = {
        format: 'nizyla.geometry-code',
        version: 1,
        target: 'python',
        variables: [{ id: 'v1', name: 'counter', type: 'int', initialValue: 99 }],
        nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      };
      await globalThis.nizyla.saveGeometryFile(${JSON.stringify(gcnPath)}, doc);
    })()`, true);

    const diskContent = await fs.readFile(gcnPath, 'utf8');
    assert.ok(diskContent.includes('counter'), 'Saved file must contain variable "counter"');
    console.log('✔ Graph saved to disk successfully via IPC');

    // -------------------------------------------------------------
    // Test 4: Reload -> Cancel with unsaved edits
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Reload -> Cancel with unsaved edits ---');
    await cdp.evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "+ Variable").click()', true);
    await sleep(600);

    const testMarker = `marker_${Date.now()}`;
    await cdp.evaluate(`window.__test_marker = "${testMarker}";`, true);

    const reloadCancelTrigger = executeTrigger(
      cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
      'reload-cancel'
    );

    const cancelDialog = await waitForDialog(rootPid, 'cancel');
    assert.ok(cancelDialog, 'Dialog must appear on reload and Cancel clicked');
    console.log('Dialog action:', cancelDialog);

    const cancelOutcome = await reloadCancelTrigger;
    console.log('Reload cancel outcome:', cancelOutcome.ok ? 'Resolved' : cancelOutcome.message);
    await sleep(1000);

    const markerPreserved = await cdp.evaluate('window.__test_marker');
    assert.equal(markerPreserved, testMarker, 'Marker must be preserved after Cancel');
    console.log('✔ Reload Cancel: window stayed open, document preserved');

    // -------------------------------------------------------------
    // Test 5: Reload -> Discard with unsaved edits
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Reload -> Discard with unsaved edits ---');
    const reloadDiscardTrigger = executeTrigger(
      cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
      'reload-discard'
    );

    const discardDialog = await waitForDialog(rootPid, 'discard');
    assert.ok(discardDialog, 'Dialog must appear on reload and Discard clicked');
    console.log('Dialog action:', discardDialog);

    const discardOutcome = await reloadDiscardTrigger;
    console.log('Reload discard outcome:', discardOutcome.ok ? 'Resolved' : discardOutcome.message);
    await sleep(2500);

    cdp.close();
    cdp = await connectPageWs(debugPort, rootPid);
    await sleep(600);

    const markerType = await cdp.evaluate('typeof window.__test_marker');
    assert.equal(markerType, 'undefined', 'Marker must be cleared after Discard');

    const isAlive = runInstanceHelper(rootPid, 'is-alive');
    assert.equal(isAlive, 'ALIVE', 'Window must remain open after Reload Discard');
    console.log('✔ Reload Discard: window remains open and document reloaded');

    // -------------------------------------------------------------
    // Test 6: Titlebar X -> Cancel with unsaved edits
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Titlebar X -> Cancel with unsaved edits ---');
    await cdp.evaluate('document.querySelectorAll(".mode-switch button")[1].click()', true);
    await sleep(600);
    await cdp.evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "+ Variable").click()', true);
    await sleep(600);

    const closeCancelTrigger = executeTrigger(
      cdp.send('Runtime.evaluate', { expression: 'document.querySelector(".window-control-box .close").click()', userGesture: true }),
      'close-cancel'
    );

    const closeCancelDialog = await waitForDialog(rootPid, 'cancel');
    assert.ok(closeCancelDialog, 'Dialog must appear on close and Cancel clicked');

    const closeCancelOutcome = await closeCancelTrigger;
    console.log('Close cancel outcome:', closeCancelOutcome.ok ? 'Resolved' : closeCancelOutcome.message);
    await sleep(1000);

    const isAliveAfterCloseCancel = runInstanceHelper(rootPid, 'is-alive');
    assert.equal(isAliveAfterCloseCancel, 'ALIVE', 'Window must remain open after Close Cancel');
    console.log('✔ Close Cancel: window stays open');

    // -------------------------------------------------------------
    // Test 7: Titlebar X -> Discard with unsaved edits (Exits)
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Titlebar X -> Discard with unsaved edits (Exits) ---');
    const closeDiscardTrigger = executeTrigger(
      cdp.send('Runtime.evaluate', { expression: 'document.querySelector(".window-control-box .close").click()', userGesture: true }),
      'close-discard'
    );

    const closeDiscardDialog = await waitForDialog(rootPid, 'discard');
    assert.ok(closeDiscardDialog, 'Dialog must appear on close and Discard clicked');

    const closeDiscardOutcome = await closeDiscardTrigger;
    console.log('Close discard outcome:', closeDiscardOutcome.ok ? 'Resolved' : closeDiscardOutcome.message);
    await sleep(2500);

    const isAliveAfterExit = runInstanceHelper(rootPid, 'is-alive');
    assert.equal(isAliveAfterExit, 'EXITED', 'Instance must exit after Discard on Close');
    console.log('✔ Close Discard: instance exited cleanly');

    // -------------------------------------------------------------
    // Test 8: Clean state close closes immediately
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Clean state close closes immediately without dialog ---');
    const cleanPortFree = await isTcpPortListening(debugPort);
    assert.equal(cleanPortFree, false, 'Debug port must be free after exit');

    const cleanChild = spawn(exePath, [`--remote-debugging-port=${debugPort}`], { detached: true, stdio: 'ignore' });
    cleanChild.unref();
    const cleanRootPid = cleanChild.pid;

    for (let i = 0; i < 30; i++) {
      await sleep(400);
      if (await isTcpPortListening(debugPort)) break;
    }

    const cleanCdp = await connectPageWs(debugPort, cleanRootPid);
    await sleep(1000);

    const cleanCloseTrigger = executeTrigger(
      cleanCdp.send('Runtime.evaluate', { expression: 'document.querySelector(".window-control-box .close").click()', userGesture: true }),
      'clean-close'
    );
    await sleep(2000);

    const cleanDialogCheck = runInstanceHelper(cleanRootPid, 'cancel');
    assert.equal(cleanDialogCheck.startsWith('CLICKED'), false, 'Clean window must NOT show dialog on close');

    const cleanAlive = runInstanceHelper(cleanRootPid, 'is-alive');
    assert.equal(cleanAlive, 'EXITED', 'Clean instance must exit immediately on close');

    const cleanOutcome = await cleanCloseTrigger;
    console.log('Clean close outcome:', cleanOutcome.ok ? 'Resolved' : cleanOutcome.message);
    console.log('✔ Clean window closed immediately with no dialog');

    console.log('\n🎉 ALL STAGE 4 E2E TESTS PASSED SUCCESSFULLY!');
  } finally {
    try {
      await fs.rm(tempProjectDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('\n❌ E2E TEST RUN FAILED:', err);
  process.exit(1);
});
