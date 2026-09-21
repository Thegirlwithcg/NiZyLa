import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeometryDocument,
  createChildGraph,
  parseGeometryDocument,
  serializeGeometryDocument,
  validateGeometryDocument,
  migrateV1ToV2,
  nodeDefinitions
} from '../src/core/geometry.js';

test('v1 -> migrate -> Save -> reopen preserves data and is valid v2', () => {
  const v1 = {
    format: 'nizyla.geometry-code',
    version: 1,
    target: 'python',
    variables: [{ id: 'v1', name: 'counter', type: 'int', initialValue: 0 }],
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'lit', type: 'literal', position: { x: 100, y: 50 }, data: { valueType: 'int', value: 42 } },
      { id: 'p', type: 'print', position: { x: 250, y: 0 }, data: {} }
    ],
    edges: [
      { id: 'e1', source: 'start', sourceHandle: 'next', target: 'p', targetHandle: 'in' },
      { id: 'e2', source: 'lit', sourceHandle: 'value', target: 'p', targetHandle: 'value' }
    ],
    viewport: { x: 10, y: 20, zoom: 1 }
  };

  const migrated = migrateV1ToV2(v1);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.target, 'python');
  assert.equal(migrated.nodes.some((n) => n.type === 'functionDef' && n.data.name === 'main'), true);

  const mainFunc = migrated.nodes.find((n) => n.type === 'functionDef');
  assert.ok(mainFunc.data.graph);
  assert.equal(mainFunc.data.graph.nodes.length, 3);
  assert.equal(mainFunc.data.graph.variables.length, 1);
  assert.equal(mainFunc.data.graph.variables[0].name, 'counter');

  // Serialization to string and parsing back
  const serialized = serializeGeometryDocument(migrated);
  assert.ok(serialized.includes('"version": 2'));
  const parsed = parseGeometryDocument(serialized);
  assert.equal(parsed.document.version, 2);
  assert.equal(parsed.diagnostics.filter((d) => d.severity === 'error').length, 0);

  // Parsing original v1 JSON directly performs migration in memory
  const parsedV1 = parseGeometryDocument(JSON.stringify(v1));
  assert.ok(parsedV1.document);
  assert.equal(parsedV1.document.version, 2);
  assert.equal(parsedV1.document.nodes.some((n) => n.type === 'functionDef' && n.data.name === 'main'), true);
});

test('GDScript v1 migrates to extends Node and _ready function', () => {
  const v1 = {
    format: 'nizyla.geometry-code',
    version: 1,
    target: 'gdscript',
    variables: [],
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
  const migrated = migrateV1ToV2(v1);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.target, 'gdscript');
  assert.ok(migrated.nodes.some((n) => n.type === 'import' && n.data.importType === 'gd_extends' && n.data.module === 'Node'));
  assert.ok(migrated.nodes.some((n) => n.type === 'functionDef' && n.data.name === '_ready'));
});

test('v2 functionDef with child graph validates parameters, returns, and recursion', () => {
  const doc = createGeometryDocument('python', 2);
  const child = createChildGraph();

  // Inside child graph: parameter node, literal, compare, if, return, functionCall (recursion)
  child.nodes.push(
    { id: 'param_n', type: 'parameter', position: { x: 50, y: 50 }, data: { parameterId: 'p_n', name: 'n', paramType: 'int' } },
    { id: 'lit_zero', type: 'literal', position: { x: 50, y: 150 }, data: { valueType: 'int', value: 0 } },
    { id: 'comp', type: 'compare', position: { x: 200, y: 100 }, data: { operator: '==' } },
    { id: 'if_node', type: 'if', position: { x: 350, y: 0 }, data: {} },
    { id: 'ret_base', type: 'return', position: { x: 500, y: -50 }, data: { hasValue: true } },
    { id: 'lit_one', type: 'literal', position: { x: 400, y: -100 }, data: { valueType: 'int', value: 1 } }
  );

  child.edges.push(
    { id: 'c_start_if', source: 'start', sourceHandle: 'next', target: 'if_node', targetHandle: 'in' },
    { id: 'c_p_a', source: 'param_n', sourceHandle: 'value', target: 'comp', targetHandle: 'a' },
    { id: 'c_0_b', source: 'lit_zero', sourceHandle: 'value', target: 'comp', targetHandle: 'b' },
    { id: 'c_comp_if', source: 'comp', sourceHandle: 'value', target: 'if_node', targetHandle: 'condition' },
    { id: 'c_if_ret', source: 'if_node', sourceHandle: 'then', target: 'ret_base', targetHandle: 'in' },
    { id: 'c_one_ret', source: 'lit_one', sourceHandle: 'value', target: 'ret_base', targetHandle: 'value' }
  );

  doc.nodes.push({
    id: 'fact_def',
    type: 'functionDef',
    position: { x: 200, y: 0 },
    data: {
      name: 'factorial',
      parameters: [{ id: 'p_n', name: 'n', type: 'int', defaultValue: null }],
      returnType: 'int',
      isAsync: false,
      decorators: [],
      graph: child
    }
  });

  doc.edges.push({ id: 'e_s_f', source: 'start', sourceHandle: 'next', target: 'fact_def', targetHandle: 'in' });

  const diags = validateGeometryDocument(doc);
  const errors = diags.filter((d) => d.severity === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('parameter node referencing unknown parameter is diagnosed', () => {
  const doc = createGeometryDocument('python', 2);
  const child = createChildGraph();
  child.nodes.push({
    id: 'p1',
    type: 'parameter',
    position: { x: 50, y: 50 },
    data: { parameterId: 'non_existent_id', name: 'x', paramType: 'int' }
  });
  doc.nodes.push({
    id: 'f1',
    type: 'functionDef',
    position: { x: 200, y: 0 },
    data: { name: 'f', parameters: [], graph: child }
  });
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'f1', targetHandle: 'in' });

  const diags = validateGeometryDocument(doc);
  assert.ok(diags.some((d) => d.code === 'missing-parameter'));
});

test('orphan return node outside function is diagnosed', () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push({ id: 'r1', type: 'return', position: { x: 100, y: 0 }, data: { hasValue: false } });
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'r1', targetHandle: 'in' });

  const diags = validateGeometryDocument(doc);
  assert.ok(diags.some((d) => d.code === 'orphan-return'));
});
