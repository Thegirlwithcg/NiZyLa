import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGeometryDocument, parseGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode, generateGeometryPreview } from '../src/core/geometry-codegen.js';

function add(doc, id, type, data = {}) {
  doc.nodes.push({ id, type, position: { x: 0, y: 0 }, data });
}
function edge(doc, id, source, sourceHandle, target, targetHandle) {
  doc.edges.push({ id, source, sourceHandle, target, targetHandle });
}
function printChain(doc, ids) {
  let previous = 'start';
  for (const id of ids) { edge(doc, `exec-${id}`, previous, 'next', id, 'in'); previous = id; }
}

test('legacy named argument handles migrate to arg_i without changing generated code', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'p', 'functionCall', { name: 'print', argumentNames: ['hp'] });
  add(doc, 'value', 'literal', { valueType: 'int', value: 7 });
  printChain(doc, ['p']);
  edge(doc, 'value-p', 'value', 'value', 'p', 'arg_0');
  const legacy = JSON.parse(JSON.stringify(doc));
  legacy.edges.find((e) => e.id === 'value-p').targetHandle = 'hp';
  const migrated = parseGeometryDocument(JSON.stringify(legacy)).document;
  assert.equal(migrated.edges.find((e) => e.id === 'value-p').targetHandle, 'arg_0');
  assert.equal(generateGeometryCode(migrated, 'python').code, generateGeometryCode(doc, 'python').code);
});

test('preview matches strict code for a valid graph', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'p', 'print', { argCount: 0 });
  printChain(doc, ['p']);
  const strict = generateGeometryCode(doc, 'python');
  const preview = generateGeometryPreview(doc, 'python');
  assert.equal(preview.code, strict.code);
  assert.deepEqual(preview.skippedNodeIds, []);
});

test('preview keeps valid prints around a broken print', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'p1', 'print', { argCount: 0 });
  add(doc, 'broken', 'print', { argCount: 1 });
  add(doc, 'p3', 'print', { argCount: 0 });
  printChain(doc, ['p1', 'broken', 'p3']);
  const preview = generateGeometryPreview(doc, 'python');
  assert.match(preview.code, /print\(\)\n# ⚠ skipped Print:/);
  assert.match(preview.code, /# ⚠ skipped Print:[\s\S]*print\(\)\n/);
  assert.deepEqual(preview.skippedNodeIds, ['broken']);
});

function assertPython(code) {
  const parsed = spawnSync('python', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
}

test('preview skips a Print consuming a math expression with a missing input', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'math', 'binary', { operator: '+' });
  add(doc, 'badPrint', 'print', { argCount: 1 });
  add(doc, 'after', 'print', { argCount: 1 });
  add(doc, 'one', 'literal', { valueType: 'int', value: 1 });
  add(doc, 'text', 'literal', { valueType: 'string', value: 'after' });
  printChain(doc, ['badPrint', 'after']);
  edge(doc, 'one-math', 'one', 'value', 'math', 'a');
  edge(doc, 'math-print', 'math', 'value', 'badPrint', 'value');
  edge(doc, 'text-after', 'text', 'value', 'after', 'value');
  const preview = generateGeometryPreview(doc, 'python');
  assert.match(preview.code, /# ⚠ skipped Print: /);
  assert.match(preview.code, /print\("after"\)/);
  assert.doesNotMatch(preview.code, /x \+ 0|\+ 0/);
  assertPython(preview.code);
});

test('preview skips invalid variable declarations and consumers but keeps other statements', () => {
  const doc = createGeometryDocument('python', 2);
  doc.variables.push({ id: 'badvar', name: '1bad', type: 'int', initialValue: 1 });
  add(doc, 'get', 'getVariable', { variableId: 'badvar' });
  add(doc, 'badPrint', 'print', { argCount: 1 });
  add(doc, 'after', 'print', { argCount: 1 });
  add(doc, 'text', 'literal', { valueType: 'string', value: 'after' });
  printChain(doc, ['badPrint', 'after']);
  edge(doc, 'get-print', 'get', 'value', 'badPrint', 'value');
  edge(doc, 'text-after', 'text', 'value', 'after', 'value');
  const preview = generateGeometryPreview(doc, 'python');
  assert.match(preview.code, /# ⚠ skipped variable 1bad:/);
  assert.match(preview.code, /print\("after"\)/);
  assertPython(preview.code);
});

test('preview replaces an invalid function definition at its position while keeping calls', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'fn', 'functionDef', { name: 'f', parameters: [{ id: 'p', name: '1a', type: 'any' }], graph: { nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [], variables: [], viewport: { x: 0, y: 0, zoom: 1 } } });
  add(doc, 'call', 'functionCall', { targetId: 'fn', name: 'f', argumentNames: ['1a'] });
  add(doc, 'one', 'literal', { valueType: 'int', value: 1 });
  edge(doc, 'call-seq', 'start', 'next', 'call', 'in');
  edge(doc, 'one-call', 'one', 'value', 'call', 'arg_0');
  const preview = generateGeometryPreview(doc, 'python');
  assert.match(preview.code, /# ⚠ skipped Function f: /);
  assert.doesNotMatch(preview.code, /def f\(1a\)/);
  assert.match(preview.code, /f\(1\)/);
  assertPython(preview.code);
});

test('preview keeps a valid function when an errored body node is skipped', () => {
  const doc = createGeometryDocument('python', 2);
  const body = { nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }, { id: 'bad', type: 'print', position: { x: 0, y: 0 }, data: { argCount: 1 } }], edges: [{ id: 'body-seq', source: 'start', sourceHandle: 'next', target: 'bad', targetHandle: 'in' }], variables: [], viewport: { x: 0, y: 0, zoom: 1 } };
  add(doc, 'fnbody', 'functionDef', { name: 'body', parameters: [], graph: body });
  const preview = generateGeometryPreview(doc, 'python');
  assert.match(preview.code, /def body\(\):[\s\S]*# ⚠ skipped Print:/);
  assertPython(preview.code);
});

test('preview skips an if block with a missing condition and continues next', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'if1', 'if', {});
  add(doc, 'body', 'print', { argCount: 0 });
  add(doc, 'after', 'print', { argCount: 0 });
  edge(doc, 's-if', 'start', 'next', 'if1', 'in');
  edge(doc, 'if-body', 'if1', 'then', 'body', 'in');
  edge(doc, 'if-next', 'if1', 'next', 'after', 'in');
  const preview = generateGeometryPreview(doc, 'python');
  assert.doesNotMatch(preview.code, /if /);
  assert.doesNotMatch(preview.code, /print\(\)\n.*print\(\)/s);
  assert.match(preview.code, /print\(\)\n/);
  assert.ok(preview.skippedNodeIds.includes('if1'));
  const parsed = spawnSync('python', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: preview.code, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
});
