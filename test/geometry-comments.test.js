import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGeometryDocument, parseGeometryDocument, serializeGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';

function parsePython(source) {
  return JSON.parse(spawnSync('python', ['electron/python-parser.py'], { input: source, encoding: 'utf8' }).stdout);
}
function add(doc, id, type, data) { doc.nodes.push({ id, type, position: { x: 0, y: 0 }, data }); }

test('node comments serialize, parse, omit blanks, and reject oversized comments', () => {
  const doc = createGeometryDocument();
  doc.nodes[0].data.comment = ' start note\r\n';
  const parsed = parseGeometryDocument(serializeGeometryDocument(doc));
  assert.equal(parsed.document.nodes[0].data.comment, 'start note');
  const blank = createGeometryDocument(); blank.nodes[0].data.comment = '   ';
  assert.equal(JSON.parse(serializeGeometryDocument(blank)).nodes[0].data.comment, undefined);
  const oversized = createGeometryDocument(); oversized.nodes[0].data.comment = 'x'.repeat(2001);
  assert.ok(parseGeometryDocument(JSON.stringify(oversized)).diagnostics.some((d) => d.code === 'invalid-schema'));
});

test('Python statement and value comments are emitted above their consumer', () => {
  const doc = createGeometryDocument('python', 2);
  add(doc, 'p', 'print', { argCount: 1, comment: 'print note' });
  add(doc, 'v', 'literal', { valueType: 'int', value: 2, comment: 'value note' });
  doc.edges.push({ id: 's', source: 'start', sourceHandle: 'next', target: 'p', targetHandle: 'in' }, { id: 'v', source: 'v', sourceHandle: 'value', target: 'p', targetHandle: 'value' });
  const code = generateGeometryCode(doc, 'python').code;
  assert.match(code, /# print note\n# value note\nprint\(2\)/);
});

test('Start comments are placed before Python main guard and GDScript ready', () => {
  const py = createGeometryDocument('python', 2); py.nodes[0].data = { mainGuard: true, comment: 'start note' };
  assert.match(generateGeometryCode(py, 'python').code, /# start note\nif __name__ == "__main__":/);
  const gd = createGeometryDocument('gdscript', 2); gd.nodes[0].data.comment = 'ready note';
  assert.match(generateGeometryCode(gd, 'gdscript').code, /# ready note\nfunc _ready\(\):/);
});

test('Python converter attaches full-line and inline comments to statements', () => {
  const source = '# before\nprint(1) # inline\n';
  const result = convertPythonAstToGcn(parsePython(source), source);
  const printNode = result.document.nodes.find((n) => n.type === 'print');
  assert.equal(printNode.data.comment, 'before\ninline');
});
