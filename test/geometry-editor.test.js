import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryDocument, serializeGeometryDocument, validateGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import {
  HISTORY_LIMIT, addEdge, addNode, addVariable, applyEdit, checkConnection, computePorts, createEditorState, deleteVariable, duplicateNodes,
  endEdit, moveNodes, positionsFromFlow, redo, removeItems, sameContent, setLiteralType, setNodeData, setTarget,
  setViewport, undo, updateVariable, variableUsage
} from '../src/core/geometry-editor.js';

const freeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(freeze);
  return Object.freeze(value);
};
const add = (doc, preset, x = 0, y = 0) => addNode(doc, preset, { x, y });
const wire = (doc, source, sourceHandle, target, targetHandle) => {
  const result = addEdge(doc, { source, sourceHandle, target, targetHandle });
  assert.ok(result.doc, result.error);
  return result.doc;
};
const codes = (doc) => validateGeometryDocument(doc).map((d) => d.code);

test('adding and deleting nodes leaves no dangling edges; Start is protected', () => {
  let doc = createGeometryDocument();
  const a = add(doc, 'int'); doc = a.doc;
  const p = add(doc, 'print'); doc = p.doc;
  doc = wire(doc, a.nodeId, 'value', p.nodeId, 'value');
  doc = wire(doc, 'start', 'next', p.nodeId, 'in');
  assert.equal(doc.edges.length, 2);
  assert.equal(removeItems(doc, { nodeIds: ['start'] }), null);
  const after = removeItems(doc, { nodeIds: [a.nodeId] });
  assert.deepEqual(after.edges.map((e) => e.source), ['start']);
  assert.equal(removeItems(after, { nodeIds: ['start'] }), null);
  assert.equal(removeItems(after, { edgeIds: [after.edges[0].id] }).edges.length, 0);
  assert.equal(add(doc, 'start'), null);
});

test('And -> Not removes the b wire, one Undo restores operator and wire', () => {
  let doc = createGeometryDocument();
  const t = add(doc, 'bool'); doc = t.doc;
  const gate = add(doc, 'and'); doc = gate.doc;
  doc = wire(doc, t.nodeId, 'value', gate.nodeId, 'a');
  doc = wire(doc, t.nodeId, 'value', gate.nodeId, 'b');
  let state = createEditorState(doc);
  const changed = setNodeData(doc, gate.nodeId, { operator: 'not' });
  assert.equal(changed.removedEdges.length, 1);
  assert.equal(changed.removedEdges[0].targetHandle, 'b');
  state = applyEdit(state, changed.doc);
  assert.equal(state.present.edges.length, 1);
  state = undo(state);
  assert.equal(state.present.edges.length, 2);
  assert.equal(state.present.nodes.find((n) => n.id === gate.nodeId).data.operator, 'and');
});

test('one drag is one Undo entry, however many live moves', () => {
  let doc = createGeometryDocument();
  const n = add(doc, 'print', 10, 10); doc = n.doc;
  let state = createEditorState(doc);
  for (let x = 11; x <= 60; x++) state = applyEdit(state, moveNodes(state.present, { [n.nodeId]: { x, y: 10 } }), true);
  assert.equal(state.past.length, 0);
  state = endEdit(state);
  assert.equal(state.past.length, 1);
  state = undo(state);
  assert.deepEqual(state.present.nodes.find((x) => x.id === n.nodeId).position, { x: 10, y: 10 });
  state = redo(state);
  assert.equal(state.present.nodes.find((x) => x.id === n.nodeId).position.x, 60);
});

test('no-op edits create no history entry, including a drag that ends where it began', () => {
  const doc = createGeometryDocument();
  let state = createEditorState(doc);
  assert.equal(applyEdit(state, { ...doc }), state);
  assert.equal(moveNodes(doc, { start: { x: 0, y: 0 } }), null);
  assert.equal(setTarget(doc, 'python'), null);
  const moved = applyEdit(state, moveNodes(doc, { start: { x: 5, y: 5 } }), true);
  state = endEdit(applyEdit(moved, moveNodes(moved.present, { start: { x: 0, y: 0 } }), true));
  assert.equal(state.past.length, 0);
  assert.equal(removeItems(doc, { edgeIds: ['nope'] }), null);
});

test('a new edit after Undo clears Redo; history is capped at 100', () => {
  let state = createEditorState(createGeometryDocument());
  state = applyEdit(state, add(state.present, 'int').doc);
  state = undo(state);
  assert.equal(state.future.length, 1);
  state = applyEdit(state, add(state.present, 'float').doc);
  assert.equal(state.future.length, 0);
  assert.equal(redo(state), state);
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) state = applyEdit(state, add(state.present, 'int', i).doc);
  assert.equal(state.past.length, HISTORY_LIMIT);
});

test('viewport changes never enter history and Undo/Redo keep the current viewport', () => {
  let state = createEditorState(createGeometryDocument());
  state = applyEdit(state, add(state.present, 'int').doc);
  state = setViewport(state, { x: 40, y: -20, zoom: 2 });
  assert.equal(state.past.length, 1);
  assert.equal(setViewport(state, { x: 40, y: -20, zoom: 2 }), state);
  const nodesRef = state.present.nodes;
  assert.equal(setViewport(state, { x: 1, y: 1, zoom: 1 }).present.nodes, nodesRef);
  state = undo(state);
  assert.deepEqual(state.present.viewport, { x: 40, y: -20, zoom: 2 });
  state = redo(state);
  assert.deepEqual(state.present.viewport, { x: 40, y: -20, zoom: 2 });
  assert.ok(sameContent(state.present, { ...state.present, viewport: { x: 0, y: 0, zoom: 1 } }));
});

test('grouped live edits (typing) are one transaction and Undo returns to the start', () => {
  let doc = createGeometryDocument();
  const n = add(doc, 'int'); doc = n.doc;
  let state = createEditorState(doc);
  for (const value of [1, 12, 123]) state = applyEdit(state, setNodeData(state.present, n.nodeId, { value }).doc, true);
  state = endEdit(state);
  assert.equal(state.past.length, 1);
  state = undo(state);
  assert.equal(state.present.nodes.at(-1).data.value, 0);
  assert.ok(sameContent(state.present, doc), 'back at the initial content means not changed');
});

test('renaming a variable keeps its ID and references', () => {
  let doc = createGeometryDocument();
  const v = addVariable(doc); doc = v.doc;
  assert.equal(doc.variables[0].name, 'value1');
  assert.equal(addVariable(doc).doc.variables[1].name, 'value2');
  const get = add(doc, 'get'); doc = get.doc;
  assert.equal(doc.nodes.at(-1).data.variableId, v.variableId);
  doc = updateVariable(doc, v.variableId, { name: 'total' });
  assert.equal(doc.variables[0].id, v.variableId);
  assert.equal(variableUsage(doc, v.variableId), 1);
  assert.deepEqual(codes(doc).filter((c) => c === 'missing-variable'), []);
});

test('changing a variable type resets its initial value; deleting keeps references and Undo restores all', () => {
  let doc = createGeometryDocument();
  const v = addVariable(doc); doc = v.doc;
  doc = updateVariable(doc, v.variableId, { initialValue: 7 });
  doc = updateVariable(doc, v.variableId, { type: 'string' });
  assert.deepEqual([doc.variables[0].type, doc.variables[0].initialValue], ['string', '']);
  assert.equal(updateVariable(doc, 'missing', { name: 'x' }), null);
  doc = add(doc, 'set').doc;
  let state = applyEdit(createEditorState(doc), deleteVariable(doc, v.variableId));
  assert.equal(state.present.nodes.at(-1).data.variableId, v.variableId, 'reference kept');
  assert.ok(codes(state.present).includes('missing-variable'));
  state = undo(state);
  assert.equal(state.present.variables.length, 1);
  assert.ok(!codes(state.present).includes('missing-variable'));
});

test('For Range preset picks an int variable; literal type change picks a valid value', () => {
  let doc = addVariable(createGeometryDocument()).doc;
  doc = updateVariable(doc, doc.variables[0].id, { type: 'string' });
  assert.equal(add(doc, 'for').doc.nodes.at(-1).data.variableId, '');
  const lit = add(doc, 'float'); doc = lit.doc;
  doc = setNodeData(doc, lit.nodeId, { value: 2.5 }).doc;
  assert.equal(setLiteralType(doc, lit.nodeId, 'int').doc.nodes.at(-1).data.value, 0);
  assert.equal(setLiteralType(doc, lit.nodeId, 'string').doc.nodes.at(-1).data.value, '');
  const int = add(doc, 'int'); doc = setNodeData(int.doc, int.nodeId, { value: 4 }).doc;
  assert.equal(setLiteralType(doc, int.nodeId, 'float').doc.nodes.at(-1).data.value, 4);
});

test('a candidate connection is allowed while the graph is still incomplete', () => {
  let doc = createGeometryDocument();
  const p = add(doc, 'print'); doc = p.doc;
  assert.ok(codes(doc).includes('unused-node'));
  // Start -> Print makes Print reachable with a missing value input: that must not block the wire.
  const result = addEdge(doc, { source: 'start', sourceHandle: 'next', target: p.nodeId, targetHandle: 'in' });
  assert.ok(result.doc);
  assert.ok(codes(result.doc).includes('missing-input'));
  // An unfinished Add feeding Print (unknown output type) is also fine.
  const sum = add(result.doc, 'add');
  assert.ok(addEdge(sum.doc, { source: sum.nodeId, sourceHandle: 'value', target: p.nodeId, targetHandle: 'value' }).doc);
});

test('wrong connections are rejected with a message and never replace an existing wire', () => {
  let doc = createGeometryDocument();
  const a = add(doc, 'int'); doc = a.doc;
  const b = add(doc, 'int'); doc = b.doc;
  const p = add(doc, 'print'); doc = p.doc;
  const iff = add(doc, 'if'); doc = iff.doc;
  const text = add(doc, 'string'); doc = text.doc;
  doc = wire(doc, a.nodeId, 'value', p.nodeId, 'value');
  doc = wire(doc, 'start', 'next', p.nodeId, 'in');
  const reject = (c, pattern) => {
    const r = checkConnection(doc, c);
    assert.equal(r.ok, false);
    assert.match(r.message, pattern);
    assert.equal(addEdge(doc, c).error, r.message);
  };
  reject({ source: b.nodeId, sourceHandle: 'value', target: p.nodeId, targetHandle: 'value' }, /already has a wire/);
  reject({ source: 'start', sourceHandle: 'next', target: iff.nodeId, targetHandle: 'in' }, /Execution output already/);
  reject({ source: a.nodeId, sourceHandle: 'value', target: iff.nodeId, targetHandle: 'in' }, /cannot connect/);
  reject({ source: p.nodeId, sourceHandle: 'in', target: iff.nodeId, targetHandle: 'in' }, /output to an input/);
  reject({ source: a.nodeId, sourceHandle: 'value', target: iff.nodeId, targetHandle: 'condition' }, /expects bool/);
  reject({ source: a.nodeId, sourceHandle: 'nope', target: iff.nodeId, targetHandle: 'condition' }, /Unknown port/);
  assert.equal(doc.edges.length, 2, 'existing wires untouched');
  const sum = add(doc, 'add'); doc = sum.doc;
  const wrong = checkConnection(doc, { source: text.nodeId, sourceHandle: 'value', target: sum.nodeId, targetHandle: 'a' });
  assert.equal(wrong.ok, false);
});

test('execution and value cycles are rejected', () => {
  let doc = createGeometryDocument();
  const p1 = add(doc, 'print'); doc = p1.doc;
  const p2 = add(doc, 'print'); doc = p2.doc;
  doc = wire(doc, 'start', 'next', p1.nodeId, 'in');
  doc = wire(doc, p1.nodeId, 'next', p2.nodeId, 'in');
  assert.match(checkConnection(doc, { source: p2.nodeId, sourceHandle: 'next', target: p1.nodeId, targetHandle: 'in' }).message, /already has a wire/);
  const loop = add(doc, 'if'); doc = loop.doc;
  doc = wire(doc, p2.nodeId, 'next', loop.nodeId, 'in');
  assert.equal(checkConnection(doc, { source: loop.nodeId, sourceHandle: 'then', target: 'start', targetHandle: 'in' }).ok, false);

  const x = add(doc, 'add'); doc = x.doc;
  const y = add(doc, 'add'); doc = y.doc;
  doc = wire(doc, x.nodeId, 'value', y.nodeId, 'a');
  const cycle = checkConnection(doc, { source: y.nodeId, sourceHandle: 'value', target: x.nodeId, targetHandle: 'a' });
  assert.equal(cycle.ok, false);
  assert.match(cycle.message, /cycle/);
  assert.equal(checkConnection(doc, { source: x.nodeId, sourceHandle: 'value', target: x.nodeId, targetHandle: 'b' }).ok, false);
});

test('pre-existing errors do not block an unrelated valid connection', () => {
  let doc = createGeometryDocument();
  doc = addVariable(doc).doc;
  const bad = add(doc, 'get'); doc = bad.doc;
  doc = deleteVariable(doc, doc.variables[0].id);
  assert.ok(codes(doc).includes('missing-variable'));
  const p = add(doc, 'print'); doc = p.doc;
  assert.ok(checkConnection(doc, { source: 'start', sourceHandle: 'next', target: p.nodeId, targetHandle: 'in' }).ok);
});

test('changing a variable type keeps a now-mismatching wire and reports it', () => {
  let doc = createGeometryDocument();
  const v = addVariable(doc); doc = v.doc;
  doc = updateVariable(doc, v.variableId, { type: 'bool' });
  const get = add(doc, 'get'); doc = get.doc;
  const gate = add(doc, 'not'); doc = gate.doc;
  doc = wire(doc, get.nodeId, 'value', gate.nodeId, 'a');
  assert.ok(!codes(doc).includes('type-mismatch'));
  doc = updateVariable(doc, v.variableId, { type: 'string' });
  assert.equal(doc.edges.length, 1);
  assert.ok(codes(doc).includes('type-mismatch'));
});

test('flow positions map back without transient fields; input documents are never mutated', () => {
  const doc = freeze(createGeometryDocument());
  const n = add(doc, 'int');
  const flow = [{ id: 'start', type: 'geometry', position: { x: 3, y: 4 }, selected: true, dragging: true, measured: { width: 9, height: 9 }, data: { fn() {} } }];
  const moved = moveNodes(n.doc, positionsFromFlow(flow));
  assert.deepEqual(moved.nodes[0], { id: 'start', type: 'start', position: { x: 3, y: 4 }, data: {} });
  const text = serializeGeometryDocument(moved);
  assert.deepEqual(JSON.parse(text).nodes[0], moved.nodes[0]);
  for (const op of [
    () => removeItems(n.doc, { nodeIds: [n.nodeId] }),
    () => setNodeData(n.doc, n.nodeId, { value: 5 }),
    () => setLiteralType(n.doc, n.nodeId, 'bool'),
    () => addVariable(doc), () => setTarget(doc, 'gdscript'),
    () => updateVariable(addVariable(doc).doc, 'x', {}), () => moveNodes(doc, { start: { x: 1, y: 1 } })
  ]) op();
  assert.deepEqual(doc, createGeometryDocument());
});

test('graph built through the editor ops generates the expected code (5 / 2 -> Print)', () => {
  let doc = createGeometryDocument();
  const five = add(doc, 'int'); doc = setNodeData(five.doc, five.nodeId, { value: 5 }).doc;
  const two = add(doc, 'int'); doc = setNodeData(two.doc, two.nodeId, { value: 2 }).doc;
  const div = add(doc, 'divide'); doc = div.doc;
  const p = add(doc, 'print'); doc = p.doc;
  doc = wire(doc, five.nodeId, 'value', div.nodeId, 'a');
  doc = wire(doc, two.nodeId, 'value', div.nodeId, 'b');
  doc = wire(doc, div.nodeId, 'value', p.nodeId, 'value');
  doc = wire(doc, 'start', 'next', p.nodeId, 'in');
  assert.match(generateGeometryCode(doc, 'python').code, /print\(\(5 \/ 2\)\)/);
  assert.match(generateGeometryCode(doc, 'gdscript').code, /print\(\(float\(5\) \/ 2\)\)/);
  const removed = removeItems(doc, { edgeIds: [doc.edges.find((e) => e.targetHandle === 'b').id] });
  assert.equal(generateGeometryCode(removed, 'python').code, null);
});

test('computePorts infers Math chains iteratively: 6000 nodes in reverse order, cycles, and codegen refuses cleanly', () => {
  const n = 6000;
  const nodes = [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'lit', type: 'literal', position: { x: 0, y: 0 }, data: { valueType: 'int', value: 1 } },
    { id: 'print', type: 'print', position: { x: 0, y: 0 }, data: {} }];
  const edges = [{ id: 'e-s', source: 'start', sourceHandle: 'next', target: 'print', targetHandle: 'in' },
    { id: 'e-p', source: `m${n - 1}`, sourceHandle: 'value', target: 'print', targetHandle: 'value' }];
  const chain = [];
  for (let i = 0; i < n; i++) {
    chain.push({ id: `m${i}`, type: 'binary', position: { x: i, y: 0 }, data: { operator: '+' } });
    edges.push({ id: `a${i}`, source: i ? `m${i - 1}` : 'lit', sourceHandle: 'value', target: `m${i}`, targetHandle: 'a' },
      { id: `b${i}`, source: 'lit', sourceHandle: 'value', target: `m${i}`, targetHandle: 'b' });
  }
  const doc = { ...createGeometryDocument(), nodes: [...nodes, ...chain.reverse()], edges };
  const ports = computePorts(doc);
  const out = (id) => ports.get(id).find((p) => p.direction === 'out').valueType;
  assert.equal(out('m0'), 'int');
  assert.equal(out(`m${n - 1}`), 'int');
  const result = generateGeometryCode(doc, 'python');
  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((d) => d.code === 'expression-too-deep'));

  // float somewhere in the chain propagates; a Math cycle does not hang or throw
  const small = { ...createGeometryDocument(), nodes: [
    { id: 'f', type: 'literal', position: { x: 0, y: 0 }, data: { valueType: 'float', value: 1 } },
    { id: 'x', type: 'binary', position: { x: 0, y: 0 }, data: { operator: '+' } },
    { id: 'y', type: 'binary', position: { x: 0, y: 0 }, data: { operator: '*' } }],
  edges: [{ id: '1', source: 'f', sourceHandle: 'value', target: 'x', targetHandle: 'a' },
    { id: '2', source: 'x', sourceHandle: 'value', target: 'y', targetHandle: 'a' },
    { id: '3', source: 'y', sourceHandle: 'value', target: 'x', targetHandle: 'b' }] };
  assert.doesNotThrow(() => computePorts(small));
  assert.equal(computePorts(small).get('x').find((p) => p.direction === 'out').valueType, 'unknown');
});

test('Undo -> live edit -> revert -> end keeps Redo and adds no history; a real change clears Redo', () => {
  const lit = add(createGeometryDocument(), 'int', 5, 5);
  const drag = (state, x) => applyEdit(state, moveNodes(state.present, { [lit.nodeId]: { x, y: 5 } }), true);
  const type = (state, value) => applyEdit(state, setNodeData(state.present, lit.nodeId, { value }).doc, true);
  for (const [name, edit, start, changed] of [['drag', drag, 5, 60], ['typing', type, 0, 9]]) {
    let state = createEditorState(lit.doc);
    state = applyEdit(state, add(state.present, 'print', 200, 0).doc);   // something to undo/redo
    state = undo(state);
    assert.equal(state.future.length, 1, name);
    const past = state.past.length;
    let reverted = endEdit(edit(edit(state, changed), start));            // change then revert to the original
    assert.equal(reverted.past.length, past, `${name}: no history entry`);
    assert.equal(reverted.future.length, 1, `${name}: Redo kept`);
    assert.equal(redo(reverted).present.nodes.length, 3, `${name}: Redo still works`);
    let real = endEdit(edit(state, changed));                             // a real change ends the edit
    assert.equal(real.past.length, past + 1, `${name}: one entry`);
    assert.equal(real.future.length, 0, `${name}: Redo cleared`);
  }
});

test('duplicateNodes copies selected non-start nodes and internal edges, deep cloning data.graph', () => {
  let doc = createGeometryDocument();
  const ext = add(doc, 'print', 10, 20); doc = ext.doc;
  const a = add(doc, 'function', 100, 150); doc = a.doc;
  const b = add(doc, 'print', 300, 150); doc = b.doc;
  doc = wire(doc, ext.nodeId, 'next', a.nodeId, 'in');
  doc = wire(doc, a.nodeId, 'next', b.nodeId, 'in');

  const origSnapshot = structuredClone(doc);
  freeze(doc);

  const result = duplicateNodes(doc, ['start', a.nodeId, b.nodeId]);
  assert.ok(result);
  const { doc: nextDoc, nodeIds: newIds } = result;

  // ได้ node ใหม่ 2 ตัว ตำแหน่งขยับไป +40,+40
  assert.equal(newIds.length, 2);
  const nodeA = doc.nodes.find((n) => n.id === a.nodeId);
  const nodeB = doc.nodes.find((n) => n.id === b.nodeId);
  const newA = nextDoc.nodes.find((n) => n.id === newIds[0]);
  const newB = nextDoc.nodes.find((n) => n.id === newIds[1]);
  assert.ok(newA && newB);
  assert.deepEqual(newA.position, { x: nodeA.position.x + 40, y: nodeA.position.y + 40 });
  assert.deepEqual(newB.position, { x: nodeB.position.x + 40, y: nodeB.position.y + 40 });

  // ได้ edge ใหม่ A'→B' 1 เส้น และไม่มี edge จากข้างนอกเข้า A'
  const newEdges = nextDoc.edges.filter((e) => !doc.edges.some((orig) => orig.id === e.id));
  assert.equal(newEdges.length, 1);
  assert.equal(newEdges[0].source, newA.id);
  assert.equal(newEdges[0].target, newB.id);
  assert.equal(newEdges[0].sourceHandle, 'next');
  assert.equal(newEdges[0].targetHandle, 'in');
  assert.equal(nextDoc.edges.some((e) => e.target === newA.id), false);

  // id ใหม่ทั้งหมดไม่ซ้ำ
  const allIds = nextDoc.nodes.map((n) => n.id);
  assert.equal(new Set(allIds).size, allIds.length);
  const allEdgeIds = nextDoc.edges.map((e) => e.id);
  assert.equal(new Set(allEdgeIds).size, allEdgeIds.length);

  // graph เดิมไม่เปลี่ยน
  assert.deepEqual(doc, origSnapshot);

  // แก้ data.graph ของ functionDef ตัวที่คัดลอกแล้ว ตัวต้นฉบับต้องไม่เปลี่ยนตาม
  assert.ok(newA.data?.graph);
  newA.data.graph.nodes.push({ id: 'child_in_new', type: 'start', position: { x: 0, y: 0 }, data: {} });
  assert.equal(nodeA.data.graph.nodes.some((n) => n.id === 'child_in_new'), false);
});
