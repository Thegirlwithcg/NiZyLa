import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeometryDocument, parseGeometryDocument, serializeGeometryDocument,
  validateGeometryDocument, nodeDefinitions, getNodePorts
} from '../src/core/geometry.js';

function node(doc, id, type, data = {}) {
  const item = { id, type, position: { x: 20, y: 40 }, data: { ...nodeDefinitions[type].defaults, ...data } };
  doc.nodes.push(item);
  return item;
}
function edge(doc, source, sourceHandle, target, targetHandle) {
  const item = { id: `edge-${doc.edges.length}`, source, sourceHandle, target, targetHandle };
  doc.edges.push(item);
  return item;
}
const errors = (doc) => validateGeometryDocument(doc).filter((item) => item.severity === 'error');
const codes = (doc) => errors(doc).map((item) => item.code);
function printing(type = 'int', value = 1) {
  const doc = createGeometryDocument();
  node(doc, 'value', 'literal', { valueType: type, value });
  node(doc, 'print', 'print');
  edge(doc, 'start', 'next', 'print', 'in');
  edge(doc, 'value', 'value', 'print', 'value');
  return doc;
}
function loopGraph() {
  const doc = createGeometryDocument();
  doc.variables.push({ id: 'i', name: 'index', type: 'int', initialValue: 0 });
  node(doc, 'loop', 'forRange', { variableId: 'i' });
  edge(doc, 'start', 'next', 'loop', 'in');
  for (const [handle, value] of [['start', 0], ['stop', 5], ['step', 1]]) {
    node(doc, handle + '-value', 'literal', { valueType: 'int', value });
    edge(doc, handle + '-value', 'value', 'loop', handle);
  }
  return doc;
}

test('new documents are valid, independent and round-trip deterministically', () => {
  const doc = createGeometryDocument();
  assert.deepEqual(validateGeometryDocument(doc), []);
  const serialized = serializeGeometryDocument(doc);
  assert.ok(serialized.endsWith('\n'));
  assert.match(serialized, /\n  "format"/);
  assert.deepEqual(parseGeometryDocument(serialized), { document: doc, diagnostics: [] });
  assert.equal(serializeGeometryDocument(parseGeometryDocument(serialized).document), serialized);
  doc.nodes[0].data.changed = true;
  assert.deepEqual(createGeometryDocument().nodes[0].data, {});
});

test('literals and viewport round-trip including Unicode, quotes and newlines', () => {
  for (const [type, value] of [['string', 'สวัสดี "โลก"\n\\ next line'], ['float', 1], ['float', 0.125], ['int', Number.MAX_SAFE_INTEGER], ['bool', false]]) {
    const doc = printing(type, value);
    doc.target = 'gdscript';
    doc.viewport = { x: -150.5, y: 60, zoom: 0.7 };
    doc.nodes[0].position = { x: -200, y: 75.5 };
    assert.deepEqual(errors(doc), []);
    assert.deepEqual(parseGeometryDocument(serializeGeometryDocument(doc)).document, doc);
  }
});

test('serialization strips transient properties at every stored level', () => {
  const doc = printing();
  const expected = structuredClone(doc);
  doc.variables.push({ id: 'v', name: 'value', type: 'int', initialValue: 0, selected: true });
  expected.variables.push({ id: 'v', name: 'value', type: 'int', initialValue: 0 });
  doc.selected = true;
  doc.nodes[1].selected = true;
  doc.nodes[1].data.dom = { circular: doc };
  doc.nodes[1].position.z = 10;
  doc.edges[0].animated = true;
  doc.viewport.measured = {};
  assert.deepEqual(JSON.parse(serializeGeometryDocument(doc)), expected);
});

test('malformed JSON, unsupported format/version and invalid schema are rejected', () => {
  for (const text of ['{broken', '', undefined, 2]) {
    assert.deepEqual(parseGeometryDocument(text).diagnostics.map((d) => d.code), ['invalid-json']);
    assert.equal(parseGeometryDocument(text).document, null);
  }
  for (const change of [
    (d) => { d.format = 'other'; }, (d) => { d.version = 999; },
    (d) => { d.target = 'javascript'; }, (d) => { delete d.nodes; },
    (d) => { d.variables = {}; }, (d) => { d.edges = null; },
    (d) => { d.viewport.zoom = 0; }, (d) => { delete d.viewport.x; },
    (d) => { d.nodes[0].type = 'constructor'; },
    (d) => { d.nodes[0].id = ' '; }, (d) => { d.nodes[0].position.x = '10'; },
    (d) => { d.nodes[0].data = []; },
    (d) => { node(d, 'bad', 'binary', { operator: '^' }); },
    (d) => { node(d, 'bad', 'getVariable', { variableId: null }); },
    (d) => { d.edges.push({ id: 'bad' }); },
    (d) => { d.variables.push({ id: 'v', name: 'v', type: 'int', initialValue: '1' }); }
  ]) {
    const doc = createGeometryDocument();
    change(doc);
    assert.equal(parseGeometryDocument(JSON.stringify(doc)).document, null);
    assert.throws(() => serializeGeometryDocument(doc), TypeError);
    assert.ok(errors(doc).length);
  }
  for (const doc of [null, [], 1, 'text']) assert.ok(errors(doc).length);
});

test('invalid numeric literals and nonfinite coordinates are schema errors', () => {
  for (const [type, value] of [['int', 1.5], ['int', Number.MAX_SAFE_INTEGER + 1], ['float', Infinity], ['float', NaN], ['bool', 1], ['string', 3]]) {
    const doc = printing(type, value);
    assert.ok(codes(doc).includes('invalid-schema'));
    assert.throws(() => serializeGeometryDocument(doc));
  }
  const doc = createGeometryDocument();
  doc.viewport.x = Infinity;
  assert.throws(() => serializeGeometryDocument(doc));
});

test('incomplete and invalid graphs remain parseable and saveable', () => {
  for (const change of [
    (d) => { d.nodes = []; },
    (d) => { node(d, 'second', 'start'); },
    (d) => { node(d, 'p', 'print'); edge(d, 'start', 'next', 'p', 'in'); },
    (d) => { node(d, 'get', 'getVariable'); },
    (d) => { edge(d, 'missing', 'next', 'start', 'in'); }
  ]) {
    const doc = createGeometryDocument();
    change(doc);
    const parsed = parseGeometryDocument(serializeGeometryDocument(doc));
    assert.deepEqual(parsed.document, doc);
    assert.ok(parsed.diagnostics.some((d) => d.severity === 'error'));
  }
});

test('duplicate IDs are diagnosed per namespace and still round-trip', () => {
  for (const key of ['nodes', 'edges', 'variables']) {
    const doc = printing();
    doc.variables.push({ id: 'v', name: 'v', type: 'int', initialValue: 0 });
    doc[key].push(structuredClone(doc[key][0]));
    assert.ok(codes(doc).includes('duplicate-id'));
    assert.deepEqual(parseGeometryDocument(serializeGeometryDocument(doc)).document, doc);
  }
});

test('rejects dangling nodes, unknown ports, backwards ports and mixed wire kinds', () => {
  for (const [source, sourceHandle, target, targetHandle, code] of [
    ['missing', 'value', 'print', 'value', 'missing-node'],
    ['value', 'missing', 'print', 'value', 'missing-port'],
    ['print', 'in', 'print', 'next', 'port-direction'],
    ['start', 'next', 'print', 'value', 'port-kind'],
    ['value', 'value', 'print', 'in', 'port-kind'],
    ['print', 'next', 'start', 'in', 'missing-port']
  ]) {
    const doc = printing();
    const added = edge(doc, source, sourceHandle, target, targetHandle);
    assert.ok(validateGeometryDocument(doc).some((d) => d.code === code && d.edgeId === added.id));
  }
});

test('enforces input/exec output cardinality and permits value fan-out', () => {
  const doc = printing();
  node(doc, 'other', 'print');
  edge(doc, 'print', 'next', 'other', 'in');
  edge(doc, 'value', 'value', 'other', 'value');
  assert.deepEqual(errors(doc), []);
  edge(doc, 'value', 'value', 'other', 'value');
  assert.ok(codes(doc).includes('input-connected'));
  edge(doc, 'start', 'next', 'other', 'in');
  assert.ok(codes(doc).includes('exec-output-connected'));
});

test('finds exec and value cycles including disconnected cycles without recursion', () => {
  const doc = createGeometryDocument();
  node(doc, 'a', 'print'); node(doc, 'b', 'print');
  edge(doc, 'a', 'next', 'b', 'in'); edge(doc, 'b', 'next', 'a', 'in');
  assert.ok(codes(doc).includes('exec-cycle'));
  const values = createGeometryDocument();
  node(values, 'a', 'binary'); node(values, 'b', 'binary');
  edge(values, 'a', 'value', 'b', 'a'); edge(values, 'b', 'value', 'a', 'a');
  assert.ok(codes(values).includes('value-cycle'));
  assert.ok(parseGeometryDocument(serializeGeometryDocument(values)).document);
});

test('infer arithmetic promotion and require matching assignment types', () => {
  for (const [aType, bType, operator, targetType, valid] of [
    ['int', 'int', '+', 'int', true], ['int', 'float', '*', 'float', true],
    ['int', 'float', '-', 'int', false], ['int', 'int', '/', 'int', false],
    ['int', 'int', '/', 'float', true], ['string', 'int', '+', 'float', false]
  ]) {
    const doc = createGeometryDocument();
    doc.variables.push({ id: 'v', name: 'result', type: targetType, initialValue: 0 });
    node(doc, 'a', 'literal', { valueType: aType, value: aType === 'string' ? '2' : 2 });
    node(doc, 'b', 'literal', { valueType: bType, value: 3 });
    node(doc, 'math', 'binary', { operator });
    node(doc, 'set', 'setVariable', { variableId: 'v' });
    edge(doc, 'start', 'next', 'set', 'in');
    edge(doc, 'a', 'value', 'math', 'a'); edge(doc, 'b', 'value', 'math', 'b');
    edge(doc, 'math', 'value', 'set', 'value');
    assert.equal(errors(doc).length === 0, valid, `${aType} ${operator} ${bType} -> ${targetType}`);
  }
  const doc = printing();
  doc.variables.push({ id: 'v', name: 'result', type: 'float', initialValue: 0 });
  doc.nodes[2].type = 'setVariable'; doc.nodes[2].data = { variableId: 'v' };
  assert.deepEqual(errors(doc), []);
});

test('equality, ordering and Boolean ports have distinct type rules', () => {
  for (const [type, operator, aType, a, bType, b, valid] of [
    ['compare', '==', 'int', 1, 'float', 1, true],
    ['compare', '!=', 'string', 'a', 'string', 'b', true],
    ['compare', '==', 'bool', true, 'int', 1, false],
    ['compare', '<', 'string', 'a', 'string', 'b', false],
    ['boolean', 'and', 'bool', true, 'bool', false, true],
    ['boolean', 'or', 'bool', true, 'int', 1, false],
    ['boolean', 'not', 'bool', false, null, null, true]
  ]) {
    const doc = createGeometryDocument();
    node(doc, 'branch', 'if'); node(doc, 'op', type, { operator });
    node(doc, 'a', 'literal', { valueType: aType, value: a });
    edge(doc, 'start', 'next', 'branch', 'in'); edge(doc, 'op', 'value', 'branch', 'condition');
    edge(doc, 'a', 'value', 'op', 'a');
    if (bType) { node(doc, 'b', 'literal', { valueType: bType, value: b }); edge(doc, 'b', 'value', 'op', 'b'); }
    assert.equal(errors(doc).length === 0, valid, `${type} ${operator} ${aType}/${bType}`);
  }
});

test('If and loops form distinct blocks; shared statements are rejected', () => {
  const doc = loopGraph();
  node(doc, 'if', 'if'); node(doc, 'while', 'while'); node(doc, 'condition', 'literal', { valueType: 'bool', value: false });
  edge(doc, 'loop', 'body', 'if', 'in'); edge(doc, 'if', 'then', 'while', 'in');
  edge(doc, 'condition', 'value', 'if', 'condition'); edge(doc, 'condition', 'value', 'while', 'condition');
  assert.deepEqual(errors(doc), []);
  edge(doc, 'if', 'else', 'while', 'in');
  assert.ok(codes(doc).includes('input-connected'));
});

test('For requires int iterator/bounds and rejects literal zero step', () => {
  const doc = loopGraph();
  assert.deepEqual(errors(doc), []);
  doc.nodes.find((n) => n.id === 'step-value').data.value = 0;
  assert.ok(codes(doc).includes('zero-step'));
  doc.nodes.find((n) => n.id === 'step-value').data.value = -1;
  assert.deepEqual(errors(doc), []);
  doc.nodes.find((n) => n.id === 'stop-value').data.valueType = 'float';
  assert.ok(codes(doc).includes('type-mismatch'));
  doc.variables[0].type = 'float';
  assert.ok(codes(doc).includes('for-variable-type'));
});

test('nested For cannot reuse an iterator; sequential For can', () => {
  const doc = loopGraph();
  node(doc, 'inner', 'forRange', { variableId: 'i' });
  for (const handle of ['start', 'stop', 'step']) edge(doc, handle + '-value', 'value', 'inner', handle);
  const link = edge(doc, 'loop', 'body', 'inner', 'in');
  assert.ok(codes(doc).includes('nested-for-variable'));
  link.sourceHandle = 'next';
  assert.deepEqual(errors(doc), []);
  link.sourceHandle = 'body';
  doc.variables.push({ id: 'j', name: 'other_index', type: 'int', initialValue: 0 });
  doc.nodes.find((n) => n.id === 'inner').data.variableId = 'j';
  assert.deepEqual(errors(doc), []);
});

test('unused nodes warn without missing-input errors but bad wires still error', () => {
  const doc = createGeometryDocument();
  node(doc, 'unused', 'binary');
  assert.deepEqual(errors(doc), []);
  assert.ok(validateGeometryDocument(doc).some((d) => d.code === 'unused-node' && d.nodeId === 'unused'));
  edge(doc, 'unused', 'nonexistent', 'unused', 'a');
  assert.ok(codes(doc).includes('missing-port'));
});

test('variables reject reserved/duplicate names; renaming preserves references', () => {
  const doc = printing();
  doc.variables.push({ id: 'v', name: 'value', type: 'int', initialValue: 1 });
  doc.nodes[1].type = 'getVariable'; doc.nodes[1].data = { variableId: 'v' };
  for (const name of ['if', 'False', 'func', 'await', 'abstract', 'main', 'print', 'range', 'float', 'Vector2', 'Array', 'PackedVector4Array', '_gcn_index', '1bad', 'a b', '']) {
    doc.variables[0].name = name;
    assert.ok(codes(doc).includes('invalid-variable-name'), name);
    assert.ok(parseGeometryDocument(serializeGeometryDocument(doc)).document);
  }
  doc.variables[0].name = 'renamed_value';
  assert.deepEqual(errors(doc), []);
  assert.equal(doc.nodes[1].data.variableId, 'v');
  doc.variables.push({ id: 'v2', name: 'renamed_value', type: 'int', initialValue: 2 });
  assert.ok(codes(doc).includes('duplicate-variable-name'));
  doc.variables = [];
  assert.ok(codes(doc).includes('missing-variable'));
});

test('public operations do not mutate input or shared ports', () => {
  const doc = loopGraph();
  const before = structuredClone(doc);
  function freeze(value) {
    Object.freeze(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  }
  freeze(doc);
  assert.deepEqual(errors(doc), []);
  serializeGeometryDocument(doc);
  getNodePorts(doc.nodes[0])[0].id = 'changed';
  assert.equal(getNodePorts(doc.nodes[0])[0].id, 'next');
  assert.deepEqual(doc, before);
});

test('long chains validate without exhausting the JavaScript call stack', () => {
  const doc = createGeometryDocument();
  node(doc, 'value', 'literal');
  let previous = 'start';
  for (let i = 0; i < 6000; i++) {
    const id = `print-${i}`;
    node(doc, id, 'print'); edge(doc, previous, 'next', id, 'in'); edge(doc, 'value', 'value', id, 'value');
    previous = id;
  }
  assert.deepEqual(errors(doc), []);
});

test('loop control (break/continue) must be inside a loop body', () => {
  const doc = createGeometryDocument();
  node(doc, 'brk', 'break');
  edge(doc, 'start', 'next', 'brk', 'in');
  assert.ok(codes(doc).includes('loop-control-outside-loop'));

  const docCont = createGeometryDocument();
  node(docCont, 'cnt', 'continue');
  edge(docCont, 'start', 'next', 'cnt', 'in');
  assert.ok(codes(docCont).includes('loop-control-outside-loop'));

  // Break under If under While -> no error
  const docNested = createGeometryDocument();
  node(docNested, 'cond', 'literal', { valueType: 'bool', value: true });
  node(docNested, 'loop', 'while');
  edge(docNested, 'start', 'next', 'loop', 'in');
  edge(docNested, 'cond', 'value', 'loop', 'condition');

  node(docNested, 'ifNode', 'if');
  edge(docNested, 'loop', 'body', 'ifNode', 'in');
  edge(docNested, 'cond', 'value', 'ifNode', 'condition');

  node(docNested, 'brkInner', 'break');
  edge(docNested, 'ifNode', 'then', 'brkInner', 'in');
  assert.deepEqual(errors(docNested), []);
});

test('input node can only be wired to a single input port', () => {
  const doc = createGeometryDocument();
  node(doc, 'inp', 'input', { prompt: 'Name: ' });
  node(doc, 'p1', 'print');
  edge(doc, 'start', 'next', 'p1', 'in');
  edge(doc, 'inp', 'value', 'p1', 'value');
  assert.deepEqual(errors(doc), []);

  // Wiring inp to a second consumer causes input-reused
  node(doc, 'p2', 'print');
  edge(doc, 'p1', 'next', 'p2', 'in');
  edge(doc, 'inp', 'value', 'p2', 'value');
  assert.ok(codes(doc).includes('input-reused'));
});

test('forEach validates variable, nesting, and missing variable', () => {
  const doc = createGeometryDocument();
  doc.variables.push({ id: 'item', name: 'item', type: 'int', initialValue: 0 });
  node(doc, 'loop', 'forEach', { variableId: 'item' });
  edge(doc, 'start', 'next', 'loop', 'in');
  node(doc, 'list', 'list', { itemCount: 0 });
  edge(doc, 'list', 'value', 'loop', 'items');
  assert.deepEqual(errors(doc), []);

  // Missing variable
  doc.nodes.find((n) => n.id === 'loop').data.variableId = '';
  assert.ok(codes(doc).includes('missing-variable'));

  // Non-existent variable
  doc.nodes.find((n) => n.id === 'loop').data.variableId = 'nonexistent';
  assert.ok(codes(doc).includes('missing-variable'));

  // Nested with same variable
  doc.nodes.find((n) => n.id === 'loop').data.variableId = 'item';
  node(doc, 'inner', 'forEach', { variableId: 'item' });
  edge(doc, 'list', 'value', 'inner', 'items');
  edge(doc, 'loop', 'body', 'inner', 'in');
  assert.ok(codes(doc).includes('nested-for-variable'));

  // Nested with different variable -> OK
  doc.variables.push({ id: 'item2', name: 'item2', type: 'int', initialValue: 0 });
  doc.nodes.find((n) => n.id === 'inner').data.variableId = 'item2';
  assert.deepEqual(errors(doc), []);
});

