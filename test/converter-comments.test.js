import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { convertGdscriptToGcn } from '../src/core/gdscript-converter.js';
import { createGeometryDocument, createChildGraph } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

function parsePython(source) {
  return JSON.parse(spawnSync('python', ['electron/python-parser.py'], { input: source, encoding: 'utf8' }).stdout);
}

function commentTexts(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const i = line.indexOf('#');
    return i >= 0 ? [line.slice(i + 1).trim()] : [];
  }).filter(Boolean).filter((text) => text !== 'trailing end comment');
}

function assertCommentsOnce(code, source) {
  for (const text of commentTexts(source)) {
    assert.equal((code.match(new RegExp(`^\\s*# ${text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'gm')) || []).length, 1, text);
  }
}

test('K.1 Python fixture comments attach once and leave only the trailing comment unattached', () => {
  const source = fs.readFileSync('test/fixtures/comments.py', 'utf8');
  const result = convertPythonAstToGcn(parsePython(source), source);
  const code = generateGeometryCode(result.document, 'python').code;
  assert.equal(result.unattachedComments, 1);
  assertCommentsOnce(code, source);
});

test('K.1 GDScript fixture comments attach once and comment-only ready emits pass', async () => {
  const source = fs.readFileSync('test/fixtures/comments.gd', 'utf8');
  const result = await convertGdscriptToGcn(source);
  const code = generateGeometryCode(result.document, 'gdscript').code;
  assert.equal(result.unattachedComments, 0);
  assertCommentsOnce(code, source);
  assert.match(code, /func _ready\(\):\n    pass/);
  assert.equal((code.match(/^\s*# greet$/gm) || []).length, 1);
});

test('K.1 code-only function body still emits pass', () => {
  const doc = createGeometryDocument('python', 2);
  const child = createChildGraph();
  const code = { id: 'comment', type: 'codeNode', position: { x: 0, y: 0 }, data: { codeKind: 'statement', code: '# only comment', language: 'python' } };
  child.nodes.push(code);
  child.edges.push({ id: 'edge', source: 'start', sourceHandle: 'next', target: code.id, targetHandle: 'in' });
  doc.nodes.push({ id: 'fn', type: 'functionDef', position: { x: 0, y: 0 }, data: { name: 'f', parameters: [], returnType: 'any', graph: child } });
  doc.edges.push({ id: 'root-edge', source: 'start', sourceHandle: 'next', target: 'fn', targetHandle: 'in' });
  assert.match(generateGeometryCode(doc, 'python').code, /def f\(\):\n    # only comment\n    pass/);
});
