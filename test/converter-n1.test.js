import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { convertGdscriptToGcn } from '../src/core/gdscript-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { layoutGraph } from '../src/core/geometry-layout.js';

const parsePy = (source) => JSON.parse(spawnSync('python', ['electron/python-parser.py'], { input: source, encoding: 'utf8' }).stdout);

test('N.1 GDScript member initializers remain verbatim and strict-valid', async () => {
  const source = `extends Node\nvar a: int = 5 + 3\nvar b: String = "hi"\nvar c = get_count()\nvar d: bool = a > 2\nfunc get_count():\n    return 4\nfunc _ready():\n    print(a, b, c, d)\n`;
  const result = await convertGdscriptToGcn(source);
  const generated = generateGeometryCode(result.document, 'gdscript');
  assert.deepEqual(generated.diagnostics.filter((d) => d.severity === 'error'), []);
  for (const line of source.split('\n').filter((line) => line.startsWith('var '))) assert.ok(generated.code.includes(line), line);
  assert.equal(result.document.nodes.filter((n) => n.type === 'setVariable').length, 0);
});

test('N.1 foldLiteralInitializers false keeps snippet assignments executable', () => {
  const source = 'x = 1\nprint(x)\n';
  const result = convertPythonAstToGcn(parsePy(source), source, null, { foldLiteralInitializers: false });
  assert.equal(result.document.nodes.filter((n) => n.type === 'setVariable').length, 1);
});

test('N.1 layout is deterministic, wrapped, and non-overlapping with measured sizes', () => {
  const source = ['def f(x):', '    if x:', '        print(1)', '        print(2)', '    while x:', '        print(3)', ...Array.from({ length: 60 }, (_, i) => `    print(${i})`)].join('\n');
  const result = convertPythonAstToGcn(parsePy(source), source);
  const graph = result.document.nodes.find((n) => n.type === 'functionDef').data.graph;
  const sizes = new Map(graph.nodes.map((n) => [n.id, { width: 200, height: 100 }]));
  const before = JSON.stringify(graph.nodes.map((n) => n.position));
  layoutGraph(graph, sizes);
  const after = JSON.stringify(graph.nodes.map((n) => n.position));
  layoutGraph(graph, sizes);
  assert.equal(JSON.stringify(graph.nodes.map((n) => n.position)), after);
  assert.notEqual(before, after);
  for (let i = 0; i < graph.nodes.length; i++) for (let j = i + 1; j < graph.nodes.length; j++) {
    const a = graph.nodes[i], b = graph.nodes[j];
    assert.ok(a.position.x + 200 <= b.position.x || b.position.x + 200 <= a.position.x || a.position.y + 100 <= b.position.y || b.position.y + 100 <= a.position.y);
  }
});
