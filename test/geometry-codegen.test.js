import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeometryDocument, nodeDefinitions } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

const targets = ['python', 'gdscript'];

// ---- graph builders (real contract documents) ----
const graph = (target = 'python') => Object.assign(createGeometryDocument(), { target });
function add(doc, id, type, data = {}) {
  doc.nodes.push({ id, type, position: { x: 0, y: 0 }, data: { ...nodeDefinitions[type].defaults, ...data } });
}
const wire = (doc, source, sourceHandle, target, targetHandle) =>
  doc.edges.push({ id: `e${doc.edges.length}`, source, sourceHandle, target, targetHandle });
const variable = (doc, id, name, type, initialValue) => doc.variables.push({ id, name, type, initialValue });
const literal = (doc, id, valueType, value) => add(doc, id, 'literal', { valueType, value });
const get = (doc, id, variableId) => add(doc, id, 'getVariable', { variableId });
function operation(doc, id, type, operator, a, b) {
  add(doc, id, type, { operator });
  wire(doc, a, 'value', id, 'a');
  if (b) wire(doc, b, 'value', id, 'b');
}
function print(doc, id, source) { add(doc, id, 'print'); wire(doc, source, 'value', id, 'value'); }
function assign(doc, id, variableId, source) { add(doc, id, 'setVariable', { variableId }); wire(doc, source, 'value', id, 'value'); }
function sequence(doc, ...ids) {
  let previous = ['start', 'next'];
  for (const id of ids) { wire(doc, previous[0], previous[1], id, 'in'); previous = [id, 'next']; }
}
function loop(doc, id, variableId, start, stop, step) {
  add(doc, id, 'forRange', { variableId });
  for (const [handle, value] of [['start', start], ['stop', stop], ['step', step]]) {
    literal(doc, `${id}-${handle}`, 'int', value);
    wire(doc, `${id}-${handle}`, 'value', id, handle);
  }
}
const generate = (doc, target) => generateGeometryCode(doc, target);
const codeFor = (doc, target) => {
  const result = generate(doc, target);
  assert.ok(result.code !== null, JSON.stringify(result.diagnostics));
  return result.code;
};
const codes = (result) => result.diagnostics.map((item) => item.code);

/** total = sum of index over 0..4, then print total. */
function sumGraph(target) {
  const doc = graph(target);
  variable(doc, 'total', 'total', 'int', 0);
  variable(doc, 'i', 'index', 'int', 0);
  loop(doc, 'loop', 'i', 0, 5, 1);
  get(doc, 'get-total', 'total'); get(doc, 'get-index', 'i');
  operation(doc, 'plus', 'binary', '+', 'get-total', 'get-index');
  assign(doc, 'add', 'total', 'plus');
  get(doc, 'result', 'total'); print(doc, 'show', 'result');
  sequence(doc, 'loop');
  wire(doc, 'loop', 'body', 'add', 'in');
  wire(doc, 'loop', 'next', 'show', 'in');
  return doc;
}

// ---- text-shape tests ----
test('default graph generates an empty function with pass for both targets', () => {
  const doc = graph();
  assert.equal(codeFor(doc, 'python'), 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n');
  assert.equal(codeFor(doc, 'gdscript'), 'extends Node\n\nfunc _ready():\n    pass\n');
  assert.equal(generate(doc).code, codeFor(doc, 'python'));
  assert.equal(generate(graph('gdscript')).code, codeFor(doc, 'gdscript'));
  assert.equal(doc.target, 'python');
});

test('sum graph matches the documented Python and GDScript', () => {
  assert.equal(codeFor(sumGraph('python')), `def main():
    total = 0
    index = 0
    for _gcn_i0 in range(0, 5, 1):
        index = _gcn_i0
        total = (total + index)
    print(total)


if __name__ == "__main__":
    main()
`);
  assert.equal(codeFor(sumGraph('gdscript')), `extends Node

func _ready():
    var total: int = 0
    var index: int = 0
    for _gcn_i0 in range(0, 5, 1):
        index = _gcn_i0
        total = (total + index)
    print(total)
`);
});

test('literals: int, float (including 1), bool, string with Unicode and escapes', () => {
  const text = 'สวัสดี 😀 "q" \\ \t\n\r\u0001\u007f\u2028';
  const items = [['int', -3], ['int', 7], ['float', 1], ['float', -0.5], ['float', 1e21], ['float', 1.5e-7], ['bool', true], ['bool', false], ['string', text]];
  const expected = {
    python: ['print((-3))', 'print(7)', 'print(1.0)', 'print((-0.5))', 'print(1e+21)', 'print(1.5e-7)', 'print(True)', 'print(False)',
      String.raw`print("สวัสดี 😀 \"q\" \\ \t\n\r\x01\x7f\u2028")`],
    gdscript: ['print((-3))', 'print(7)', 'print(1.0)', 'print((-0.5))', 'print(1e+21)', 'print(1.5e-7)', 'print(true)', 'print(false)',
      String.raw`print("สวัสดี 😀 \"q\" \\ \t\n\r\u0001\u007f\u2028")`]
  };
  for (const target of targets) {
    const doc = graph(target);
    items.forEach(([type, value], index) => { literal(doc, `v${index}`, type, value); print(doc, `p${index}`, `v${index}`); });
    sequence(doc, ...items.map((_, index) => `p${index}`));
    assert.deepEqual(codeFor(doc).split('\n').filter((line) => line.trim().startsWith('print(')).map((line) => line.trim()), expected[target]);
  }
});

test('division is floating point and int values assigned to float variables stay float', () => {
  for (const target of targets) {
    const doc = graph(target);
    variable(doc, 'f', 'ratio', 'float', 1);
    literal(doc, 'five', 'int', 5); literal(doc, 'two', 'int', 2);
    operation(doc, 'div', 'binary', '/', 'five', 'two');
    literal(doc, 'three', 'int', 3);
    assign(doc, 'from-int', 'f', 'three'); assign(doc, 'from-div', 'f', 'div');
    print(doc, 'show', 'div');
    sequence(doc, 'from-int', 'from-div', 'show');
    const code = codeFor(doc);
    assert.match(code, target === 'python' ? /ratio = 1\.0\n/ : /var ratio: float = 1\.0\n/);
    assert.match(code, /ratio = float\(3\)\n/);
    assert.match(code, /ratio = \(/);
    assert.ok(code.includes(target === 'python' ? 'print((5 / 2))' : 'print((float(5) / 2))'), code);
  }
});

test('operators are parenthesized and keep and/or/not as short-circuit keywords', () => {
  const doc = graph();
  literal(doc, 'one', 'int', 1); literal(doc, 'two', 'int', 2); literal(doc, 'three', 'int', 3);
  operation(doc, 'sum', 'binary', '+', 'two', 'three');
  operation(doc, 'product', 'binary', '*', 'sum', 'one');
  operation(doc, 'less', 'compare', '<=', 'product', 'three');
  literal(doc, 'no', 'bool', false);
  operation(doc, 'negated', 'boolean', 'not', 'no');
  operation(doc, 'either', 'boolean', 'or', 'less', 'negated');
  operation(doc, 'both', 'boolean', 'and', 'either', 'no');
  print(doc, 'show', 'both');
  sequence(doc, 'show');
  assert.ok(codeFor(doc, 'python').includes('print((((((2 + 3) * 1) <= 3) or (not False)) and False))'), codeFor(doc, 'python'));
  assert.ok(codeFor(doc, 'gdscript').includes('print((((((2 + 3) * 1) <= 3) or (not false)) and false))'));
});

test('If/Else inside loops and next appear once', () => {
  const doc = graph();
  variable(doc, 'i', 'index', 'int', 0);
  loop(doc, 'loop', 'i', 0, 5, 1);
  add(doc, 'if', 'if'); get(doc, 'gi', 'i'); literal(doc, 'two', 'int', 2); operation(doc, 'less', 'compare', '<', 'gi', 'two');
  wire(doc, 'less', 'value', 'if', 'condition');
  for (const [id, text] of [['a', 'a'], ['b', 'b'], ['n', 'n'], ['done', 'done']]) { literal(doc, `s-${id}`, 'string', text); print(doc, id, `s-${id}`); }
  sequence(doc, 'loop');
  wire(doc, 'loop', 'body', 'if', 'in'); wire(doc, 'if', 'then', 'a', 'in'); wire(doc, 'if', 'else', 'b', 'in');
  wire(doc, 'if', 'next', 'n', 'in'); wire(doc, 'loop', 'next', 'done', 'in');
  assert.equal(codeFor(doc, 'gdscript'), `extends Node

func _ready():
    var index: int = 0
    for _gcn_i0 in range(0, 5, 1):
        index = _gcn_i0
        if (index < 2):
            print("a")
        else:
            print("b")
        print("n")
    print("done")
`);
});

test('If with an empty then gets pass and no empty else', () => {
  const doc = graph();
  literal(doc, 'yes', 'bool', true); add(doc, 'if', 'if'); wire(doc, 'yes', 'value', 'if', 'condition');
  sequence(doc, 'if');
  assert.match(codeFor(doc, 'python'), /    if True:\n        pass\n\n/);
  assert.doesNotMatch(codeFor(doc, 'python'), /else/);
});

test('renamed variables keep their ID references', () => {
  const doc = sumGraph('python');
  doc.variables[0].name = 'running_total';
  const code = codeFor(doc);
  assert.match(code, /running_total = \(running_total \+ index\)/);
  assert.doesNotMatch(code, /\btotal\b/);
});

test('unused nodes produce no code but keep their warnings', () => {
  const doc = graph();
  literal(doc, 'lonely', 'string', 'NEVER_EMITTED'); print(doc, 'orphan', 'lonely');
  for (const target of targets) {
    const result = generate(doc, target);
    assert.ok(!result.code.includes('NEVER_EMITTED') && !result.code.includes('print'));
    assert.deepEqual(result.diagnostics.map((item) => [item.severity, item.code]), [['warning', 'unused-node'], ['warning', 'unused-node']]);
  }
});

test('invalid documents and targets return null code and diagnostics', () => {
  const broken = {
    schema: (d) => { d.nodes = null; },
    cycle: (d) => { add(d, 'a', 'print'); add(d, 'b', 'print'); wire(d, 'a', 'next', 'b', 'in'); wire(d, 'b', 'next', 'a', 'in'); },
    'missing-input': (d) => { add(d, 'p', 'print'); sequence(d, 'p'); },
    'type-mismatch': (d) => { variable(d, 'v', 'count', 'int', 0); literal(d, 's', 'string', 'x'); assign(d, 'set', 'v', 's'); sequence(d, 'set'); }
  };
  for (const [expected, change] of Object.entries(broken)) {
    const doc = graph();
    change(doc);
    for (const target of targets) {
      const result = generate(doc, target);
      assert.equal(result.code, null, expected);
      assert.ok(result.diagnostics.some((item) => item.severity === 'error'), expected);
    }
  }
  assert.ok(codes(generate(graph('python'), 'javascript')).includes('unsupported-target'));
  assert.equal(generate(graph('python'), 'javascript').code, null);
  assert.deepEqual(codes(generate(null)), ['invalid-schema', 'unsupported-target']);
  const doc = graph();
  doc.target = 'ruby';
  assert.equal(generate(doc).code, null);
  assert.equal(generate(doc, 'python').code, null); // invalid stored target is a file-shape error
  assert.ok(codes(generateGeometryCode(doc)).includes('unsupported-target'));
});

test('generation does not mutate documents and is deterministic', () => {
  const doc = sumGraph('python');
  const before = structuredClone(doc);
  const freeze = (value) => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); };
  freeze(doc);
  for (const target of targets) assert.equal(codeFor(doc, target), codeFor(structuredClone(before), target));
  assert.deepEqual(doc, before);
  assert.equal(doc.target, 'python');
});

test('lone surrogates are reported instead of producing broken source', () => {
  const doc = graph();
  literal(doc, 's', 'string', 'bad \ud800'); print(doc, 'p', 's'); sequence(doc, 'p');
  const result = generate(doc, 'python');
  assert.equal(result.code, null);
  assert.deepEqual(codes(result), ['invalid-string-literal']);
});

test('code-looking strings and node IDs stay data', () => {
  const evil = '"\nimport os\nos.system("x") # \\';
  const doc = graph();
  literal(doc, 'x"\nimport sys', 'string', evil); print(doc, 'p\nprint(1)', 'x"\nimport sys'); sequence(doc, 'p\nprint(1)');
  for (const target of targets) {
    const code = codeFor(doc, target);
    for (const line of code.split('\n')) assert.ok(!/^\s*(import|os\.)/.test(line), line);
    assert.ok(!code.includes('import sys'));
    assert.equal(code.split('\n').filter((line) => line.trim().startsWith('print(')).length, 1);
  }
});

test('6,000 chained statements generate without stack overflow', () => {
  for (const target of targets) {
    const doc = graph(target);
    literal(doc, 'value', 'int', 1);
    const ids = [];
    for (let i = 0; i < 6000; i++) { print(doc, `p${i}`, 'value'); ids.push(`p${i}`); }
    sequence(doc, ...ids);
    const result = generate(doc);
    assert.equal(result.code.split('\n').filter((line) => line.trim() === 'print(1)').length, 6000);
  }
});

test('deep expressions and blocks are limited with diagnostics, never RangeError', () => {
  const deep = graph();
  literal(deep, 'n0', 'int', 1);
  for (let i = 1; i <= 200; i++) operation(deep, `n${i}`, 'binary', '+', `n${i - 1}`, 'n0');
  print(deep, 'p', 'n200'); sequence(deep, 'p');
  assert.deepEqual(codes(generate(deep)), ['expression-too-deep']);
  assert.equal(generate(deep).code, null);

  const wide = graph();
  literal(wide, 'n0', 'int', 1);
  for (let i = 1; i <= 60; i++) operation(wide, `n${i}`, 'binary', '+', `n${i - 1}`, `n${i - 1}`);
  print(wide, 'p', 'n60'); sequence(wide, 'p');
  assert.deepEqual(codes(generate(wide)), ['expression-too-large']);

  const nested = graph();
  literal(nested, 'yes', 'bool', true);
  let previous = null;
  for (let i = 0; i < 80; i++) {
    add(nested, `if${i}`, 'if'); wire(nested, 'yes', 'value', `if${i}`, 'condition');
    if (previous) wire(nested, previous, 'then', `if${i}`, 'in'); else sequence(nested, `if${i}`);
    previous = `if${i}`;
  }
  assert.deepEqual(codes(generate(nested)), ['block-too-deep']);
});

// ---- real runtime checks ----
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
const python = findPython();
const godot = findGodot();
const scratch = mkdtempSync(join(tmpdir(), 'nizyla-codegen-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
writeFileSync(join(scratch, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="codegen-test"\n');
writeFileSync(join(scratch, 'main.tscn'), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://generated.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n');
writeFileSync(join(scratch, 'harness.gd'), 'extends SceneTree\n\nfunc _init():\n    print("<<<BEGIN")\n    var scene = load("res://main.tscn").instantiate()\n    root.add_child(scene)\n    await process_frame\n    print("<<<END")\n    quit()\n');

const lines = (text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
function runPython(code) {
  const file = join(scratch, 'generated.py');
  writeFileSync(file, code, 'utf8');
  const run = spawnSync(python, [file], { encoding: 'utf8', timeout: 30000, shell: false, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.ifError(run.error);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  return lines(run.stdout);
}
function compilePython(code) {
  const file = join(scratch, 'compiled.py');
  writeFileSync(file, code, 'utf8');
  const run = spawnSync(python, ['-m', 'py_compile', file], { encoding: 'utf8', timeout: 30000, shell: false });
  assert.equal(run.status, 0, run.stderr);
}
function runGodot(code) {
  writeFileSync(join(scratch, 'generated.gd'), code, 'utf8');
  return godotLines(spawnSync(godot, ['--headless', '--path', scratch, '--script', 'res://harness.gd'], { encoding: 'utf8', timeout: 90000, shell: false }));
}
/** Validates a spawnSync result from the Godot harness; returns the lines printed between the markers. */
function godotLines(run) {
  assert.ifError(run.error); // spawn failure or timeout
  assert.equal(run.signal, null, `killed by ${run.signal}`);
  assert.equal(run.status, 0, run.stderr);
  const output = `${run.stdout}\n${run.stderr}`;
  assert.ok(!/SCRIPT ERROR|Parse Error|ERROR:/.test(output), output);
  const all = run.stdout.replace(/\r\n/g, '\n').split('\n');
  const begin = all.indexOf('<<<BEGIN');
  const end = all.indexOf('<<<END');
  assert.ok(begin >= 0 && end > begin, `missing or misordered <<<BEGIN/<<<END markers: ${output}`);
  return all.slice(begin + 1, end);
}

const tricky = 'สวัสดี 😀 "q" \\ \tend\n"\nprint(1) # \\"';
const bool = (target, value) => (target === 'python' ? (value ? 'True' : 'False') : String(value));
const mixed = 'Hello NiZyLa ABC xyz';
const cases = [
  ['sum 0..4 is 10', sumGraph, ['10']],
  ['arithmetic, comparison, logic and short circuit', (target) => {
    const doc = graph(target);
    for (const [id, value] of [['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5]]) literal(doc, id, 'int', value);
    literal(doc, 'zero', 'int', 0); literal(doc, 'one-float', 'float', 1);
    literal(doc, 'no', 'bool', false); literal(doc, 'yes', 'bool', true);
    operation(doc, 'div', 'binary', '/', 'five', 'two');
    operation(doc, 'equal', 'compare', '==', 'one', 'one-float');
    operation(doc, 'less', 'compare', '<', 'two', 'one');
    operation(doc, 'not', 'boolean', 'not', 'no');
    operation(doc, 'boom', 'binary', '/', 'one', 'zero');
    operation(doc, 'boom-test', 'compare', '>', 'boom', 'one');
    operation(doc, 'and', 'boolean', 'and', 'no', 'boom-test');
    operation(doc, 'or', 'boolean', 'or', 'yes', 'boom-test');
    operation(doc, 'sum', 'binary', '+', 'two', 'three');
    operation(doc, 'grouped', 'binary', '*', 'sum', 'four');
    operation(doc, 'product', 'binary', '*', 'three', 'four');
    operation(doc, 'ungrouped', 'binary', '+', 'two', 'product');
    const shown = ['div', 'equal', 'less', 'not', 'and', 'or', 'grouped', 'ungrouped'];
    shown.forEach((id) => print(doc, `p-${id}`, id));
    sequence(doc, ...shown.map((id) => `p-${id}`));
    return doc;
  }, (target) => ['2.5', ...[true, false, true, false, true].map((value) => bool(target, value)), '20', '14']],
  ['negative step and empty range', (target) => {
    const doc = graph(target);
    variable(doc, 'i', 'index', 'int', 0); variable(doc, 'j', 'kept', 'int', 7);
    loop(doc, 'down', 'i', 5, -1, -2); get(doc, 'gi', 'i'); print(doc, 'show-i', 'gi');
    loop(doc, 'empty', 'j', 3, 3, 1); literal(doc, 'ninety', 'int', 90); assign(doc, 'touch', 'j', 'ninety');
    get(doc, 'gj', 'j'); print(doc, 'show-j', 'gj');
    sequence(doc, 'down', 'empty', 'show-j');
    wire(doc, 'down', 'body', 'show-i', 'in'); wire(doc, 'empty', 'body', 'touch', 'in');
    return doc;
  }, ['5', '3', '1', '7']],
  ['setting the loop variable does not change the iteration count', (target) => {
    const doc = graph(target);
    variable(doc, 'i', 'index', 'int', 0); variable(doc, 'c', 'count', 'int', 0);
    loop(doc, 'loop', 'i', 0, 5, 1);
    literal(doc, 'hundred', 'int', 100); assign(doc, 'clobber', 'i', 'hundred');
    get(doc, 'gc', 'c'); literal(doc, 'one', 'int', 1); operation(doc, 'inc', 'binary', '+', 'gc', 'one'); assign(doc, 'count', 'c', 'inc');
    get(doc, 'result', 'c'); print(doc, 'show', 'result');
    sequence(doc, 'loop'); wire(doc, 'loop', 'body', 'clobber', 'in'); wire(doc, 'clobber', 'next', 'count', 'in'); wire(doc, 'loop', 'next', 'show', 'in');
    return doc;
  }, ['5']],
  ['while re-reads its condition', (target) => {
    const doc = graph(target);
    variable(doc, 'x', 'counter', 'int', 0);
    get(doc, 'gx', 'x'); literal(doc, 'three', 'int', 3); operation(doc, 'less', 'compare', '<', 'gx', 'three');
    add(doc, 'while', 'while'); wire(doc, 'less', 'value', 'while', 'condition');
    get(doc, 'gx2', 'x'); literal(doc, 'one', 'int', 1); operation(doc, 'inc', 'binary', '+', 'gx2', 'one'); assign(doc, 'step', 'x', 'inc');
    get(doc, 'gx3', 'x'); print(doc, 'show', 'gx3');
    sequence(doc, 'while'); wire(doc, 'while', 'body', 'step', 'in'); wire(doc, 'while', 'next', 'show', 'in');
    return doc;
  }, ['3']],
  ['If/Else inside a loop runs next once per iteration', (target) => {
    const doc = graph(target);
    variable(doc, 'i', 'index', 'int', 0);
    loop(doc, 'loop', 'i', 0, 5, 1);
    add(doc, 'if', 'if'); get(doc, 'gi', 'i'); literal(doc, 'two', 'int', 2); operation(doc, 'less', 'compare', '<', 'gi', 'two');
    wire(doc, 'less', 'value', 'if', 'condition');
    for (const id of ['a', 'b', 'n', 'done']) { literal(doc, `s-${id}`, 'string', id); print(doc, id, `s-${id}`); }
    sequence(doc, 'loop');
    wire(doc, 'loop', 'body', 'if', 'in'); wire(doc, 'if', 'then', 'a', 'in'); wire(doc, 'if', 'else', 'b', 'in');
    wire(doc, 'if', 'next', 'n', 'in'); wire(doc, 'loop', 'next', 'done', 'in');
    return doc;
  }, ['a', 'n', 'a', 'n', 'b', 'n', 'b', 'n', 'b', 'n', 'done']],
  ['strings round-trip exactly, including code-like text', (target) => {
    const doc = graph(target);
    variable(doc, 's', 'message', 'string', tricky);
    get(doc, 'gs', 's'); print(doc, 'show', 'gs');
    literal(doc, 'mixed', 'string', mixed); print(doc, 'show-mixed', 'mixed'); sequence(doc, 'show', 'show-mixed');
    return doc;
  }, [...tricky.split('\n'), mixed]]
];

for (const [target, runtime, available, reason] of [
  ['python', runPython, python, 'Python 3 not found (tried python, python3, py)'],
  ['gdscript', runGodot, godot, 'Godot 4 not found (set GODOT_BIN to a console executable, or put godot on PATH)']
]) {
  test(`${target} runtime output matches expected behaviour`, { skip: available ? false : reason }, () => {
    for (const [name, make, expected] of cases) {
      const output = runtime(codeFor(make(target)));
      assert.deepEqual(output, typeof expected === 'function' ? expected(target) : expected, name);
    }
  });
}

test('Godot result checks reject failed, timed-out and unterminated runs', () => {
  const ok = { error: undefined, signal: null, status: 0, stdout: 'Godot banner\r\n<<<BEGIN\r\n10\r\n<<<END\r\n', stderr: '' };
  assert.deepEqual(godotLines(ok), ['10']);
  for (const bad of [
    { ...ok, error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGTERM' },
    { ...ok, status: null, signal: 'SIGTERM' },
    { ...ok, status: 1 },
    { ...ok, stdout: '<<<BEGIN\n10\n' },
    { ...ok, stdout: '10\n<<<END\n' },
    { ...ok, stdout: '<<<END\n10\n<<<BEGIN\n' },
    { ...ok, stderr: 'SCRIPT ERROR: Parse Error' }
  ]) assert.throws(() => godotLines(bad));
});

test('python runtime keeps float type when an int is assigned', { skip: python ? false : 'Python 3 not found' }, () => {
  const doc = graph();
  variable(doc, 'f', 'ratio', 'float', 1);
  literal(doc, 'three', 'int', 3); assign(doc, 'set', 'f', 'three');
  get(doc, 'g1', 'f'); print(doc, 'show1', 'g1');
  sequence(doc, 'show1', 'set');
  get(doc, 'g2', 'f'); print(doc, 'show2', 'g2');
  wire(doc, 'set', 'next', 'show2', 'in');
  assert.deepEqual(runPython(codeFor(doc)), ['1.0', '3.0']);
});

test('python accepts maximum-depth output', { skip: python ? false : 'Python 3 not found' }, () => {
  const doc = graph();
  literal(doc, 'yes', 'bool', true);
  let previous = null;
  for (let i = 0; i < 48; i++) {
    add(doc, `if${i}`, 'if'); wire(doc, 'yes', 'value', `if${i}`, 'condition');
    if (previous) wire(doc, previous, 'then', `if${i}`, 'in'); else sequence(doc, `if${i}`);
    previous = `if${i}`;
  }
  literal(doc, 'n0', 'int', 1);
  for (let i = 1; i < 64; i++) operation(doc, `n${i}`, 'binary', '+', `n${i - 1}`, 'n0');
  print(doc, 'p', 'n63'); wire(doc, previous, 'then', 'p', 'in');
  compilePython(codeFor(doc, 'python'));
});
