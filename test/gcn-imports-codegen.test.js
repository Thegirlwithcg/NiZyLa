import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode, generateGeometryPreview } from '../src/core/geometry-codegen.js';
import { gcnModuleName, gcnImportDiagnostics } from '../src/core/gcn-imports.js';

const table = [
  ['', 'lib/shapes.gcn', 'lib.shapes'],
  ['', 'shapes.gcn', 'shapes'],
  ['lib/sub', '../util.gcn', 'lib.util']
];
for (const [dir, path, module] of table) test(`gcnModuleName ${dir || 'root'} ${path}`, () => assert.deepEqual(gcnModuleName(dir, path), { module }));
test('gcnModuleName rejects escaping root', () => assert.ok(gcnModuleName('lib', '../../x.gcn').error));
test('gcnModuleName rejects hyphen and names the segment', () => assert.match(gcnModuleName('', 'my-lib/a.gcn').error, /my-lib/));
test('gcnModuleName rejects Python keywords', () => assert.ok(gcnModuleName('', 'class.gcn').error));
test('gcnModuleName rejects digit-leading segments', () => assert.ok(gcnModuleName('', '2d/a.gcn').error));

const importNode = (path = 'lib/shapes.gcn', alias = 'shapes') => ({ id: 'imp', type: 'import', position: { x: 0, y: 0 }, data: { importType: 'gcn', path, alias } });
const simpleDoc = (path = 'lib/shapes.gcn', alias = 'shapes') => { const doc = createGeometryDocument('python'); doc.nodes.push(importNode(path, alias)); return doc; };
const withImport = (lines) => {
  const d = createGeometryDocument('python');
  const source = lines.join(String.fromCharCode(10));
  const make = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
  const link = (id, sourceId, targetId, sourceHandle = 'next', targetHandle = 'in') => ({ id, source: sourceId, target: targetId, sourceHandle, targetHandle });
  const literal = (id, value) => make(id, 'literal', { valueType: 'int', value });
  const call = (id, name, argId, importId = 'imp') => make(id, 'functionCall', { importNodeId: importId, name, argumentNames: argId ? ['arg'] : [], isMethod: false });
  const print = (id, valueId) => make(id, 'print', { argCount: 1 });
  d.nodes.push(importNode());
  if (source.includes('def f')) {
    const graph = { nodes: [make('fs', 'start'), call('nestedCall', 'area', 'one'), literal('one', 1)], edges: [link('fs-call', 'fs', 'nestedCall'), { id: 'one-call', source: 'one', target: 'nestedCall', sourceHandle: 'value', targetHandle: 'arg_0' }], variables: [], viewport: { x: 0, y: 0, zoom: 1 } };
    d.nodes.push(make('fn', 'functionDef', { name: 'f', parameters: [], returnType: 'any', isStatic: false, graph }));
    d.edges.push(link('start-fn', 'start', 'fn'));
  } else if (source.includes('print(area') && source.includes('c = Circle')) {
    d.variables.push({ id: 'v', name: 'c', type: 'int', initialValue: 0 });
    d.nodes.push(print('printArea', 'areaCall'), call('areaCall', 'area', 'two'), literal('two', 2), make('set', 'setVariable', { variableId: 'v' }), make('new', 'functionCall', { importNodeId: 'imp', name: 'Circle', argumentNames: ['arg'], isMethod: false }), literal('three', 3), print('printMember', 'member'), make('member', 'getMember', { memberName: 'r' }), make('getC', 'getVariable', { variableId: 'v' }));
    d.edges.push(link('start-area', 'start', 'printArea'), { id: 'area-print', source: 'areaCall', target: 'printArea', sourceHandle: 'value', targetHandle: 'value' }, { id: 'two-area', source: 'two', target: 'areaCall', sourceHandle: 'value', targetHandle: 'arg_0' }, link('print-set', 'printArea', 'set'), { id: 'new-set', source: 'new', target: 'set', sourceHandle: 'value', targetHandle: 'value' }, { id: 'three-new', source: 'three', target: 'new', sourceHandle: 'value', targetHandle: 'arg_0' }, link('set-member-print', 'set', 'printMember'), { id: 'member-print', source: 'member', target: 'printMember', sourceHandle: 'value', targetHandle: 'value' }, { id: 'get-member', source: 'getC', target: 'member', sourceHandle: 'value', targetHandle: 'object' });
  } else if (source.includes('c = Circle')) {
    d.variables.push({ id: 'v', name: 'c', type: 'int', initialValue: 0 });
    d.nodes.push(make('set', 'setVariable', { variableId: 'v' }), make('new', 'functionCall', { importNodeId: 'imp', name: 'Circle', argumentNames: ['arg'], isMethod: false }), literal('three', 3));
    d.edges.push(link('start-set', 'start', 'set'), { id: 'new-set', source: 'new', target: 'set', sourceHandle: 'value', targetHandle: 'value' }, { id: 'three-new', source: 'three', target: 'new', sourceHandle: 'value', targetHandle: 'arg_0' });
  } else if (source.includes('print(area')) {
    d.nodes.push(print('print', 'call'), call('call', 'area', 'two'), literal('two', 2));
    d.edges.push(link('start-print', 'start', 'print'), { id: 'call-print', source: 'call', target: 'print', sourceHandle: 'value', targetHandle: 'value' }, { id: 'two-call', source: 'two', target: 'call', sourceHandle: 'value', targetHandle: 'arg_0' });
  } else if (source.includes('print(PI')) {
    d.nodes.push(print('print', 'ref'), make('ref', 'symbolRef', { symbol: 'PI', importNodeId: 'imp' }));
    d.edges.push(link('start-print', 'start', 'print'), { id: 'ref-print', source: 'ref', target: 'print', sourceHandle: 'value', targetHandle: 'value' });
  } else if (source.includes('print(1')) {
    d.nodes.push(print('print', 'one'), literal('one', 1));
    d.edges.push(link('start-print', 'start', 'print'), { id: 'one-print', source: 'one', target: 'print', sourceHandle: 'value', targetHandle: 'value' });
  } else {
    d.nodes.push(call('call', 'area', 'one'), literal('one', 1));
    d.edges.push(link('start-call', 'start', 'call'), { id: 'one-call', source: 'one', target: 'call', sourceHandle: 'value', targetHandle: 'arg_0' });
  }
  return d;
};
const allNodes = (graph, result = []) => { for (const node of graph.nodes || []) { result.push(node); if (node.data?.graph) allNodes(node.data.graph, result); } return result; };

test('gcnImportDiagnostics reports invalid Python module', () => { const d = simpleDoc('my-lib/a.gcn'); const x = gcnImportDiagnostics(d, 'python', {}); assert.equal(x[0].code, 'gcn-import-invalid-module'); assert.equal(x[0].nodeId, 'imp'); });
test('two-argument codegen signature remains valid', () => { const r = generateGeometryCode(simpleDoc()); assert.equal(r.diagnostics.some(d => d.severity === 'error'), false); });
test('Python GCN import emits aliased module', () => { const r = generateGeometryCode(simpleDoc()); assert.match(r.code, new RegExp('^import lib[.]shapes as shapes', 'm')); });
test('Python GCN import emits bare module when alias matches', () => { const r = generateGeometryCode(simpleDoc('shapes.gcn', 'shapes')); assert.match(r.code, new RegExp('^import shapes$', 'm')); });
test('Python GCN import resolves importer relative directory', () => { const r = generateGeometryCode(simpleDoc('../util.gcn', 'util'), 'python', { importerRelDir: 'lib/sub' }); assert.match(r.code, new RegExp('^import lib[.]util as util', 'm')); });
test('invalid Python GCN module is strict', () => { const r = generateGeometryCode(simpleDoc('my-lib/a.gcn')); assert.equal(r.code, null); assert.ok(r.diagnostics.some(d => d.code === 'gcn-import-invalid-module' && d.nodeId === 'imp')); });
test('invalid Python GCN module is skipped by preview', () => { const d = withImport(['print(1)']); d.nodes.find(node => node.id === 'imp').data.path = 'my-lib/a.gcn'; const r = generateGeometryPreview(d, 'python'); assert.match(r.code, /skipped Import shapes/); assert.match(r.code, /print[(]1[)]/); assert.ok(r.skippedNodeIds.includes('imp')); });
test('normal Python imports remain byte stable', () => { const d = createGeometryDocument('python'); d.nodes.push({ id: 'm', type: 'import', position: { x: 0, y: 0 }, data: { importType: 'module', module: 'math' } }, { id: 'f', type: 'import', position: { x: 0, y: 0 }, data: { importType: 'from', module: 'os', names: [{ name: 'path', alias: '' }] } }); const r = generateGeometryCode(d, 'python'); assert.equal(r.code, ['import math', 'from os import path', ''].join(String.fromCharCode(10))); });

test('functionCall import reference is emitted in a statement', () => { const d = withImport(['area(1)']); const call = allNodes(d).find(node => node.type === 'functionCall'); call.data.importNodeId = 'imp'; const r = generateGeometryCode(d, 'python'); assert.match(r.code, new RegExp('shapes[.]area[(]1[)]')); });
test('functionCall import reference is emitted as an expression', () => { const d = withImport(['print(area(2))']); const call = allNodes(d).find(node => node.type === 'functionCall'); call.data.importNodeId = 'imp'; assert.match(generateGeometryCode(d, 'python').code, new RegExp('print[(]shapes[.]area[(]2[)][)]')); });
test('functionCall inside a function resolves the root alias', () => { const d = withImport(['def f():', '    area(1)']); const call = allNodes(d).find(node => node.type === 'functionCall'); call.data.importNodeId = 'imp'; assert.match(generateGeometryCode(d, 'python').code, new RegExp('    shapes[.]area[(]1[)]')); });
test('instantiate import reference is emitted with the alias', () => { const d = withImport(['c = Circle(3)']); const call = allNodes(d).find(node => node.type === 'functionCall'); call.type = 'instantiate'; call.data.importNodeId = 'imp'; call.data.className = 'Circle'; assert.match(generateGeometryCode(d, 'python').code, new RegExp('shapes[.]Circle[(]3[)]')); });
test('symbolRef import reference is emitted with the alias', () => { const d = withImport(['print(PI)']); const ref = allNodes(d).find(node => node.type === 'symbolRef'); ref.data = { symbol: 'PI', importNodeId: 'imp' }; assert.match(generateGeometryCode(d, 'python').code, new RegExp('print[(]shapes[.]PI[)]')); });
test('preview accepts importerRelDir option', () => assert.equal(generateGeometryPreview(simpleDoc(), 'python', { importerRelDir: '' }).diagnostics.length, 0));
test('full Python imported call, instantiate, and getMember output', () => { const d = withImport(['print(area(2))', 'c = Circle(3)', 'print(c.r)']); for (const node of allNodes(d).filter(item => item.type === 'functionCall')) node.data.importNodeId = 'imp'; const result = generateGeometryCode(d, 'python'); assert.equal(result.code, ['import lib.shapes as shapes', '', 'c = 0', 'print(shapes.area(2))', 'c = shapes.Circle(3)', 'print(c.r)', ''].join(String.fromCharCode(10))); });
