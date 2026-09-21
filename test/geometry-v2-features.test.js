import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeometryDocument,
  createChildGraph,
  validateGeometryDocument
} from '../src/core/geometry.js';
import {
  addFunctionParameter,
  updateFunctionParameter,
  removeFunctionParameter,
  getGraphAtScope,
  updateGraphAtScope,
  setViewportAtScope,
  createEditorState,
  applyEdit,
  undo,
  redo
} from '../src/core/geometry-editor.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

test('function signature editing: add, rename, and remove parameters as undoable transactions', () => {
  let doc = createGeometryDocument('python', 2);
  const child = createChildGraph();
  doc.nodes.push({
    id: 'fn1',
    type: 'functionDef',
    position: { x: 100, y: 100 },
    data: { name: 'greet', parameters: [], returnType: 'string', graph: child }
  });
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'fn1', targetHandle: 'in' });

  let state = createEditorState(doc);

  // Add parameter 'name'
  const r1 = addFunctionParameter(state.present, 'fn1', { name: 'name', type: 'string' });
  assert.ok(r1);
  state = applyEdit(state, r1.doc);
  const p1Id = state.present.nodes.find((n) => n.id === 'fn1').data.parameters[0].id;
  assert.ok(p1Id);

  // Add parameter node in child graph
  let currentChild = getGraphAtScope(state.present, ['fn1']);
  currentChild.nodes.push({
    id: 'param_node',
    type: 'parameter',
    position: { x: 50, y: 50 },
    data: { parameterId: p1Id, name: 'name', paramType: 'string' }
  });
  state = applyEdit(state, updateGraphAtScope(state.present, ['fn1'], () => currentChild));

  // Rename parameter to 'user_name'
  const r2 = updateFunctionParameter(state.present, 'fn1', p1Id, { name: 'user_name' });
  state = applyEdit(state, r2.doc);

  const updatedFn = state.present.nodes.find((n) => n.id === 'fn1');
  assert.equal(updatedFn.data.parameters[0].name, 'user_name');
  // Child graph parameter node was automatically updated
  const updatedParamNode = updatedFn.data.graph.nodes.find((n) => n.id === 'param_node');
  assert.equal(updatedParamNode.data.name, 'user_name');

  // Remove parameter in one transaction
  const r3 = removeFunctionParameter(state.present, 'fn1', p1Id);
  state = applyEdit(state, r3.doc);
  const afterDeleteFn = state.present.nodes.find((n) => n.id === 'fn1');
  assert.equal(afterDeleteFn.data.parameters.length, 0);
  assert.equal(afterDeleteFn.data.graph.nodes.some((n) => n.id === 'param_node'), false);

  // Undo restores parameter and child node
  state = undo(state);
  const restoredFn = state.present.nodes.find((n) => n.id === 'fn1');
  assert.equal(restoredFn.data.parameters.length, 1);
  assert.equal(restoredFn.data.graph.nodes.some((n) => n.id === 'param_node'), true);

  // Redo removes it again
  state = redo(state);
  const redoFn = state.present.nodes.find((n) => n.id === 'fn1');
  assert.equal(redoFn.data.parameters.length, 0);
});

test('class definition with inheritance, constructor and methods generates correct Python and GDScript', () => {
  const doc = createGeometryDocument('python', 2);

  // Create class child graph
  const classGraph = createChildGraph();

  // Add constructor
  const initMethod = {
    id: 'm_init',
    type: 'functionDef',
    position: { x: 50, y: 50 },
    data: {
      name: '__init__',
      parameters: [{ id: 'p_hp', name: 'hp', type: 'int', defaultValue: '100' }],
      returnType: 'void',
      graph: createChildGraph()
    }
  };

  // Add method
  const moveMethod = {
    id: 'm_move',
    type: 'functionDef',
    position: { x: 50, y: 200 },
    data: {
      name: 'move',
      parameters: [{ id: 'p_dx', name: 'dx', type: 'int' }, { id: 'p_dy', name: 'dy', type: 'int' }],
      returnType: 'void',
      graph: createChildGraph()
    }
  };

  classGraph.nodes.push(initMethod, moveMethod);

  doc.nodes.push({
    id: 'cls1',
    type: 'classDef',
    position: { x: 100, y: 100 },
    data: {
      name: 'Player',
      baseClass: 'Character',
      decorators: [],
      graph: classGraph
    }
  });

  // Generate Python
  const py = generateGeometryCode(doc, 'python');
  assert.ok(py.code.includes('class Player(Character):'));
  assert.ok(py.code.includes('def __init__(self, hp: int = 100):'));
  assert.ok(py.code.includes('def move(self, dx: int, dy: int):'));
  assert.ok(py.sourceMap.length > 0);
  assert.ok(py.sourceMap.some((m) => m.nodeId === 'cls1'));

  // Generate GDScript
  const gd = generateGeometryCode(doc, 'gdscript');
  assert.ok(gd.code.includes('class Player extends Character:'));
  assert.ok(gd.code.includes('func __init__(hp: int = 100):') || gd.code.includes('func _init'));
});

test('import and symbol references generate clean code without fake GDScript imports', () => {
  const pyDoc = createGeometryDocument('python', 2);
  pyDoc.nodes.push(
    {
      id: 'imp1',
      type: 'import',
      position: { x: 50, y: 50 },
      data: { importType: 'module', module: 'math', names: [{ name: 'math', alias: 'm' }] }
    },
    {
      id: 'imp2',
      type: 'import',
      position: { x: 50, y: 150 },
      data: { importType: 'from', module: 'os.path', names: [{ name: 'join', alias: '' }] }
    },
    {
      id: 'imp3',
      type: 'import',
      position: { x: 50, y: 250 },
      data: { importType: 'from', module: 'helpers', level: 1, names: [{ name: 'util', alias: '' }] }
    }
  );

  const pyResult = generateGeometryCode(pyDoc, 'python');
  assert.ok(pyResult.code.includes('import math as m'));
  assert.ok(pyResult.code.includes('from os.path import join'));
  assert.ok(pyResult.code.includes('from .helpers import util'));

  // GDScript imports
  const gdDoc = createGeometryDocument('gdscript', 2);
  gdDoc.nodes.push(
    {
      id: 'gd_ext',
      type: 'import',
      position: { x: 50, y: 50 },
      data: { importType: 'gd_extends', module: 'CharacterBody2D', names: [] }
    },
    {
      id: 'gd_cls',
      type: 'import',
      position: { x: 50, y: 150 },
      data: { importType: 'gd_class_name', module: 'Hero', names: [] }
    },
    {
      id: 'gd_pre',
      type: 'import',
      position: { x: 50, y: 250 },
      data: { importType: 'gd_preload', module: 'res://bullet.tscn', names: [{ name: 'BulletScene' }] }
    }
  );

  const gdResult = generateGeometryCode(gdDoc, 'gdscript');
  assert.ok(gdResult.code.includes('extends CharacterBody2D'));
  assert.ok(gdResult.code.includes('class_name Hero'));
  assert.ok(gdResult.code.includes('const BulletScene = preload("res://bullet.tscn")'));
  // GDScript must NOT contain "from" or "import" statements
  for (const line of gdResult.code.split('\n')) {
    assert.ok(!line.trim().startsWith('import '));
    assert.ok(!line.trim().startsWith('from '));
  }
});

test('source map maps generated line numbers back to node IDs and scope paths', () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push(
    { id: 'lit_val', type: 'literal', position: { x: 100, y: 50 }, data: { valueType: 'int', value: 99 } },
    { id: 'p_node', type: 'print', position: { x: 250, y: 0 }, data: {} }
  );
  doc.edges.push(
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'p_node', targetHandle: 'in' },
    { id: 'e2', source: 'lit_val', sourceHandle: 'value', target: 'p_node', targetHandle: 'value' }
  );

  const res = generateGeometryCode(doc, 'python');
  assert.ok(res.sourceMap.length > 0);
  const printMapping = res.sourceMap.find((m) => m.nodeId === 'p_node');
  assert.ok(printMapping);
  assert.ok(printMapping.line > 0);
  const lineContent = res.code.split('\n')[printMapping.line - 1];
  assert.ok(lineContent.includes('print(99)'));
});
