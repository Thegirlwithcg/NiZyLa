import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
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

// Strictly verify that listening port is owned by a process in rootPid's process tree
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

async function waitForDialog(rootPid, action, timeoutMs = 6000) {
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
  // Guard: check port ownership at TCP level before making any HTTP/CDP connection
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
      returnByValue: true
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

// Explicit trigger handler: allows ONLY expected context destruction during navigation/close,
// while ensuring Protocol errors, JS exceptions, timeouts, and unexpected errors FAIL the test.
async function executeTrigger(triggerPromise, expectedActionDescription) {
  try {
    const result = await triggerPromise;
    return { ok: true, result };
  } catch (err) {
    const msg = err.message || String(err);

    // Protocol error, JS exception, or timeout MUST fail the test
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
  // 1. TCP Port conflict guard: verify port is completely free at TCP level before starting
  console.log(`Checking debug port ${debugPort} at TCP level...`);
  const portInUse = await isTcpPortListening(debugPort);
  if (portInUse) {
    const owningPid = getPortOwningPid(debugPort);
    throw new Error(`TCP PORT CONFLICT: Port ${debugPort} is already in use by listening process (PID: ${owningPid}). Aborting to avoid controlling an unintended instance.`);
  }

  // 2. Spawn isolated instance and record rootPid
  const childProc = spawn(exePath, [`--remote-debugging-port=${debugPort}`], {
    detached: true,
    stdio: 'ignore'
  });
  childProc.unref();

  const rootPid = childProc.pid;
  assert.ok(rootPid, 'Spawned process must have valid PID');
  console.log(`Spawned isolated NiZyLa instance with Root PID: ${rootPid}`);

  // Wait for debug port to be open at TCP level
  let tcpReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    if (await isTcpPortListening(debugPort)) {
      tcpReady = true;
      break;
    }
  }
  assert.ok(tcpReady, 'Spawned instance did not start listening on debug port in time');

  // Verify listening port ownership strictly belongs to rootPid's process tree
  const { owningPid, allowedPids } = verifyPortOwnership(debugPort, rootPid);
  console.log(`TCP Port ${debugPort} verified: owned by PID ${owningPid} (within process tree: ${Array.from(allowedPids).join(',')})`);

  let cdp = await connectPageWs(debugPort, rootPid);
  await sleep(1000);

  // -------------------------------------------------------------
  // Test 1: Clean state: Reload without prompt
  // Requirement 3: Must set marker, verify marker is gone, verify app ready after reload
  // -------------------------------------------------------------
  console.log('\n--- Test 1: Clean state: Reload without prompt ---');
  const cleanMarkerValue = `clean_reload_marker_${Date.now()}`;
  await cdp.evaluate(`window.__nizyla_clean_marker = "${cleanMarkerValue}";`, true);
  const verifyCleanMarker = await cdp.evaluate('window.__nizyla_clean_marker');
  assert.equal(verifyCleanMarker, cleanMarkerValue, 'Clean marker must be set in window before reload');

  // Trigger reload and handle trigger promise explicitly
  const reloadTriggerResult = await executeTrigger(
    cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
    'clean-reload'
  );
  console.log('Clean reload trigger dispatched:', reloadTriggerResult.ok ? 'Resolved' : reloadTriggerResult.message);
  await sleep(1500);

  // 1) Verify no dialog appeared
  const cleanDialog = runInstanceHelper(rootPid, 'cancel');
  assert.equal(cleanDialog.startsWith('CLICKED'), false, 'Clean state reload must NOT show dialog');

  // 2) Reconnect to the reloaded page (verifies TCP port & OwningProcess again!)
  cdp.close();
  cdp = await connectPageWs(debugPort, rootPid);
  await sleep(600);

  // 3) Verify the marker is gone (document was replaced)
  const markerTypeAfterCleanReload = await cdp.evaluate('typeof window.__nizyla_clean_marker');
  assert.equal(markerTypeAfterCleanReload, 'undefined', 'Clean reload must replace document: window.__nizyla_clean_marker is undefined');

  // 4) Verify app shell is ready and fully functional
  const hasAppShell = await cdp.evaluate('document.querySelector(".app-shell") !== null');
  assert.equal(hasAppShell, true, 'App shell must be mounted after clean reload');

  const modeButtonsCount = await cdp.evaluate('document.querySelectorAll(".mode-switch button").length');
  assert.equal(modeButtonsCount, 2, 'Mode switch buttons must be present after clean reload');

  const activeMode = await cdp.evaluate('document.querySelector(".mode-switch button.active")?.textContent?.trim()');
  assert.equal(activeMode, 'Code', 'Default active mode must be Code after clean reload');
  console.log('✔ Clean reload succeeded: marker cleared, app shell ready, no dialog shown');

  // Helper to open Geometry Code, set a window marker, and add an unsaved variable
  async function setupDirtyGraph(markerValue) {
    // Set window marker
    await cdp.evaluate(`window.__nizyla_test_marker = "${markerValue}";`, true);

    // Switch to Geometry Code
    await cdp.evaluate('document.querySelectorAll(".mode-switch button")[1].click()', true);
    await sleep(600);

    // Click "+ Variable"
    await cdp.evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "+ Variable").click()', true);
    await sleep(600);

    // Verify marker and dirty variable exist
    const marker = await cdp.evaluate('window.__nizyla_test_marker');
    assert.equal(marker, markerValue, 'Window marker must be set');

    const varCount = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
    assert.ok(varCount > 0, 'Scratch graph must have at least 1 variable (dirty)');

    return { marker, varCount };
  }

  // -------------------------------------------------------------
  // Test 2: Dirty state -> Reload (CDP / location.reload()) -> Cancel
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Dirty: Reload (CDP / location.reload()) -> Cancel ---');
  const testMarker1 = `test_marker_1_${Date.now()}`;
  const dirty1 = await setupDirtyGraph(testMarker1);

  // Trigger reload and handle trigger promise explicitly
  const dirtyReloadCancelTrigger = executeTrigger(
    cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
    'dirty-reload-cancel'
  );

  // Dialog appears for this instance -> Click "ยกเลิก" (Cancel)
  const cancelResult = await waitForDialog(rootPid, 'cancel');
  assert.ok(cancelResult, 'Dialog must appear on reload and Cancel clicked');
  console.log('Dialog action:', cancelResult);

  const cancelOutcome = await dirtyReloadCancelTrigger;
  console.log('Reload cancel trigger outcome:', cancelOutcome.ok ? 'Resolved' : cancelOutcome.message);
  await sleep(1000);

  // Check marker is preserved and data is intact
  const markerAfterCancel = await cdp.evaluate('window.__nizyla_test_marker');
  assert.equal(markerAfterCancel, testMarker1, 'Window marker must be preserved after Cancel (page did not reload)');

  const varCountAfterCancel = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
  assert.equal(varCountAfterCancel, dirty1.varCount, 'Unsaved variables must remain intact after Cancel');

  const isAliveAfterCancel = runInstanceHelper(rootPid, 'is-alive');
  assert.equal(isAliveAfterCancel, 'ALIVE', 'Window/instance must still be alive after Cancel');
  console.log('✔ Reload Cancelled: window marker preserved, scratch graph intact, window open');

  // -------------------------------------------------------------
  // Test 3: Continue editing after Cancel
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Continue editing after Cancel ---');
  await cdp.evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "+ Variable").click()', true);
  await sleep(600);

  const varCountContinued = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
  assert.ok(varCountContinued > dirty1.varCount, 'Adding another variable after Cancel must work');

  const markerContinued = await cdp.evaluate('window.__nizyla_test_marker');
  assert.equal(markerContinued, testMarker1, 'Marker still preserved while continuing edits');
  console.log('✔ Successfully added additional variable after Cancel');

  // -------------------------------------------------------------
  // Test 4: Dirty state -> Reload (CDP / location.reload()) -> Discard
  // Requirement 2: Confirm old document replaced (marker gone), 1 Start, 0 vars, 0 edges, window open
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Dirty: Reload (CDP / location.reload()) -> Discard ---');
  const dirtyReloadDiscardTrigger = executeTrigger(
    cdp.send('Runtime.evaluate', { expression: 'location.reload()', userGesture: true }),
    'dirty-reload-discard'
  );

  const discardResult = await waitForDialog(rootPid, 'discard');
  assert.ok(discardResult, 'Dialog must appear on reload and Discard clicked');
  console.log('Dialog action:', discardResult);

  const discardOutcome = await dirtyReloadDiscardTrigger;
  console.log('Reload discard trigger outcome:', discardOutcome.ok ? 'Resolved' : discardOutcome.message);
  await sleep(2000);

  // Reconnect to reloaded page (verifies TCP port & OwningProcess again!)
  cdp.close();
  cdp = await connectPageWs(debugPort, rootPid);
  await sleep(600);

  // Verify old document was replaced: marker is gone!
  const markerAfterDiscard = await cdp.evaluate('typeof window.__nizyla_test_marker');
  assert.equal(markerAfterDiscard, 'undefined', 'Old document was replaced: window.__nizyla_test_marker is undefined');

  // Wait for app shell to be ready and switch to Geometry Code
  await cdp.evaluate('document.querySelectorAll(".mode-switch button")[1].click()', true);
  await sleep(600);

  // Verify Geometry Editor state:
  // - Exactly one Start node
  const startNodeCount = await cdp.evaluate('document.querySelectorAll(".gcn-node[data-node-type=\\"start\\"]").length');
  assert.equal(startNodeCount, 1, 'Scratch graph must have exactly 1 Start node');

  const totalNodeCount = await cdp.evaluate('document.querySelectorAll(".gcn-node").length');
  assert.equal(totalNodeCount, 1, 'Scratch graph must have only the Start node');

  // - No variables
  const varCountAfterDiscard = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
  assert.equal(varCountAfterDiscard, 0, 'Scratch graph must have 0 variables after Discard');

  // - No wires / edges
  const edgeCountAfterDiscard = await cdp.evaluate('document.querySelectorAll(".svelte-flow__edge").length');
  assert.equal(edgeCountAfterDiscard, 0, 'Scratch graph must have 0 wires/edges after Discard');

  // - Window still alive
  const isAliveAfterDiscard = runInstanceHelper(rootPid, 'is-alive');
  assert.equal(isAliveAfterDiscard, 'ALIVE', 'Window must remain open after Reload Discard');
  console.log('✔ Reload Discard: old document replaced, scratch graph reset (1 Start, 0 vars, 0 edges), window open');

  // -------------------------------------------------------------
  // Test 5: Dirty state -> Win32 WM_CLOSE (system close message) -> Cancel
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Dirty: Win32 WM_CLOSE (system close message) -> Cancel ---');
  const testMarker2 = `test_marker_2_${Date.now()}`;
  const dirty2 = await setupDirtyGraph(testMarker2);

  // Post WM_CLOSE directly to this instance's main window HWND
  const postResult = runInstanceHelper(rootPid, 'wm-close');
  assert.equal(postResult, 'POSTED_WM_CLOSE', 'Must post WM_CLOSE to spawned window');

  const cancelWmClose = await waitForDialog(rootPid, 'cancel');
  assert.ok(cancelWmClose, 'Dialog must appear on WM_CLOSE and Cancel clicked');
  await sleep(1000);

  const markerAfterWmCancel = await cdp.evaluate('window.__nizyla_test_marker');
  assert.equal(markerAfterWmCancel, testMarker2, 'Marker preserved after WM_CLOSE Cancel');

  const varCountAfterWmCancel = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
  assert.equal(varCountAfterWmCancel, dirty2.varCount, 'Data preserved after WM_CLOSE Cancel');
  console.log('✔ WM_CLOSE Cancel: window stays open, data intact');

  // -------------------------------------------------------------
  // Test 6: Dirty state -> Titlebar "×" button (requestClose) -> Cancel
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Dirty: Titlebar "×" button (requestClose) -> Cancel ---');
  const closeCancelTrigger = executeTrigger(
    cdp.send('Runtime.evaluate', { expression: 'document.querySelector(".window-control-box .close").click()', userGesture: true }),
    'dirty-close-cancel'
  );

  const cancelCloseBtn = await waitForDialog(rootPid, 'cancel');
  assert.ok(cancelCloseBtn, 'Dialog must appear on Titlebar close and Cancel clicked');
  await sleep(1000);

  const closeCancelOutcome = await closeCancelTrigger;
  console.log('Close cancel trigger outcome:', closeCancelOutcome.ok ? 'Resolved' : closeCancelOutcome.message);

  const varCountAfterCloseCancel = await cdp.evaluate('document.querySelectorAll(".gcn-var-row").length');
  assert.equal(varCountAfterCloseCancel, dirty2.varCount, 'Data preserved after Titlebar close Cancel');
  console.log('✔ Titlebar "×" Cancel: window stays open, data intact');

  // -------------------------------------------------------------
  // Test 7: Dirty state -> Titlebar "×" button (requestClose) -> Discard
  // Requirement 2: Explicitly handle trigger promise, verify process exit
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Dirty: Titlebar "×" button (requestClose) -> Discard ---');
  const closeDiscardTrigger = executeTrigger(
    cdp.send('Runtime.evaluate', { expression: 'document.querySelector(".window-control-box .close").click()', userGesture: true }),
    'dirty-close-discard'
  );

  const discardCloseBtn = await waitForDialog(rootPid, 'discard');
  assert.ok(discardCloseBtn, 'Dialog must appear on Titlebar close and Discard clicked');
  console.log('Dialog action:', discardCloseBtn);

  const closeDiscardOutcome = await closeDiscardTrigger;
  console.log('Close discard trigger outcome:', closeDiscardOutcome.ok ? 'Resolved' : closeDiscardOutcome.message);
  await sleep(2500);

  const isAliveAfterClose = runInstanceHelper(rootPid, 'is-alive');
  assert.equal(isAliveAfterClose, 'EXITED', 'Spawned instance Root PID must have exited after Discard on Close');
  console.log('✔ Titlebar "×" Discard: spawned instance exited cleanly');

  // -------------------------------------------------------------
  // Test 8: Clean state -> Titlebar "×" button closes immediately without dialog
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Clean state: Titlebar "×" button closes immediately without dialog ---');
  // Check port at TCP level
  const cleanPortOccupied = await isTcpPortListening(debugPort);
  assert.equal(cleanPortOccupied, false, 'Debug port must be free at TCP level after previous instance exit');

  const cleanChild = spawn(exePath, [`--remote-debugging-port=${debugPort}`], { detached: true, stdio: 'ignore' });
  cleanChild.unref();
  const cleanRootPid = cleanChild.pid;

  let cleanReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    if (await isTcpPortListening(debugPort)) {
      cleanReady = true;
      break;
    }
  }
  assert.ok(cleanReady, 'Clean instance did not open debug port in time');

  // Verify ownership before connecting
  const cleanCdp = await connectPageWs(debugPort, cleanRootPid);
  await sleep(1000);

  // Click close on clean window and handle promise explicitly
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

  console.log('\n🎉 ALL REAL ELECTRON ISOLATED TESTS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('\n❌ E2E TEST RUN FAILED:', err);
  process.exit(1);
});
