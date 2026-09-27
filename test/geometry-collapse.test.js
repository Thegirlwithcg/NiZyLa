import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryDocument, nodeDefinitions } from '../src/core/geometry.js';
import { convertGdscriptToGcn } from '../src/core/gdscript-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { collapseToCodeNode, spliceConvertedFragment } from '../src/core/geometry-editor.js';

const n = (id, type, data = {}, x = 0, y = 0) => ({ id, type, position: { x, y }, data });
const e = (source, sourceHandle, target, targetHandle) => ({ id: `${source}-${target}-${sourceHandle}`, source, sourceHandle, target, targetHandle });
const make = (target, nodes, edges, variables = []) => ({ ...createGeometryDocument(target), nodes: [n('start', 'start'), ...nodes], edges, variables });
const resultCode = (doc, target) => generateGeometryCode(doc, target).code;

test('collapse replaces a middle statement chain and preserves generated code (both targets)', () => {
  for (const target of ['python', 'gdscript']) {
    const doc = make(target, [n('before', 'print'), n('a', 'print'), n('b', 'print'), n('c', 'print'), n('after', 'print')], [
      e('start', 'next', 'before', 'in'), e('before', 'next', 'a', 'in'), e('a', 'next', 'b', 'in'), e('b', 'next', 'c', 'in'), e('c', 'next', 'after', 'in')
    ]);
    const oldCode = resultCode(doc, target);
    const collapsed = collapseToCodeNode(doc, [], ['a', 'b', 'c'], target);
    assert.equal(collapsed.ok, true);
    assert.equal(resultCode(collapsed.doc, target), oldCode);
    const code = collapsed.doc.nodes.find((node) => node.id === collapsed.nodeId);
    assert.equal(code.type, 'codeNode');
    assert.equal(code.data.title, 'Converted 3 nodes');
    assert.ok(collapsed.doc.edges.some((edge) => edge.source === 'before' && edge.target === collapsed.nodeId && edge.targetHandle === 'in'));
    assert.ok(collapsed.doc.edges.some((edge) => edge.source === collapsed.nodeId && edge.target === 'after' && edge.sourceHandle === 'next'));
  }
});

test('collapse accepts an If together with its complete body and refuses a partial body', () => {
  const nodes = [n('branch', 'if'), n('condition', 'literal', { valueType: 'bool', value: true }), n('yes', 'print'), n('no', 'print')];
  const edges = [e('start', 'next', 'branch', 'in'), e('branch', 'then', 'yes', 'in'), e('branch', 'else', 'no', 'in'), e('condition', 'value', 'branch', 'condition')];
  const doc = make('python', nodes, edges);
  assert.equal(collapseToCodeNode(doc, [], ['branch', 'condition', 'yes', 'no'], 'python').ok, true);
  assert.deepEqual(collapseToCodeNode(doc, [], ['branch', 'condition', 'yes'], 'python'), { ok: false, message: 'Select one continuous chain of statements.' });
});

test('collapse absorbs pure value sources, but refuses a source used elsewhere', () => {
  const nodes = [n('statement', 'print'), n('value', 'literal', { valueType: 'int', value: 7 }), n('outside', 'print')];
  const doc = make('python', nodes, [e('start', 'next', 'statement', 'in'), e('value', 'value', 'statement', 'value')]);
  const collapsed = collapseToCodeNode(doc, [], ['statement'], 'python');
  assert.equal(collapsed.ok, true);
  assert.equal(collapsed.doc.nodes.some((node) => node.id === 'value'), false);
  const shared = { ...doc, edges: [...doc.edges, e('value', 'value', 'outside', 'value')] };
  assert.deepEqual(collapseToCodeNode(shared, [], ['statement'], 'python'), { ok: false, message: 'Value feeds this selection and is used elsewhere; select it too or leave this node out.' });
});

test('collapse enforces start, structural-node, GDScript input, and module-global rules', () => {
  const empty = make('python', [], []);
  assert.equal(collapseToCodeNode(empty, [], [], 'python').message, 'Select nodes other than Start.');
  assert.equal(collapseToCodeNode(empty, [], ['start'], 'python').message, 'Select nodes other than Start.');
  const structural = make('python', [n('f', 'functionDef')], []);
  assert.equal(collapseToCodeNode(structural, [], ['f'], 'python').message, "Function, Class and Import nodes can't be converted to code.");
  const input = make('gdscript', [n('input', 'input'), n('print', 'print')], [e('start', 'next', 'print', 'in')]);
  assert.equal(collapseToCodeNode(input, [], ['input'], 'gdscript').message, "Input can't be converted in GDScript (it needs the _gcn_input helper).");
  const fn = n('fn', 'functionDef', { name: 'f', graph: { nodes: [n('start', 'start'), n('set', 'setVariable', { variableId: 'root' })], edges: [e('start', 'next', 'set', 'in')], variables: [] } });
  const globals = make('python', [fn], [], [{ id: 'root', name: 'score', type: 'int', initialValue: 0 }]);
  assert.equal(collapseToCodeNode(globals, ['fn'], ['set'], 'python').message, 'Setting module variable score inside a function needs `global`; convert it without this node.');
});

test('collapse refuses split statement segments and selected values used outside', () => {
  const split = make('python', [n('a', 'print'), n('b', 'print'), n('c', 'print')], [e('start', 'next', 'a', 'in'), e('start', 'next', 'c', 'in')]);
  assert.equal(collapseToCodeNode(split, [], ['a', 'c'], 'python').message, 'Select one continuous chain of statements.');
  const sharedValue = make('python', [n('value', 'literal', { valueType: 'int', value: 4 }), n('p1', 'print'), n('p2', 'print')], [e('start', 'next', 'p1', 'in'), e('value', 'value', 'p1', 'value'), e('value', 'value', 'p2', 'value')]);
  assert.equal(collapseToCodeNode(sharedValue, [], ['value', 'p1'], 'python').message, "Value's value is used outside the selection.");
});

test('collapse emits expression Code for one external consumer and preserves output', () => {
  for (const target of ['python', 'gdscript']) {
    const nodes = [n('a', 'literal', { valueType: 'int', value: 3 }), n('b', 'literal', { valueType: 'int', value: 1 }), n('sum', 'binary', { operator: '+' }), n('consumer', 'print')];
    const doc = make(target, nodes, [e('start', 'next', 'consumer', 'in'), e('a', 'value', 'sum', 'a'), e('b', 'value', 'sum', 'b'), e('sum', 'value', 'consumer', 'value')]);
    const oldCode = resultCode(doc, target);
    const collapsed = collapseToCodeNode(doc, [], ['a', 'b', 'sum'], target);
    assert.equal(collapsed.ok, true);
    const code = collapsed.doc.nodes.find((node) => node.id === collapsed.nodeId);
    assert.equal(code.data.codeKind, 'expression');
    assert.equal(resultCode(collapsed.doc, target), oldCode);
    const port = nodeDefinitions.codeNode.ports(code).find((item) => item.direction === 'out');
    assert.ok(collapsed.doc.edges.some((edge) => edge.source === code.id && edge.sourceHandle === port.id && edge.target === 'consumer'));
  }
});

test('GDScript collapse and Code-to-Nodes round-trip preserves generated output', async () => {
  const doc = make('gdscript', [n('a', 'print'), n('b', 'print'), n('va', 'literal', { valueType: 'int', value: 1 }), n('vb', 'literal', { valueType: 'int', value: 2 })], [e('start', 'next', 'a', 'in'), e('a', 'next', 'b', 'in'), e('va', 'value', 'a', 'value'), e('vb', 'value', 'b', 'value')]);
  const collapsed = collapseToCodeNode(doc, [], ['a', 'b'], 'gdscript');
  assert.equal(collapsed.ok, true);
  const before = resultCode(doc, 'gdscript');
  assert.equal(resultCode(collapsed.doc, 'gdscript'), before);
  const codeNode = collapsed.doc.nodes.find((node) => node.id === collapsed.nodeId);
  const parsed = await convertGdscriptToGcn(codeNode.data.code);
  assert.ok(parsed.document, parsed.error);
  const restored = spliceConvertedFragment(collapsed.doc, collapsed.nodeId, parsed.document, [], { isRootScope: true });
  assert.ok(!restored.error, restored.error);
  assert.equal(resultCode(restored.doc, 'gdscript'), before);
});
