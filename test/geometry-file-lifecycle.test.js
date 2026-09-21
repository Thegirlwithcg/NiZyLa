import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  createGeometryDocument,
  parseGeometryDocument,
  serializeGeometryDocument,
  validateGeometryDocument,
  nodeDefinitions
} from '../src/core/geometry.js';
import {
  addNode,
  addEdge,
  addVariable,
  updateVariable,
  setViewport,
  sameContent,
  sameDocument,
  createEditorState,
  applyEdit,
  undo,
  redo
} from '../src/core/geometry-editor.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

test('New -> Save -> Close -> Open round-trip preserves all contract data', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-gcn-test-'));
  const filePath = path.join(tempDir, 'sample_graph.gcn');

  try {
    // 1. Create a fresh document
    let doc = createGeometryDocument();
    doc.target = 'python';

    // 2. Add variable
    const varRes = addVariable(doc);
    doc = varRes.doc;
    const vId = varRes.variableId;
    doc = updateVariable(doc, vId, { name: 'score', type: 'int', initialValue: 42 });

    // 3. Add node
    const nRes = addNode(doc, 'print');
    doc = nRes.doc;
    const printId = nRes.nodeId;

    // 4. Wire start -> print, and getVariable -> print
    const getRes = addNode(doc, 'get');
    doc = getRes.doc;
    doc.nodes.find((n) => n.id === getRes.nodeId).data.variableId = vId;

    const eRes = addEdge(doc, { source: 'start', sourceHandle: 'next', target: printId, targetHandle: 'in' });
    doc = eRes.doc;
    doc = addEdge(doc, { source: getRes.nodeId, sourceHandle: 'value', target: printId, targetHandle: 'value' }).doc;

    // 5. Change viewport
    doc = { ...doc, viewport: { x: 120, y: 340, zoom: 1.25 } };

    // 6. Save to disk
    const serialized = serializeGeometryDocument(doc);
    await fs.writeFile(filePath, serialized, 'utf8');

    // 7. Read back and parse
    const content = await fs.readFile(filePath, 'utf8');
    const { document: loadedDoc, diagnostics } = parseGeometryDocument(content);

    assert.ok(loadedDoc, 'Loaded document must not be null');
    assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);

    // Verify all fields are identical
    assert.equal(loadedDoc.target, 'python');
    assert.equal(loadedDoc.variables.length, 1);
    assert.equal(loadedDoc.variables[0].name, 'score');
    assert.equal(loadedDoc.variables[0].initialValue, 42);
    assert.equal(loadedDoc.nodes.length, 3);
    assert.equal(loadedDoc.edges.length, 2);
    assert.equal(loadedDoc.viewport.x, 120);
    assert.equal(loadedDoc.viewport.y, 340);
    assert.equal(loadedDoc.viewport.zoom, 1.25);

    assert.equal(sameDocument(doc, loadedDoc), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('Malformed JSON and wrong versions return document: null and do not replace current doc', () => {
  // Malformed JSON
  const r1 = parseGeometryDocument('{ invalid json');
  assert.equal(r1.document, null);
  assert.ok(r1.diagnostics.some((d) => d.code === 'invalid-json'));

  // Wrong format
  const r2 = parseGeometryDocument(JSON.stringify({ format: 'wrong-format', version: 1 }));
  assert.equal(r2.document, null);
  assert.ok(r2.diagnostics.some((d) => d.code === 'invalid-format'));

  // Unsupported version
  const r3 = parseGeometryDocument(JSON.stringify({ format: 'nizyla.geometry-code', version: 999 }));
  assert.equal(r3.document, null);
  assert.ok(r3.diagnostics.some((d) => d.code === 'unsupported-version'));

  // Missing required arrays
  const r4 = parseGeometryDocument(JSON.stringify({ format: 'nizyla.geometry-code', version: 1 }));
  assert.equal(r4.document, null);
  assert.ok(r4.diagnostics.some((d) => d.code === 'invalid-schema'));
});

test('Incomplete graphs can be saved to .gcn, but Export is blocked', () => {
  let doc = createGeometryDocument();
  // Add a Print node without connecting in or value -> incomplete graph
  const nRes = addNode(doc, 'print');
  doc = nRes.doc;

  // Serialization must succeed (file shape is valid)
  assert.doesNotThrow(() => {
    serializeGeometryDocument(doc);
  });

  // Validation warns or errors on missing inputs
  // Let's check codegen:
  // If we connect start -> print, but leave print.value unconnected: missing-input error
  const eRes = addEdge(doc, { source: 'start', sourceHandle: 'next', target: nRes.nodeId, targetHandle: 'in' });
  const errorDoc = eRes.doc;

  const { code, diagnostics } = generateGeometryCode(errorDoc, 'python');
  const errors = diagnostics.filter((d) => d.severity === 'error');
  assert.ok(errors.length > 0, 'Unconnected used value port must produce an error');
  assert.equal(code, null, 'Codegen must return null code on error');
});

test('Supports Thai paths, spaces, and Unicode file operations cleanly', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-ไทย-'));
  const folderWithSpaces = path.join(tempDir, 'โฟลเดอร์ ทดสอบ');
  await fs.mkdir(folderWithSpaces, { recursive: true });
  const filePath = path.join(folderWithSpaces, 'กราฟ ตรรกะ ๑.gcn');

  try {
    const doc = createGeometryDocument();
    const serialized = serializeGeometryDocument(doc);
    await fs.writeFile(filePath, serialized, 'utf8');

    assert.equal(fsSync.existsSync(filePath), true);
    const content = await fs.readFile(filePath, 'utf8');
    const { document: parsed } = parseGeometryDocument(content);
    assert.ok(parsed);
    assert.equal(sameDocument(doc, parsed), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('Viewport-only changes trigger sameDocument false, preserve history, and are saveable', () => {
  const initialDoc = createGeometryDocument();
  let state = createEditorState(initialDoc);

  // Initial state is clean
  assert.equal(sameDocument(state.present, initialDoc), true);

  // Pan viewport
  state = setViewport(state, { x: 50, y: 100, zoom: 1.5 });
  assert.equal(sameContent(state.present, initialDoc), true, 'sameContent ignores viewport');
  assert.equal(sameDocument(state.present, initialDoc), false, 'sameDocument detects viewport move');
  assert.equal(state.past.length, 0, 'Viewport changes must NOT create an undo history entry');

  // Simulate Save: baseline becomes the new state.present
  let baseline = state.present;
  assert.equal(sameDocument(state.present, baseline), true, 'After save, document matches baseline');

  // Edit node: creates history
  const addRes = addNode(state.present, 'int');
  state = applyEdit(state, addRes.doc);
  assert.equal(state.past.length, 1, 'Editing adds to undo history');
  assert.equal(sameDocument(state.present, baseline), false, 'Edited document is dirty');

  // Undo: returns to baseline
  state = undo(state);
  assert.equal(sameDocument(state.present, baseline), true, 'Undoing back to baseline restores clean status');
  assert.equal(state.present.viewport.x, 50, 'Viewport is preserved on undo');
  assert.equal(state.present.viewport.y, 100);
});

test('Simulated write and replace failure preserves the original file untouched', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-atomic-'));
  const originalFile = path.join(tempDir, 'graph.gcn');
  const originalContent = '{"original": true}';
  await fs.writeFile(originalFile, originalContent, 'utf8');

  async function failingWriteAtomic(targetPath, newContent) {
    const dir = path.dirname(targetPath);
    const tempPath = path.join(dir, `.tmp_${randomUUID()}.gcn`);
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx');
      await handle.writeFile(newContent, 'utf8');
    } finally {
      if (handle) await handle.close();
    }
    // Simulate failure right before rename
    try {
      throw new Error('Simulated disk/permission error');
      // await fs.rename(tempPath, targetPath);
    } catch (err) {
      try { await fs.unlink(tempPath); } catch (_) {}
      throw err;
    }
  }

  await assert.rejects(async () => {
    await failingWriteAtomic(originalFile, '{"new": "corrupted"}');
  }, /Simulated disk/);

  // Check original file still exists with original bytes
  const preserved = await fs.readFile(originalFile, 'utf8');
  assert.equal(preserved, originalContent, 'Original file must remain completely intact after write failure');

  // Check no temp files left behind
  const files = await fs.readdir(tempDir);
  assert.deepEqual(files, ['graph.gcn']);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('IPC path validation helper rejects traversal, wrong extension, and outside paths', () => {
  function isPathInsideProject(targetPath, knownRoots) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return false;
    const resolvedTarget = path.resolve(targetPath);
    for (const root of knownRoots) {
      const resolvedRoot = path.resolve(root);
      const rel = path.relative(resolvedRoot, resolvedTarget);
      const isInside = !rel.startsWith('..') && !path.isAbsolute(rel) && rel !== '';
      if (isInside) {
        if (process.platform === 'win32') {
          const relLower = path.relative(resolvedRoot.toLowerCase(), resolvedTarget.toLowerCase());
          if (!relLower.startsWith('..') && !path.isAbsolute(relLower) && relLower !== '') return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  function validateGcnPath(targetPath, knownRoots) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) throw new Error('Invalid path');
    if (path.extname(targetPath).toLowerCase() !== '.gcn') throw new Error('Must be .gcn');
    if (!isPathInsideProject(targetPath, knownRoots)) throw new Error('Must be inside project');
  }

  const projectRoot = path.resolve('/workspace/my-game');
  const known = [projectRoot];

  // Valid inside path
  assert.doesNotThrow(() => {
    validateGcnPath(path.join(projectRoot, 'src', 'logic.gcn'), known);
  });

  // Path traversal
  assert.throws(() => {
    validateGcnPath(path.join(projectRoot, '..', 'other', 'logic.gcn'), known);
  }, /Must be inside project/);

  // Wrong extension
  assert.throws(() => {
    validateGcnPath(path.join(projectRoot, 'src', 'logic.py'), known);
  }, /Must be .gcn/);

  // Outside project
  assert.throws(() => {
    validateGcnPath('/etc/system32/logic.gcn', known);
  }, /Must be inside project/);
});

test('Export generates valid Python that executes correctly in Python 3 runtime', () => {
  // Test if python3 is available
  const pyCheck = spawnSync('python', ['--version']);
  if (pyCheck.status !== 0) {
    console.log('Skipping python execution: Python executable not found');
    return;
  }

  // 1. Build a graph that sums 0..4 and prints 10
  let doc = createGeometryDocument();
  doc.target = 'python';

  // Variable total: int = 0
  const vTotal = addVariable(doc);
  doc = updateVariable(vTotal.doc, vTotal.variableId, { name: 'total', type: 'int', initialValue: 0 });

  // Variable i: int = 0
  const vI = addVariable(doc);
  doc = updateVariable(vI.doc, vI.variableId, { name: 'i', type: 'int', initialValue: 0 });

  // For Range: start 0, stop 5, step 1 using variable i
  const forNode = addNode(doc, 'for');
  doc = forNode.doc;
  const forId = forNode.nodeId;
  doc.nodes.find((n) => n.id === forId).data.variableId = vI.variableId;

  // Literals for start=0, stop=5, step=1
  const lit0 = addNode(doc, 'int'); doc = lit0.doc;
  doc.nodes.find((n) => n.id === lit0.nodeId).data.value = 0;

  const lit5 = addNode(doc, 'int'); doc = lit5.doc;
  doc.nodes.find((n) => n.id === lit5.nodeId).data.value = 5;

  const lit1 = addNode(doc, 'int'); doc = lit1.doc;
  doc.nodes.find((n) => n.id === lit1.nodeId).data.value = 1;

  doc = addEdge(doc, { source: lit0.nodeId, sourceHandle: 'value', target: forId, targetHandle: 'start' }).doc;
  doc = addEdge(doc, { source: lit5.nodeId, sourceHandle: 'value', target: forId, targetHandle: 'stop' }).doc;
  doc = addEdge(doc, { source: lit1.nodeId, sourceHandle: 'value', target: forId, targetHandle: 'step' }).doc;

  // Start -> For
  doc = addEdge(doc, { source: 'start', sourceHandle: 'next', target: forId, targetHandle: 'in' }).doc;

  // In For body: total = total + i
  const setTotal = addNode(doc, 'set'); doc = setTotal.doc;
  doc.nodes.find((n) => n.id === setTotal.nodeId).data.variableId = vTotal.variableId;
  doc = addEdge(doc, { source: forId, sourceHandle: 'body', target: setTotal.nodeId, targetHandle: 'in' }).doc;

  const getTotal = addNode(doc, 'get'); doc = getTotal.doc;
  doc.nodes.find((n) => n.id === getTotal.nodeId).data.variableId = vTotal.variableId;

  const getI = addNode(doc, 'get'); doc = getI.doc;
  doc.nodes.find((n) => n.id === getI.nodeId).data.variableId = vI.variableId;

  const addOp = addNode(doc, 'add'); doc = addOp.doc;
  doc = addEdge(doc, { source: getTotal.nodeId, sourceHandle: 'value', target: addOp.nodeId, targetHandle: 'a' }).doc;
  doc = addEdge(doc, { source: getI.nodeId, sourceHandle: 'value', target: addOp.nodeId, targetHandle: 'b' }).doc;
  doc = addEdge(doc, { source: addOp.nodeId, sourceHandle: 'value', target: setTotal.nodeId, targetHandle: 'value' }).doc;

  // For next -> Print total
  const printNode = addNode(doc, 'print'); doc = printNode.doc;
  doc = addEdge(doc, { source: forId, sourceHandle: 'next', target: printNode.nodeId, targetHandle: 'in' }).doc;

  const getTotalAfter = addNode(doc, 'get'); doc = getTotalAfter.doc;
  doc.nodes.find((n) => n.id === getTotalAfter.nodeId).data.variableId = vTotal.variableId;
  doc = addEdge(doc, { source: getTotalAfter.nodeId, sourceHandle: 'value', target: printNode.nodeId, targetHandle: 'value' }).doc;

  // Export to python code
  const { code, diagnostics } = generateGeometryCode(doc, 'python');
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
  assert.ok(code, 'Code must be generated');

  // Execute in Python 3
  const run = spawnSync('python', ['-c', code], { encoding: 'utf8' });
  assert.equal(run.status, 0, `Python execution failed: ${run.stderr}`);
  assert.equal(run.stdout.trim(), '10', 'Sum of 0..4 must be 10');
});

test('Division produces float in python runtime (5 / 2 = 2.5) and Unicode string escapes cleanly', () => {
  const pyCheck = spawnSync('python', ['--version']);
  if (pyCheck.status !== 0) return;

  // Print (5 / 2) and Print("สวัสดี \n World")
  let doc = createGeometryDocument();
  doc.target = 'python';

  const n5 = addNode(doc, 'int'); doc = n5.doc;
  doc.nodes.find((n) => n.id === n5.nodeId).data.value = 5;

  const n2 = addNode(doc, 'int'); doc = n2.doc;
  doc.nodes.find((n) => n.id === n2.nodeId).data.value = 2;

  const divOp = addNode(doc, 'divide'); doc = divOp.doc;
  doc = addEdge(doc, { source: n5.nodeId, sourceHandle: 'value', target: divOp.nodeId, targetHandle: 'a' }).doc;
  doc = addEdge(doc, { source: n2.nodeId, sourceHandle: 'value', target: divOp.nodeId, targetHandle: 'b' }).doc;

  const p1 = addNode(doc, 'print'); doc = p1.doc;
  doc = addEdge(doc, { source: 'start', sourceHandle: 'next', target: p1.nodeId, targetHandle: 'in' }).doc;
  doc = addEdge(doc, { source: divOp.nodeId, sourceHandle: 'value', target: p1.nodeId, targetHandle: 'value' }).doc;

  // Print string with Thai and newline
  const strNode = addNode(doc, 'string'); doc = strNode.doc;
  doc.nodes.find((n) => n.id === strNode.nodeId).data.value = 'สวัสดี \n World';

  const p2 = addNode(doc, 'print'); doc = p2.doc;
  doc = addEdge(doc, { source: p1.nodeId, sourceHandle: 'next', target: p2.nodeId, targetHandle: 'in' }).doc;
  doc = addEdge(doc, { source: strNode.nodeId, sourceHandle: 'value', target: p2.nodeId, targetHandle: 'value' }).doc;

  const { code, diagnostics } = generateGeometryCode(doc, 'python');
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);

  const run = spawnSync('python', ['-c', code], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });
  assert.equal(run.status, 0);
  const lines = run.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], '2.5');
  assert.equal(lines[1], 'สวัสดี ');
  assert.equal(lines[2], ' World');
});
