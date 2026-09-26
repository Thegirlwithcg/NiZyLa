import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGeometryDocument } from '../src/core/geometry.js';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { generateGeometryPreview } from '../src/core/geometry-codegen.js';
import { applyEdit, createEditorState, spliceConvertedFragment, undo } from '../src/core/geometry-editor.js';

const parse = (source) => JSON.parse(spawnSync('python', ['electron/python-parser.py'], { input: source, encoding: 'utf8' }).stdout);
const converted = (source) => convertPythonAstToGcn(parse(source), source).document;

function graphWithCode(data = {}) {
  const doc = createGeometryDocument('python', 2);
  const code = { id: 'code', type: 'codeNode', position: { x: 100, y: 0 }, data: { codeKind: 'statement', code: 'x = 1\nprint(x)', language: 'python', ...data } };
  const before = { id: 'before', type: 'print', position: { x: 0, y: 0 }, data: { argCount: 0 } };
  const after = { id: 'after', type: 'print', position: { x: 500, y: 0 }, data: { argCount: 0 } };
  doc.nodes.push(before, code, after);
  doc.edges.push(
    { id: 'in', source: 'start', sourceHandle: 'next', target: 'before', targetHandle: 'in' },
    { id: 'before-code', source: 'before', sourceHandle: 'next', target: 'code', targetHandle: 'in' },
    { id: 'code-after', source: 'code', sourceHandle: 'next', target: 'after', targetHandle: 'in' }
  );
  return doc;
}

test('Code node splice preserves the execution chain and generated preview', () => {
  const before = graphWithCode();
  const result = spliceConvertedFragment(before, 'code', converted('x = 1\nprint(x)\n'), [], { isRootScope: true });
  assert.ok(!result.error);
  const types = result.doc.nodes.map((n) => n.type);
  assert.equal(types.includes('codeNode'), false);
  const preview = generateGeometryPreview(result.doc, 'python');
  assert.match(preview.code, /x = 1/);
  assert.match(preview.code, /print\(x\)/);
  assert.equal(result.doc.edges.some((e) => e.source === 'before' && e.targetHandle === 'in'), true);
  assert.equal(result.doc.edges.some((e) => e.target === 'after' && e.sourceHandle === 'next'), true);
});

test('Expression Code node splice routes the math root into the consumer', () => {
  const doc = graphWithCode({ codeKind: 'expression', code: '3 * 4' });
  const print = doc.nodes.find((n) => n.id === 'after');
  doc.edges.push({ id: 'value', source: 'code', sourceHandle: 'value', target: print.id, targetHandle: 'value' });
  const result = spliceConvertedFragment(doc, 'code', converted('_gcn_expr = (3 * 4)\n'), [], { isRootScope: true });
  assert.ok(!result.error);
  assert.equal(result.doc.edges.some((e) => e.target === 'after' && e.targetHandle === 'value'), true);
  assert.equal(result.doc.nodes.some((n) => n.type === 'binary'), true);
});

test('Code splice reuses an accessible variable and refuses nested structural conversions', () => {
  const doc = graphWithCode();
  doc.variables.push({ id: 'x-existing', name: 'x', type: 'int', initialValue: 0 });
  const result = spliceConvertedFragment(doc, 'code', converted('x = 1\nprint(x)\n'), doc.variables, { isRootScope: true });
  assert.ok(!result.error);
  assert.equal(result.doc.variables.filter((v) => v.name === 'x').length, 1);

  const nested = spliceConvertedFragment(doc, 'code', converted('def f():\n    pass\n'), [], { isRootScope: false });
  assert.match(nested.error, /nested scope/);
});

test('Code splice is one undoable edit and single-Code conversion is refused', () => {
  const original = graphWithCode();
  const state = createEditorState(original);
  const replacement = spliceConvertedFragment(original, 'code', converted('x = 1\nprint(x)\n'), [], { isRootScope: true });
  const changed = applyEdit(state, replacement.doc);
  assert.equal(changed.past.length, 1);
  assert.deepEqual(undo(changed).present, original);
  const onlyCode = converted('x += y\n');
  const refused = spliceConvertedFragment(original, 'code', onlyCode, [], { isRootScope: true });
  assert.match(refused.error, /no node equivalent/);
});
