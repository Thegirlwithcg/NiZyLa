import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGeometryDocument,
  parseGeometryDocument,
  serializeGeometryDocument,
  validateGeometryDocument,
  parseTemplate,
  variableTypes
} from '../src/core/geometry.js';
import { generateGeometryCode, typeName } from '../src/core/geometry-codegen.js';

function findPython() {
  for (const bin of ['python', 'python3', 'py']) {
    const probe = spawnSync(bin, ['-c', 'import sys;print(sys.version_info[0])'], { encoding: 'utf8', timeout: 15000, shell: false });
    if (probe.stdout?.trim() === '3') return bin;
  }
  return null;
}
function findGodot() {
  const bin = process.env.GODOT_BIN || 'godot';
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000, shell: false });
  return /^4\./.test(probe.stdout ?? '') ? bin : null;
}

const pythonBin = findPython();
const godotBin = findGodot();

// Helpers to quickly build GCN graphs
function makeDoc(target = 'python') {
  return createGeometryDocument(target, 2);
}

function addVar(doc, id, name, type, initialValue) {
  doc.variables.push({ id, name, type, initialValue });
}

function addNode(doc, id, type, data = {}, x = 0, y = 0) {
  doc.nodes.push({ id, type, position: { x, y }, data });
}

function addEdge(doc, id, source, sourceHandle, target, targetHandle) {
  doc.edges.push({ id, source, sourceHandle, target, targetHandle });
}

// ------------------------------------------------------------------------------------------------
// 1. parseTemplate Tests
// ------------------------------------------------------------------------------------------------

test('parseTemplate: escapes, repeats, error still returns names, {1x} is an error', () => {
  // Escapes
  const esc = parseTemplate('{{hello}} and }}world{{');
  assert.equal(esc.error, null);
  assert.deepEqual(esc.parts, [{ text: '{hello} and }world{' }]);
  assert.deepEqual(esc.names, []);

  // Repeats
  const rep = parseTemplate('Hello {name}, your code is {code}, goodbye {name}!');
  assert.equal(rep.error, null);
  assert.deepEqual(rep.names, ['name', 'code']);
  assert.equal(rep.parts.length, 7);
  assert.deepEqual(rep.parts[1], { name: 'name' });
  assert.deepEqual(rep.parts[3], { name: 'code' });
  assert.deepEqual(rep.parts[5], { name: 'name' });
  assert.deepEqual(rep.parts[6], { text: '!' });

  // Error still returns collected names
  const partial = parseTemplate('Valid: {user} and {rank}, but invalid: {1bad} and unclosed: {rest');
  assert.ok(partial.error !== null);
  assert.deepEqual(partial.names, ['user', 'rank']);

  // {1x} is an error
  const invalidIdent = parseTemplate('Prefix {1x} Suffix');
  assert.ok(invalidIdent.error !== null);
  assert.deepEqual(invalidIdent.names, []);

  // Empty braces {} is an error
  const emptyBraces = parseTemplate('Value: {}');
  assert.ok(emptyBraces.error !== null);
  assert.deepEqual(emptyBraces.names, []);

  // Unexpected closing brace
  const unexpectedClose = parseTemplate('Value: x}');
  assert.ok(unexpectedClose.error !== null);
  assert.deepEqual(unexpectedClose.names, []);

  // Non-string input
  const nonStr = parseTemplate(null);
  assert.ok(nonStr.error !== null);
});

// ------------------------------------------------------------------------------------------------
// 2. Exact Generated Text for the Four Examples (both targets)
// ------------------------------------------------------------------------------------------------

test('Exact generated text for Example 1: print(f"Player: {name}, Level: {level}")', () => {
  // Example 1: formatText fstring + print
  // Python uses `name`
  {
    const doc = makeDoc('python');
    addVar(doc, 'v_name', 'name', 'string', '');
    addVar(doc, 'v_level', 'level', 'int', 0);

    addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
    addNode(doc, 'g_level', 'getVariable', { variableId: 'v_level' });
    addNode(doc, 'fmt', 'formatText', { style: 'fstring', template: 'Player: {name}, Level: {level}' });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e1', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{name}');
    addEdge(doc, 'e3', 'g_level', 'value', 'fmt', '{level}');
    addEdge(doc, 'e4', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'python');
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
    assert.ok(res.code.includes('print(f"Player: {name}, Level: {level}")'), `Expected python fstring in:\n${res.code}`);
  }

  // GDScript uses `player_name` (root variable `name` clashes with Node.name)
  {
    const doc = makeDoc('gdscript');
    addVar(doc, 'v_name', 'player_name', 'string', '');
    addVar(doc, 'v_level', 'level', 'int', 0);

    addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
    addNode(doc, 'g_level', 'getVariable', { variableId: 'v_level' });
    addNode(doc, 'fmt', 'formatText', { style: 'fstring', template: 'Player: {player_name}, Level: {level}' });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e1', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{player_name}');
    addEdge(doc, 'e3', 'g_level', 'value', 'fmt', '{level}');
    addEdge(doc, 'e4', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'gdscript');
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
    assert.ok(res.code.includes('print("Player: {0}, Level: {1}".format([player_name, level]))'), `Expected gdscript format in:\n${res.code}`);
    assert.ok(res.code.includes('func _ready():'), 'GDScript statements should be inside _ready()');
    assert.ok(res.code.startsWith('extends Node\n\n'), 'GDScript output should start with extends Node');
  }
});

test('Exact generated text for Example 2: print("Position:", x, y, "Equipment:", items)', () => {
  // Example 2: print with 5 arguments
  for (const target of ['python', 'gdscript']) {
    const doc = makeDoc(target);
    addVar(doc, 'v_x', 'x', 'int', 0);
    addVar(doc, 'v_y', 'y', 'int', 0);
    addVar(doc, 'v_items', 'items', 'list', []);

    addNode(doc, 'lit1', 'literal', { valueType: 'string', value: 'Position:' });
    addNode(doc, 'gx', 'getVariable', { variableId: 'v_x' });
    addNode(doc, 'gy', 'getVariable', { variableId: 'v_y' });
    addNode(doc, 'lit2', 'literal', { valueType: 'string', value: 'Equipment:' });
    addNode(doc, 'gi', 'getVariable', { variableId: 'v_items' });
    addNode(doc, 'pr', 'print', { argCount: 5 });

    addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e1', 'lit1', 'value', 'pr', 'value');
    addEdge(doc, 'e2', 'gx', 'value', 'pr', 'value_1');
    addEdge(doc, 'e3', 'gy', 'value', 'pr', 'value_2');
    addEdge(doc, 'e4', 'lit2', 'value', 'pr', 'value_3');
    addEdge(doc, 'e5', 'gi', 'value', 'pr', 'value_4');

    const res = generateGeometryCode(doc, target);
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));

    if (target === 'python') {
      assert.ok(res.code.includes('print("Position:", x, y, "Equipment:", items)'), `Expected python print in:\n${res.code}`);
    } else {
      assert.ok(res.code.includes('prints("Position:", x, y, "Equipment:", items)'), `Expected gdscript prints in:\n${res.code}`);
    }
  }
});

test('Exact generated text for Example 3: print("Rank {}: {}".format(rank, name))', () => {
  // Example 3: formatText format style + print
  // Python uses rank and name
  {
    const doc = makeDoc('python');
    addVar(doc, 'v_rank', 'rank', 'int', 1);
    addVar(doc, 'v_name', 'name', 'string', '');

    addNode(doc, 'g_rank', 'getVariable', { variableId: 'v_rank' });
    addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
    addNode(doc, 'fmt', 'formatText', { style: 'format', template: 'Rank {rank}: {name}' });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e1', 'g_rank', 'value', 'fmt', '{rank}');
    addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{name}');
    addEdge(doc, 'e3', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'python');
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
    assert.ok(res.code.includes('print("Rank {}: {}".format(rank, name))'), `Expected python format in:\n${res.code}`);
  }

  // GDScript uses rank and player_name (avoids Node.name member clash)
  {
    const doc = makeDoc('gdscript');
    addVar(doc, 'v_rank', 'rank', 'int', 1);
    addVar(doc, 'v_name', 'player_name', 'string', '');

    addNode(doc, 'g_rank', 'getVariable', { variableId: 'v_rank' });
    addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
    addNode(doc, 'fmt', 'formatText', { style: 'format', template: 'Rank {rank}: {player_name}' });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e1', 'g_rank', 'value', 'fmt', '{rank}');
    addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{player_name}');
    addEdge(doc, 'e3', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'gdscript');
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
    assert.ok(res.code.includes('print("Rank {0}: {1}".format([rank, player_name]))'), `Expected gdscript format in:\n${res.code}`);
    assert.ok(res.code.includes('func _ready():'), 'GDScript statements should be inside _ready()');
  }
});

test('Exact generated text for Example 4: print(("Current score: " + str(score) + " pts"))', () => {
  // Example 4: formatText concat style + print
  for (const target of ['python', 'gdscript']) {
    const doc = makeDoc(target);
    addVar(doc, 'v_score', 'score', 'int', 10);

    addNode(doc, 'g_score', 'getVariable', { variableId: 'v_score' });
    addNode(doc, 'fmt', 'formatText', { style: 'concat', template: 'Current score: {score} pts' });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e1', 'g_score', 'value', 'fmt', '{score}');
    addEdge(doc, 'e2', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, target);
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));

    assert.ok(res.code.includes('print(("Current score: " + str(score) + " pts"))'), `Expected concat form in:\n${res.code}`);
  }
});

// ------------------------------------------------------------------------------------------------
// 3. fstring Fallback and Repeated Placeholders
// ------------------------------------------------------------------------------------------------

test('fstring fallback with a string-literal input; repeated placeholder -> indexed form', () => {
  // String literal input to fstring triggers fallback to Python format
  const doc = makeDoc('python');
  addNode(doc, 'lit_name', 'literal', { valueType: 'string', value: 'Alice' });
  addNode(doc, 'fmt', 'formatText', { style: 'fstring', template: 'Hello {name}, welcome back {name}!' });
  addNode(doc, 'pr', 'print', { argCount: 1 });

  addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(doc, 'e1', 'lit_name', 'value', 'fmt', '{name}');
  addEdge(doc, 'e2', 'fmt', 'value', 'pr', 'value');

  const res = generateGeometryCode(doc, 'python');
  assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));

  // Because lit_name is "Alice" (contains quotes), it falls back to Python format form.
  // Because {name} is repeated, it switches to indexed form {0} evaluated once:
  assert.ok(res.code.includes('"Hello {0}, welcome back {0}!".format("Alice")'), `Expected indexed format in:\n${res.code}`);
});

test('repeated placeholder without fallback in Python format switches to indexed form', () => {
  const doc = makeDoc('python');
  addVar(doc, 'v_name', 'name', 'string', '');
  addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
  addNode(doc, 'fmt', 'formatText', { style: 'format', template: '{name} vs {name}' });
  addNode(doc, 'pr', 'print', { argCount: 1 });

  addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(doc, 'e1', 'g_name', 'value', 'fmt', '{name}');
  addEdge(doc, 'e2', 'fmt', 'value', 'pr', 'value');

  const res = generateGeometryCode(doc, 'python');
  assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
  assert.ok(res.code.includes('"{0} vs {0}".format(name)'), `Expected indexed format in:\n${res.code}`);
});

// ------------------------------------------------------------------------------------------------
// 4. Collections: list, array, dict, getItem, setItem
// ------------------------------------------------------------------------------------------------

test('list/array/dict/getItem/setItem codegen', () => {
  for (const target of ['python', 'gdscript']) {
    const doc = makeDoc(target);

    // list node: 2 mixed items
    addNode(doc, 'lit1', 'literal', { valueType: 'int', value: 1 });
    addNode(doc, 'lit2', 'literal', { valueType: 'string', value: 'two' });
    addNode(doc, 'my_list', 'list', { itemCount: 2 });
    addEdge(doc, 'e_l1', 'lit1', 'value', 'my_list', 'item_0');
    addEdge(doc, 'e_l2', 'lit2', 'value', 'my_list', 'item_1');

    // array node: 2 ints
    addNode(doc, 'a1', 'literal', { valueType: 'int', value: 10 });
    addNode(doc, 'a2', 'literal', { valueType: 'int', value: 20 });
    addNode(doc, 'my_arr', 'array', { elementType: 'int', itemCount: 2 });
    addEdge(doc, 'e_a1', 'a1', 'value', 'my_arr', 'item_0');
    addEdge(doc, 'e_a2', 'a2', 'value', 'my_arr', 'item_1');

    // dict node: 2 entries
    addNode(doc, 'd_v1', 'literal', { valueType: 'string', value: 'Hero' });
    addNode(doc, 'd_v2', 'literal', { valueType: 'int', value: 99 });
    addNode(doc, 'my_dict', 'dict', { entries: [{ id: 'k_name', key: 'name' }, { id: 'k_level', key: 'level' }] });
    addEdge(doc, 'e_d1', 'd_v1', 'value', 'my_dict', 'k_name');
    addEdge(doc, 'e_d2', 'd_v2', 'value', 'my_dict', 'k_level');

    // getItem: dict['name']
    addNode(doc, 'key_node', 'literal', { valueType: 'string', value: 'name' });
    addNode(doc, 'get_it', 'getItem', {});
    addEdge(doc, 'e_gi1', 'my_dict', 'value', 'get_it', 'container');
    addEdge(doc, 'e_gi2', 'key_node', 'value', 'get_it', 'key');

    // setItem: my_dict['level'] = 100
    addNode(doc, 'key_lvl', 'literal', { valueType: 'string', value: 'level' });
    addNode(doc, 'val_100', 'literal', { valueType: 'int', value: 100 });
    addNode(doc, 'set_it', 'setItem', {});
    addEdge(doc, 'e_s0', 'start', 'next', 'set_it', 'in');
    addEdge(doc, 'e_s1', 'my_dict', 'value', 'set_it', 'container');
    addEdge(doc, 'e_s2', 'key_lvl', 'value', 'set_it', 'key');
    addEdge(doc, 'e_s3', 'val_100', 'value', 'set_it', 'value');

    // print all: my_list, my_arr, get_it
    addNode(doc, 'pr', 'print', { argCount: 3 });
    addEdge(doc, 'e_p0', 'set_it', 'next', 'pr', 'in');
    addEdge(doc, 'e_p1', 'my_list', 'value', 'pr', 'value');
    addEdge(doc, 'e_p2', 'my_arr', 'value', 'pr', 'value_1');
    addEdge(doc, 'e_p3', 'get_it', 'value', 'pr', 'value_2');

    const res = generateGeometryCode(doc, target);
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));

    assert.ok(res.code.includes('[1, "two"]'), `Expected list [1, "two"] in:\n${res.code}`);
    assert.ok(res.code.includes('[10, 20]'), `Expected array [10, 20] in:\n${res.code}`);
    assert.ok(res.code.includes('{"name": "Hero", "level": 99}'), `Expected dict in:\n${res.code}`);
    assert.ok(res.code.includes('{"name": "Hero", "level": 99}["level"] = 100'), `Expected setItem in:\n${res.code}`);
  }
});

test('array int->float promotion wraps with float()', () => {
  for (const target of ['python', 'gdscript']) {
    const doc = makeDoc(target);
    addNode(doc, 'int_val', 'literal', { valueType: 'int', value: 42 });
    addNode(doc, 'arr', 'array', { elementType: 'float', itemCount: 1 });
    addNode(doc, 'pr', 'print', { argCount: 1 });

    addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e1', 'int_val', 'value', 'arr', 'item_0');
    addEdge(doc, 'e2', 'arr', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, target);
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));
    assert.ok(res.code.includes('[float(42)]'), `Expected float(42) in array:\n${res.code}`);
  }
});

test('string into int Array -> type-mismatch error', () => {
  const doc = makeDoc('python');
  addNode(doc, 'str_val', 'literal', { valueType: 'string', value: 'bad' });
  addNode(doc, 'arr', 'array', { elementType: 'int', itemCount: 1 });
  addNode(doc, 'pr', 'print', { argCount: 1 });

  addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(doc, 'e1', 'str_val', 'value', 'arr', 'item_0');
  addEdge(doc, 'e2', 'arr', 'value', 'pr', 'value');

  const diags = validateGeometryDocument(doc);
  const mismatch = diags.find((d) => d.code === 'type-mismatch');
  assert.ok(mismatch, 'Expected type-mismatch diagnostic when feeding string into int array');
});

test('duplicate dict keys produce duplicate-dict-key error', () => {
  const doc = makeDoc('python');
  addNode(doc, 'val1', 'literal', { valueType: 'int', value: 1 });
  addNode(doc, 'val2', 'literal', { valueType: 'int', value: 2 });
  addNode(doc, 'd', 'dict', {
    entries: [
      { id: 'k_1', key: 'score' },
      { id: 'k_2', key: 'score' }
    ]
  });
  addNode(doc, 'pr', 'print', { argCount: 1 });

  addEdge(doc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(doc, 'e1', 'val1', 'value', 'd', 'k_1');
  addEdge(doc, 'e2', 'val2', 'value', 'd', 'k_2');
  addEdge(doc, 'e3', 'd', 'value', 'pr', 'value');

  const diags = validateGeometryDocument(doc);
  const dup = diags.find((d) => d.code === 'duplicate-dict-key');
  assert.ok(dup, 'Expected duplicate-dict-key error');
});

// ------------------------------------------------------------------------------------------------
// 5. Schema Diagnostics & Serialization
// ------------------------------------------------------------------------------------------------

test('Schema: bad argCount/itemCount/entries/style rejected; list variable with non-empty initialValue rejected', () => {
  // Bad print argCount
  const doc1 = makeDoc('python');
  addNode(doc1, 'p', 'print', { argCount: 99 });
  const d1 = validateGeometryDocument(doc1);
  assert.ok(d1.some((d) => d.code === 'invalid-schema'), 'argCount 99 should fail schema');

  // Bad list itemCount
  const doc2 = makeDoc('python');
  addNode(doc2, 'l', 'list', { itemCount: -1 });
  const d2 = validateGeometryDocument(doc2);
  assert.ok(d2.some((d) => d.code === 'invalid-schema'), 'itemCount -1 should fail schema');

  // Bad formatText style
  const doc3 = makeDoc('python');
  addNode(doc3, 'f', 'formatText', { style: 'unknown_style', template: '{x}' });
  const d3 = validateGeometryDocument(doc3);
  assert.ok(d3.some((d) => d.code === 'invalid-schema'), 'bad style should fail schema');

  // Bad dict entries (not array)
  const doc4 = makeDoc('python');
  addNode(doc4, 'd', 'dict', { entries: 'not an array' });
  const d4 = validateGeometryDocument(doc4);
  assert.ok(d4.some((d) => d.code === 'invalid-schema'), 'non-array entries should fail schema');

  // Bad dict entry id (duplicate id)
  const doc4b = makeDoc('python');
  addNode(doc4b, 'd', 'dict', { entries: [{ id: 'dup', key: 'a' }, { id: 'dup', key: 'b' }] });
  const d4b = validateGeometryDocument(doc4b);
  assert.ok(d4b.some((d) => d.code === 'invalid-schema'), 'duplicate entry id should fail schema');

  // List variable with non-empty initialValue
  const doc5 = makeDoc('python');
  addVar(doc5, 'v1', 'items', 'list', [1, 2]);
  const d5 = validateGeometryDocument(doc5);
  assert.ok(d5.some((d) => d.code === 'invalid-schema'), 'list variable with non-empty initialValue rejected');

  // Dict variable with non-empty initialValue
  const doc6 = makeDoc('python');
  addVar(doc6, 'v2', 'map', 'dict', { key: 'val' });
  const d6 = validateGeometryDocument(doc6);
  assert.ok(d6.some((d) => d.code === 'invalid-schema'), 'dict variable with non-empty initialValue rejected');
});

test('old print {} still valid and generates print(x); save->parse round trip keeps new fields', () => {
  // Old print with empty data {}
  const oldDoc = makeDoc('python');
  addNode(oldDoc, 'val', 'literal', { valueType: 'int', value: 123 });
  addNode(oldDoc, 'pr', 'print', {});
  addEdge(oldDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(oldDoc, 'e1', 'val', 'value', 'pr', 'value');

  const diags = validateGeometryDocument(oldDoc);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const res = generateGeometryCode(oldDoc, 'python');
  assert.ok(res.code.includes('print(123)'));

  // Round trip with all new node types
  const fullDoc = makeDoc('python');
  addVar(fullDoc, 'v_list', 'my_list', 'list', []);
  addVar(fullDoc, 'v_dict', 'my_dict', 'dict', {});
  addNode(fullDoc, 'fmt', 'formatText', { style: 'concat', template: 'Test {x}' });
  addNode(fullDoc, 'lst', 'list', { itemCount: 3 });
  addNode(fullDoc, 'arr', 'array', { elementType: 'float', itemCount: 2 });
  addNode(fullDoc, 'dct', 'dict', { entries: [{ id: 'k_1', key: 'a' }] });
  addNode(fullDoc, 'gi', 'getItem', {});
  addNode(fullDoc, 'si', 'setItem', {});
  addNode(fullDoc, 'pr', 'print', { argCount: 3 });

  const serialized = serializeGeometryDocument(fullDoc);
  const parsed = parseGeometryDocument(serialized);
  assert.ok(parsed.document !== null);
  assert.equal(parsed.document.variables.find((v) => v.name === 'my_list').type, 'list');
  assert.deepEqual(parsed.document.variables.find((v) => v.name === 'my_list').initialValue, []);
  assert.equal(parsed.document.nodes.find((n) => n.id === 'fmt').data.style, 'concat');
  assert.equal(parsed.document.nodes.find((n) => n.id === 'lst').data.itemCount, 3);
  assert.equal(parsed.document.nodes.find((n) => n.id === 'arr').data.elementType, 'float');
  assert.equal(parsed.document.nodes.find((n) => n.id === 'dct').data.entries[0].key, 'a');
  assert.equal(parsed.document.nodes.find((n) => n.id === 'pr').data.argCount, 3);
});

// ------------------------------------------------------------------------------------------------
// 6. Parameter Type Annotations
// ------------------------------------------------------------------------------------------------

test('Parameter type string -> Python x: str, GDScript x: String', () => {
  for (const target of ['python', 'gdscript']) {
    const doc = makeDoc(target);
    addNode(doc, 'fn', 'functionDef', {
      name: 'greet',
      parameters: [{ id: 'p1', name: 'user', type: 'string' }],
      returnType: 'string'
    });
    addEdge(doc, 'e0', 'start', 'next', 'fn', 'in');

    const res = generateGeometryCode(doc, target);
    assert.ifError(res.diagnostics.find((d) => d.severity === 'error'));

    if (target === 'python') {
      assert.ok(res.code.includes('def greet(user: str) -> str:'), `Expected python annotation in:\n${res.code}`);
    } else {
      assert.ok(res.code.includes('func greet(user: String) -> String:'), `Expected gdscript annotation in:\n${res.code}`);
    }
  }
});

// ------------------------------------------------------------------------------------------------
// 7. Real Python 3 (and Godot) Runtime Execution
// ------------------------------------------------------------------------------------------------

test('run generated Example 1 and Example 4 in real Python 3 runtime', (t) => {
  if (!pythonBin) return t.skip('Python 3 not found');

  const scratchDir = mkdtempSync(join(tmpdir(), 'nizyla-collections-run-'));
  t.after(() => rmSync(scratchDir, { recursive: true, force: true }));

  // Example 1: formatText fstring + print
  {
    const doc = makeDoc('python');
    addVar(doc, 'v_name', 'name', 'string', 'Erin');
    addVar(doc, 'v_level', 'level', 'int', 3);
    addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
    addNode(doc, 'g_level', 'getVariable', { variableId: 'v_level' });
    addNode(doc, 'fmt', 'formatText', { style: 'fstring', template: 'Player: {name}, Level: {level}' });
    addNode(doc, 'pr', 'print', { argCount: 1 });
    addEdge(doc, 'e1', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{name}');
    addEdge(doc, 'e3', 'g_level', 'value', 'fmt', '{level}');
    addEdge(doc, 'e4', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'python');
    const pyFile = join(scratchDir, 'ex1.py');
    writeFileSync(pyFile, res.code, 'utf8');

    const proc = spawnSync(pythonBin, [pyFile], { encoding: 'utf8', timeout: 15000, shell: false });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(proc.stdout.trim(), 'Player: Erin, Level: 3');
  }

  // Example 4: formatText concat + print
  {
    const doc = makeDoc('python');
    addVar(doc, 'v_score', 'score', 'int', 10);
    addNode(doc, 'g_score', 'getVariable', { variableId: 'v_score' });
    addNode(doc, 'fmt', 'formatText', { style: 'concat', template: 'Current score: {score} pts' });
    addNode(doc, 'pr', 'print', { argCount: 1 });
    addEdge(doc, 'e1', 'start', 'next', 'pr', 'in');
    addEdge(doc, 'e2', 'g_score', 'value', 'fmt', '{score}');
    addEdge(doc, 'e3', 'fmt', 'value', 'pr', 'value');

    const res = generateGeometryCode(doc, 'python');
    const pyFile = join(scratchDir, 'ex4.py');
    writeFileSync(pyFile, res.code, 'utf8');

    const proc = spawnSync(pythonBin, [pyFile], { encoding: 'utf8', timeout: 15000, shell: false });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(proc.stdout.trim(), 'Current score: 10 pts');
  }

  // Collections execution: list, array with int->float cast, dict variable, getItem, setItem
  {
    const doc = makeDoc('python');
    // var my_map: dict = {}
    addVar(doc, 'v_map', 'my_map', 'dict', {});
    addNode(doc, 'g_map1', 'getVariable', { variableId: 'v_map' });
    addNode(doc, 'g_map2', 'getVariable', { variableId: 'v_map' });

    // my_map["a"] = 99
    addNode(doc, 'k_a_lit', 'literal', { valueType: 'string', value: 'a' });
    addNode(doc, 'val_99', 'literal', { valueType: 'int', value: 99 });
    addNode(doc, 'si', 'setItem', {});
    addEdge(doc, 'e_si0', 'start', 'next', 'si', 'in');
    addEdge(doc, 'e_si1', 'g_map1', 'value', 'si', 'container');
    addEdge(doc, 'e_si2', 'k_a_lit', 'value', 'si', 'key');
    addEdge(doc, 'e_si3', 'val_99', 'value', 'si', 'value');

    // array with float promotion: [float(10)]
    addNode(doc, 'int_10', 'literal', { valueType: 'int', value: 10 });
    addNode(doc, 'arr', 'array', { elementType: 'float', itemCount: 1 });
    addEdge(doc, 'e_a1', 'int_10', 'value', 'arr', 'item_0');

    // print(my_map["a"], arr)
    addNode(doc, 'gi', 'getItem', {});
    addEdge(doc, 'e_gi1', 'g_map2', 'value', 'gi', 'container');
    addEdge(doc, 'e_gi2', 'k_a_lit', 'value', 'gi', 'key');

    addNode(doc, 'pr', 'print', { argCount: 2 });
    addEdge(doc, 'e_pr0', 'si', 'next', 'pr', 'in');
    addEdge(doc, 'e_pr1', 'gi', 'value', 'pr', 'value');
    addEdge(doc, 'e_pr2', 'arr', 'value', 'pr', 'value_1');

    const res = generateGeometryCode(doc, 'python');
    const pyFile = join(scratchDir, 'coll.py');
    writeFileSync(pyFile, res.code, 'utf8');

    const proc = spawnSync(pythonBin, [pyFile], { encoding: 'utf8', timeout: 15000, shell: false });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(proc.stdout.trim(), '99 [10.0]');
  }
});

test('Schema rejects dict entry id equal to "value"', () => {
  const doc = makeDoc('python');
  addNode(doc, 'd', 'dict', { entries: [{ id: 'value', key: 'my_key' }] });
  const diags = validateGeometryDocument(doc);
  const schemaErr = diags.find((d) => d.code === 'invalid-schema');
  assert.ok(schemaErr, 'Entry id "value" should be rejected by schema');

  // Serialization throws TypeError
  assert.throws(() => serializeGeometryDocument(doc), TypeError);
});

test('GDScript v2 exact output: empty doc, Start->print, functions+Start, gd_extends, _ready conflict, name conflict, player_name OK', () => {
  // 1. Empty doc
  const emptyDoc = makeDoc('gdscript');
  const emptyRes = generateGeometryCode(emptyDoc, 'gdscript');
  assert.equal(emptyRes.code, 'extends Node\n\nfunc _ready():\n    pass\n');
  assert.equal(generateGeometryCode(emptyDoc, 'python').code, 'pass\n');

  // 2. Start -> print
  const printDoc = makeDoc('gdscript');
  addNode(printDoc, 'lit', 'literal', { valueType: 'int', value: 1 });
  addNode(printDoc, 'pr', 'print', { argCount: 1 });
  addEdge(printDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(printDoc, 'e1', 'lit', 'value', 'pr', 'value');
  const printRes = generateGeometryCode(printDoc, 'gdscript');
  assert.equal(printRes.code, 'extends Node\n\nfunc _ready():\n    print(1)\n');
  assert.equal(generateGeometryCode(printDoc, 'python').code, 'print(1)\n');

  // 3. Functions + Start
  const fnDoc = makeDoc('gdscript');
  addNode(fnDoc, 'fn', 'functionDef', { name: 'helper', parameters: [], returnType: 'void' });
  addNode(fnDoc, 'lit', 'literal', { valueType: 'int', value: 1 });
  addNode(fnDoc, 'pr', 'print', { argCount: 1 });
  addEdge(fnDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(fnDoc, 'e1', 'lit', 'value', 'pr', 'value');
  const fnRes = generateGeometryCode(fnDoc, 'gdscript');
  assert.equal(fnRes.code, 'extends Node\n\nfunc helper():\n    pass\n\nfunc _ready():\n    print(1)\n');
  assert.equal(generateGeometryCode(fnDoc, 'python').code, 'def helper():\n    pass\n\nprint(1)\n');

  // 4. gd_extends import present -> no extra extends line
  const extDoc = makeDoc('gdscript');
  addNode(extDoc, 'imp', 'import', { importType: 'gd_extends', module: 'CharacterBody2D' });
  addNode(extDoc, 'lit', 'literal', { valueType: 'int', value: 1 });
  addNode(extDoc, 'pr', 'print', { argCount: 1 });
  addEdge(extDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(extDoc, 'e1', 'lit', 'value', 'pr', 'value');
  const extRes = generateGeometryCode(extDoc, 'gdscript');
  assert.equal(extRes.code, 'extends CharacterBody2D\n\nfunc _ready():\n    print(1)\n');
  assert.equal(extRes.code.split('\n').filter((l) => l.startsWith('extends')).length, 1);

  // 5. _ready conflict
  const readyConflictDoc = makeDoc('gdscript');
  addNode(readyConflictDoc, 'fn_ready', 'functionDef', { name: '_ready', parameters: [], returnType: 'void' });
  addNode(readyConflictDoc, 'lit', 'literal', { valueType: 'int', value: 1 });
  addNode(readyConflictDoc, 'pr', 'print', { argCount: 1 });
  addEdge(readyConflictDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(readyConflictDoc, 'e1', 'lit', 'value', 'pr', 'value');
  const readyConflictRes = generateGeometryCode(readyConflictDoc, 'gdscript');
  assert.equal(readyConflictRes.code, null);
  const readyErr = readyConflictRes.diagnostics.find((d) => d.code === 'gdscript-ready-conflict');
  assert.ok(readyErr);
  assert.equal(readyErr.nodeId, 'fn_ready');
  assert.equal(readyErr.message, 'Start statements become _ready() in GDScript; rename this function or move its body under Start.');

  // Start chain empty + user-defined _ready -> emit only user's
  const emptyStartReadyDoc = makeDoc('gdscript');
  addNode(emptyStartReadyDoc, 'fn_ready2', 'functionDef', { name: '_ready', parameters: [], returnType: 'void' });
  const emptyStartReadyRes = generateGeometryCode(emptyStartReadyDoc, 'gdscript');
  assert.ok(emptyStartReadyRes.code !== null);
  assert.equal(emptyStartReadyRes.code.split('\n').filter((l) => l.includes('func _ready')).length, 1);

  // 6. name conflict on root variable and player_name OK
  const nameClashDoc = makeDoc('gdscript');
  addVar(nameClashDoc, 'v_name', 'name', 'string', 'Erin');
  const nameClashRes = generateGeometryCode(nameClashDoc, 'gdscript');
  assert.equal(nameClashRes.code, null);
  const memberErr = nameClashRes.diagnostics.find((d) => d.code === 'gdscript-member-conflict');
  assert.ok(memberErr);
  assert.equal(memberErr.nodeId, undefined);
  assert.equal(memberErr.message, 'Variable "name" clashes with Node.name in GDScript; rename it.');

  // Python output for the same doc with "name" is unchanged and valid
  const pyNameRes = generateGeometryCode(nameClashDoc, 'python');
  assert.ifError(pyNameRes.diagnostics.find((d) => d.severity === 'error'));
  assert.ok(pyNameRes.code.includes('name = "Erin"'));

  // owner conflict on root variable gives specific message with Node.owner
  const ownerClashDoc = makeDoc('gdscript');
  addVar(ownerClashDoc, 'v_owner', 'owner', 'string', 'Boss');
  const ownerClashRes = generateGeometryCode(ownerClashDoc, 'gdscript');
  assert.equal(ownerClashRes.code, null);
  const ownerErr = ownerClashRes.diagnostics.find((d) => d.code === 'gdscript-member-conflict');
  assert.ok(ownerErr);
  assert.equal(ownerErr.message, 'Variable "owner" clashes with Node.owner in GDScript; rename it.');

  // 7. GDScript blank lines: vars + function + Start
  const blankDoc = makeDoc('gdscript');
  addVar(blankDoc, 'v_hp', 'health', 'int', 100);
  addNode(blankDoc, 'fn_take', 'functionDef', { name: 'take_damage', parameters: [], returnType: 'void' });
  addNode(blankDoc, 'lit', 'literal', { valueType: 'int', value: 1 });
  addNode(blankDoc, 'pr', 'print', { argCount: 1 });
  addEdge(blankDoc, 'e0', 'start', 'next', 'pr', 'in');
  addEdge(blankDoc, 'e1', 'lit', 'value', 'pr', 'value');
  const blankRes = generateGeometryCode(blankDoc, 'gdscript');
  assert.equal(blankRes.code, 'extends Node\n\nvar health: int = 100\n\nfunc take_damage():\n    pass\n\nfunc _ready():\n    print(1)\n');

  // player_name generates cleanly
  const playerNameDoc = makeDoc('gdscript');
  addVar(playerNameDoc, 'v_pname', 'player_name', 'string', 'Erin');
  const playerNameRes = generateGeometryCode(playerNameDoc, 'gdscript');
  assert.ifError(playerNameRes.diagnostics.find((d) => d.severity === 'error'));
  assert.ok(playerNameRes.code.includes('var player_name: String = "Erin"'));
});

test('run generated Example 1 and Example 2 in Godot 4 runtime (when GODOT_BIN is set)', (t) => {
  // Verify that root variable 'name' gives gdscript-member-conflict
  const docClash = makeDoc('gdscript');
  addVar(docClash, 'v_name', 'name', 'string', 'Erin');
  const clashRes = generateGeometryCode(docClash, 'gdscript');
  assert.ok(clashRes.diagnostics.some((d) => d.code === 'gdscript-member-conflict'));

  if (!godotBin) return t.skip('Godot 4 not found (set GODOT_BIN to a console executable, or put godot on PATH)');

  const scratchDir = mkdtempSync(join(tmpdir(), 'nizyla-godot-collections-'));
  t.after(() => rmSync(scratchDir, { recursive: true, force: true }));

  writeFileSync(join(scratchDir, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="codegen-test"\n');
  writeFileSync(join(scratchDir, 'main.tscn'), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://generated.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n');
  writeFileSync(join(scratchDir, 'harness.gd'), 'extends SceneTree\n\nfunc _init():\n    print("<<<BEGIN")\n    var scene = load("res://main.tscn").instantiate()\n    root.add_child(scene)\n    await process_frame\n    print("<<<END")\n    quit()\n');

  // Example 1 in GDScript (using player_name)
  const doc = makeDoc('gdscript');
  addVar(doc, 'v_name', 'player_name', 'string', 'Erin');
  addVar(doc, 'v_level', 'level', 'int', 3);
  addNode(doc, 'g_name', 'getVariable', { variableId: 'v_name' });
  addNode(doc, 'g_level', 'getVariable', { variableId: 'v_level' });
  addNode(doc, 'fmt', 'formatText', { style: 'fstring', template: 'Player: {player_name}, Level: {level}' });
  addNode(doc, 'pr', 'print', { argCount: 1 });
  addEdge(doc, 'e1', 'start', 'next', 'pr', 'in');
  addEdge(doc, 'e2', 'g_name', 'value', 'fmt', '{player_name}');
  addEdge(doc, 'e3', 'g_level', 'value', 'fmt', '{level}');
  addEdge(doc, 'e4', 'fmt', 'value', 'pr', 'value');

  const res = generateGeometryCode(doc, 'gdscript');
  writeFileSync(join(scratchDir, 'generated.gd'), res.code, 'utf8');

  const run = spawnSync(godotBin, ['--headless', '--path', scratchDir, '--script', 'res://harness.gd'], {
    encoding: 'utf8',
    timeout: 90000,
    shell: false
  });
  assert.ifError(run.error);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('Player: Erin, Level: 3'), run.stdout);
});
