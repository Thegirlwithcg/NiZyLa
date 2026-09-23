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
const graph = (target = 'python') => Object.assign(createGeometryDocument(target, 1), { target });
const graph2 = (target = 'python') => Object.assign(createGeometryDocument(target, 2), { target });
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
function runPython(code, inputStr = null) {
  const file = join(scratch, 'generated.py');
  writeFileSync(file, code, 'utf8');
  const run = spawnSync(python, [file], {
    encoding: 'utf8',
    timeout: 30000,
    shell: false,
    input: inputStr !== null ? inputStr : undefined,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });
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
function runGodot(code, inputStr = null) {
  writeFileSync(join(scratch, 'generated.gd'), code, 'utf8');
  return godotLines(spawnSync(godot, ['--headless', '--path', scratch, '--script', 'res://harness.gd'], {
    encoding: 'utf8',
    timeout: 90000,
    shell: false,
    input: inputStr !== null ? inputStr : undefined
  }));
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
  }, [...tricky.split('\n'), mixed]],
  ['for each over list with break and continue', (target) => {
    const doc = graph2(target);
    variable(doc, 'x', 'x', 'int', 0);
    add(doc, 'list', 'list', { itemCount: 4 });
    for (const [idx, val] of [[0, 10], [1, 20], [2, 30], [3, 40]]) {
      literal(doc, `lit-${idx}`, 'int', val);
      wire(doc, `lit-${idx}`, 'value', 'list', `item_${idx}`);
    }
    add(doc, 'loop', 'forEach', { variableId: 'x' });
    wire(doc, 'list', 'value', 'loop', 'items');

    // if x == 20: continue
    get(doc, 'gx20', 'x'); literal(doc, 'l20', 'int', 20);
    operation(doc, 'eq20', 'compare', '==', 'gx20', 'l20');
    add(doc, 'if20', 'if'); wire(doc, 'eq20', 'value', 'if20', 'condition');
    add(doc, 'cnt', 'continue'); wire(doc, 'if20', 'then', 'cnt', 'in');

    // if x == 40: break
    get(doc, 'gx40', 'x'); literal(doc, 'l40', 'int', 40);
    operation(doc, 'eq40', 'compare', '==', 'gx40', 'l40');
    add(doc, 'if40', 'if'); wire(doc, 'eq40', 'value', 'if40', 'condition');
    add(doc, 'brk', 'break'); wire(doc, 'if40', 'then', 'brk', 'in');

    // print(x)
    get(doc, 'gxShow', 'x'); print(doc, 'showX', 'gxShow');

    sequence(doc, 'loop');
    wire(doc, 'loop', 'body', 'if20', 'in');
    wire(doc, 'if20', 'next', 'if40', 'in');
    wire(doc, 'if40', 'next', 'showX', 'in');
    return doc;
  }, ['10', '30']],
  ['append, length and contains', (target) => {
    const doc = graph2(target);
    variable(doc, 'items', 'items', 'list', []);

    // append 5
    add(doc, 'app1', 'append');
    get(doc, 'g1', 'items'); wire(doc, 'g1', 'value', 'app1', 'list');
    literal(doc, 'l5', 'int', 5); wire(doc, 'l5', 'value', 'app1', 'value');

    // append 7
    add(doc, 'app2', 'append');
    get(doc, 'g2', 'items'); wire(doc, 'g2', 'value', 'app2', 'list');
    literal(doc, 'l7', 'int', 7); wire(doc, 'l7', 'value', 'app2', 'value');

    // print length
    add(doc, 'len', 'length');
    get(doc, 'g3', 'items'); wire(doc, 'g3', 'value', 'len', 'value');
    print(doc, 'showLen', 'len');

    // print contains(7)
    add(doc, 'cont', 'contains');
    get(doc, 'g4', 'items'); wire(doc, 'g4', 'value', 'cont', 'container');
    literal(doc, 'l7b', 'int', 7); wire(doc, 'l7b', 'value', 'cont', 'item');
    print(doc, 'showCont', 'cont');

    sequence(doc, 'app1', 'app2', 'showLen', 'showCont');
    return doc;
  }, (target) => ['2', bool(target, true)]],
  ['math modulo, floor divide and power', (target) => {
    const doc = graph2(target);
    // -7 % 3
    literal(doc, 'neg7', 'int', -7); literal(doc, 'pos3', 'int', 3);
    operation(doc, 'm1', 'binary', '%', 'neg7', 'pos3');
    print(doc, 'p1', 'm1');

    // 7 % -3
    literal(doc, 'pos7', 'int', 7); literal(doc, 'neg3', 'int', -3);
    operation(doc, 'm2', 'binary', '%', 'pos7', 'neg3');
    print(doc, 'p2', 'm2');

    // -7 // 2
    literal(doc, 'neg7b', 'int', -7); literal(doc, 'pos2', 'int', 2);
    operation(doc, 'm3', 'binary', '//', 'neg7b', 'pos2');
    print(doc, 'p3', 'm3');

    // 7.5 % 2
    literal(doc, 'f75', 'float', 7.5); literal(doc, 'pos2b', 'int', 2);
    operation(doc, 'm4', 'binary', '%', 'f75', 'pos2b');
    print(doc, 'p4', 'm4');

    // 2 ** 10
    literal(doc, 'two', 'int', 2); literal(doc, 'ten', 'int', 10);
    operation(doc, 'm5', 'binary', '**', 'two', 'ten');
    print(doc, 'p5', 'm5');

    sequence(doc, 'p1', 'p2', 'p3', 'p4', 'p5');
    return doc;
  }, ['2', '-2', '-4', '1.5', '1024']],
  ['convert to int, float and string with concat', (target) => {
    const doc = graph2(target);
    // int("42") + 1
    literal(doc, 's42', 'string', '42');
    add(doc, 'cInt', 'convert', { toType: 'int' });
    wire(doc, 's42', 'value', 'cInt', 'value');
    literal(doc, 'one', 'int', 1);
    operation(doc, 'add1', 'binary', '+', 'cInt', 'one');
    print(doc, 'p1', 'add1');

    // float("2.5") * 3
    literal(doc, 's25', 'string', '2.5');
    add(doc, 'cFloat', 'convert', { toType: 'float' });
    wire(doc, 's25', 'value', 'cFloat', 'value');
    literal(doc, 'three', 'int', 3);
    operation(doc, 'mul3', 'binary', '*', 'cFloat', 'three');
    print(doc, 'p2', 'mul3');

    // Concat "n=" + str(5)
    literal(doc, 'five', 'int', 5);
    add(doc, 'cStr', 'convert', { toType: 'string' });
    wire(doc, 'five', 'value', 'cStr', 'value');
    add(doc, 'concat', 'formatText', { style: 'concat', template: 'n={s}' });
    wire(doc, 'cStr', 'value', 'concat', '{s}');
    print(doc, 'p3', 'concat');

    sequence(doc, 'p1', 'p2', 'p3');
    return doc;
  }, ['43', '7.5', 'n=5']]
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

test('Python codegen: emits global for root variables assigned inside functions', () => {
  // 1. Root variable assigned inside function -> emits global score, runs in real Python printing 1
  const doc = createGeometryDocument('python', 2);
  const scoreId = 'v_score';
  doc.variables.push({ id: scoreId, name: 'score', type: 'int', initialValue: 0 });

  // Add add_point function
  const childGraph = createGeometryDocument('python', 2);
  childGraph.variables = [];
  childGraph.nodes = [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'lit1', type: 'literal', position: { x: 0, y: 100 }, data: { valueType: 'int', value: 1 } },
    { id: 'get1', type: 'getVariable', position: { x: 0, y: 0 }, data: { variableId: scoreId } },
    { id: 'add1', type: 'binary', position: { x: 150, y: 50 }, data: { operator: '+' } },
    { id: 'set1', type: 'setVariable', position: { x: 300, y: 50 }, data: { variableId: scoreId } }
  ];
  childGraph.edges = [
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'set1', targetHandle: 'in' },
    { id: 'e2', source: 'get1', sourceHandle: 'value', target: 'add1', targetHandle: 'a' },
    { id: 'e3', source: 'lit1', sourceHandle: 'value', target: 'add1', targetHandle: 'b' },
    { id: 'e4', source: 'add1', sourceHandle: 'value', target: 'set1', targetHandle: 'value' }
  ];

  const fnNode = {
    id: 'fn1',
    type: 'functionDef',
    position: { x: 200, y: 0 },
    data: { name: 'add_point', parameters: [], returnType: 'void', graph: childGraph }
  };
  doc.nodes.push(fnNode);

  // At root Start chain: call add_point(), then print(score)
  doc.nodes.push({ id: 'call1', type: 'functionCall', position: { x: 400, y: 0 }, data: { name: 'add_point', argumentNames: [] } });
  doc.nodes.push({ id: 'get2', type: 'getVariable', position: { x: 400, y: 100 }, data: { variableId: scoreId } });
  doc.nodes.push({ id: 'pr1', type: 'print', position: { x: 600, y: 0 }, data: { argCount: 1 } });

  doc.edges.push({ id: 're1', source: 'start', sourceHandle: 'next', target: 'call1', targetHandle: 'in' });
  doc.edges.push({ id: 're2', source: 'call1', sourceHandle: 'next', target: 'pr1', targetHandle: 'in' });
  doc.edges.push({ id: 're3', source: 'get2', sourceHandle: 'value', target: 'pr1', targetHandle: 'value' });

  const pyRes = generateGeometryCode(doc, 'python');
  assert.ok(pyRes.code);
  assert.ok(pyRes.code.includes('global score'));

  if (python) {
    const out = runPython(pyRes.code);
    assert.deepEqual(out, ['1']);
  }

  // GDScript output for the same doc is unchanged and does not contain global
  const gdRes = generateGeometryCode(doc, 'gdscript');
  assert.ok(gdRes.code);
  assert.equal(gdRes.code.includes('global'), false);

  // 2. A function that only reads score gets no global
  const readFnDoc = structuredClone(doc);
  const readFn = readFnDoc.nodes.find((n) => n.id === 'fn1');
  readFn.data.graph.nodes = readFn.data.graph.nodes.filter((n) => n.type !== 'setVariable');
  readFn.data.graph.edges = [];
  const readPy = generateGeometryCode(readFnDoc, 'python');
  assert.equal(readPy.code.includes('global score'), false);

  // 3. A parameter named score suppresses global
  const paramFnDoc = structuredClone(doc);
  const paramFn = paramFnDoc.nodes.find((n) => n.id === 'fn1');
  paramFn.data.parameters = [{ id: 'p_score', name: 'score', type: 'int', defaultValue: null }];
  const paramPy = generateGeometryCode(paramFnDoc, 'python');
  assert.equal(paramPy.code.includes('global score'), false);

  // 4. A method in a class gets global
  const classDoc = createGeometryDocument('python', 2);
  classDoc.variables.push({ id: scoreId, name: 'score', type: 'int', initialValue: 0 });
  const classFnNode = structuredClone(fnNode);
  const classNode = {
    id: 'cls1',
    type: 'classDef',
    position: { x: 200, y: 0 },
    data: {
      name: 'ScoreKeeper',
      baseClass: '',
      graph: {
        nodes: [{ id: 'cls_start', type: 'start', position: { x: 0, y: 0 }, data: {} }, classFnNode],
        edges: [],
        variables: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      }
    }
  };
  classDoc.nodes.push(classNode);
  const classPy = generateGeometryCode(classDoc, 'python');
  assert.ok(classPy.code);
  assert.ok(classPy.code.includes('global score'));
});

test('input runtime reads stdin and prints result in Python', { skip: python ? false : 'Python 3 not found' }, () => {
  const doc = graph2('python');
  add(doc, 'inp', 'input', { prompt: 'Name: ' });
  add(doc, 'p', 'print');
  wire(doc, 'start', 'next', 'p', 'in');
  wire(doc, 'inp', 'value', 'p', 'value');
  const code = codeFor(doc, 'python');
  const out = runPython(code, 'Ada\n');
  assert.ok(out.some((line) => line.includes('Ada')), JSON.stringify(out));
});

test('input runtime reads stdin and prints result in Godot', { skip: godot ? false : 'Godot 4 not found' }, () => {
  const doc = graph2('gdscript');
  add(doc, 'inp', 'input', { prompt: 'Name: ' });
  add(doc, 'p', 'print');
  wire(doc, 'start', 'next', 'p', 'in');
  wire(doc, 'inp', 'value', 'p', 'value');
  const code = codeFor(doc, 'gdscript');
  const out = runGodot(code, 'Ada\n');
  assert.ok(out.some((line) => line.includes('Ada')), JSON.stringify(out));
});

test('GDScript _gcn_input helper is emitted correctly based on scope', () => {
  // Case 1: emitted once at root when Input used in root
  const rootDoc = createGeometryDocument('gdscript', 2);
  add(rootDoc, 'inp', 'input', { prompt: 'Enter: ' });
  add(rootDoc, 'p', 'print');
  wire(rootDoc, 'start', 'next', 'p', 'in');
  wire(rootDoc, 'inp', 'value', 'p', 'value');
  const rootCode = codeFor(rootDoc, 'gdscript');
  const rootMatches = rootCode.match(/static func _gcn_input/g);
  assert.equal(rootMatches?.length, 1);
  assert.match(rootCode, /^static func _gcn_input/m);

  // Case 2: emitted once inside class when Input used in class method
  const classDoc = createGeometryDocument('gdscript', 2);
  const classChildGraph = {
    nodes: [
      { id: 'c_start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'c_fn', type: 'functionDef', position: { x: 200, y: 0 }, data: {
        name: 'ask', parameters: [], returnType: 'void',
        graph: {
          nodes: [
            { id: 'f_start', type: 'start', position: { x: 0, y: 0 }, data: {} },
            { id: 'f_inp', type: 'input', position: { x: 100, y: 0 }, data: { prompt: 'Enter: ' } },
            { id: 'f_p', type: 'print', position: { x: 200, y: 0 }, data: { argCount: 1 } }
          ],
          edges: [
            { id: 'fe1', source: 'f_start', sourceHandle: 'next', target: 'f_p', targetHandle: 'in' },
            { id: 'fe2', source: 'f_inp', sourceHandle: 'value', target: 'f_p', targetHandle: 'value' }
          ],
          variables: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }}
    ],
    edges: [],
    variables: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
  classDoc.nodes.push({
    id: 'cls1',
    type: 'classDef',
    position: { x: 100, y: 0 },
    data: { name: 'Dialog', baseClass: '', graph: classChildGraph }
  });
  const classCode = codeFor(classDoc, 'gdscript');
  const classMatches = classCode.match(/static func _gcn_input/g);
  assert.equal(classMatches?.length, 1);
  assert.doesNotMatch(classCode, /^static func _gcn_input/m);
  assert.match(classCode, /^    static func _gcn_input/m);

  // Case 3: emitted in both when used in both
  const bothDoc = structuredClone(classDoc);
  add(bothDoc, 'root_inp', 'input', { prompt: 'Root: ' });
  add(bothDoc, 'root_p', 'print');
  wire(bothDoc, 'start', 'next', 'root_p', 'in');
  wire(bothDoc, 'root_inp', 'value', 'root_p', 'value');
  const bothCode = codeFor(bothDoc, 'gdscript');
  const bothMatches = bothCode.match(/static func _gcn_input/g);
  assert.equal(bothMatches?.length, 2);
  assert.match(bothCode, /^static func _gcn_input/m);
  assert.match(bothCode, /^    static func _gcn_input/m);

  // Case 4: absent when Input not used
  const noInputDoc = createGeometryDocument('gdscript', 2);
  const noInputCode = codeFor(noInputDoc, 'gdscript');
  assert.equal(noInputCode.includes('_gcn_input'), false);
});

test('Python function running For Each over a module variable emits global', () => {
  const doc = createGeometryDocument('python', 2);
  const scoreId = 'var-score';
  doc.variables.push({ id: scoreId, name: 'score', type: 'int', initialValue: 0 });

  const childGraph = {
    nodes: [
      { id: 'fn_start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'fn_list', type: 'list', position: { x: 100, y: 0 }, data: { itemCount: 0 } },
      { id: 'fn_fe', type: 'forEach', position: { x: 200, y: 0 }, data: { variableId: scoreId } }
    ],
    edges: [
      { id: 'fe1', source: 'fn_start', sourceHandle: 'next', target: 'fn_fe', targetHandle: 'in' },
      { id: 'fe2', source: 'fn_list', sourceHandle: 'value', target: 'fn_fe', targetHandle: 'items' }
    ],
    variables: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };

  const fnNode = {
    id: 'fn1',
    type: 'functionDef',
    position: { x: 200, y: 0 },
    data: { name: 'process_items', parameters: [], returnType: 'void', graph: childGraph }
  };
  doc.nodes.push(fnNode);

  const res = generateGeometryCode(doc, 'python');
  assert.ok(res.code);
  assert.ok(res.code.includes('global score'), res.code);
});

test('exact-text codegen for new nodes in Python and GDScript', () => {
  // 1. Math operators %, //, **
  const mathDoc = graph2();
  literal(mathDoc, 'a', 'int', 10);
  literal(mathDoc, 'b', 'int', 3);
  literal(mathDoc, 'fa', 'float', 10.5);
  literal(mathDoc, 'fb', 'float', 3.0);
  operation(mathDoc, 'mod', 'binary', '%', 'a', 'b');
  operation(mathDoc, 'fmod', 'binary', '%', 'fa', 'fb');
  operation(mathDoc, 'fdiv', 'binary', '//', 'a', 'b');
  operation(mathDoc, 'ffdiv', 'binary', '//', 'fa', 'fb');
  operation(mathDoc, 'pow', 'binary', '**', 'a', 'b');
  for (const id of ['mod', 'fmod', 'fdiv', 'ffdiv', 'pow']) print(mathDoc, `p_${id}`, id);
  sequence(mathDoc, 'p_mod', 'p_fmod', 'p_fdiv', 'p_ffdiv', 'p_pow');

  const pyMath = codeFor(mathDoc, 'python');
  assert.ok(pyMath.includes('print((10 % 3))'));
  assert.ok(pyMath.includes('print((10.5 % 3.0))'));
  assert.ok(pyMath.includes('print((10 // 3))'));
  assert.ok(pyMath.includes('print((10.5 // 3.0))'));
  assert.ok(pyMath.includes('print((10 ** 3))'));

  const gdMath = codeFor(mathDoc, 'gdscript');
  assert.ok(gdMath.includes('print(posmod(10, 3))'));
  assert.ok(gdMath.includes('print(fposmod(10.5, 3.0))'));
  assert.ok(gdMath.includes('print(floori(float(10) / 3))'));
  assert.ok(gdMath.includes('print(floor(float(10.5) / 3.0))'));
  assert.ok(gdMath.includes('print((10 ** 3))'));

  // 2. forEach, break, continue
  const loopDoc = graph2();
  variable(loopDoc, 'item', 'item', 'int', 0);
  add(loopDoc, 'list', 'list', { itemCount: 0 });
  add(loopDoc, 'fe', 'forEach', { variableId: 'item' });
  wire(loopDoc, 'list', 'value', 'fe', 'items');
  add(loopDoc, 'brk', 'break');
  add(loopDoc, 'cnt', 'continue');
  sequence(loopDoc, 'fe');
  wire(loopDoc, 'fe', 'body', 'brk', 'in');
  const pyLoop = codeFor(loopDoc, 'python');
  assert.ok(pyLoop.includes('for _gcn_i0 in []:\n    item = _gcn_i0\n    break'), pyLoop);
  const gdLoop = codeFor(loopDoc, 'gdscript');
  assert.ok(gdLoop.includes('for _gcn_i0 in []:\n        item = _gcn_i0\n        break'), gdLoop);

  // 3. append, length, contains
  const collDoc = graph2();
  variable(collDoc, 'lst', 'lst', 'list', []);
  add(collDoc, 'app', 'append');
  get(collDoc, 'g_lst1', 'lst'); wire(collDoc, 'g_lst1', 'value', 'app', 'list');
  literal(collDoc, 'val', 'int', 42); wire(collDoc, 'val', 'value', 'app', 'value');

  add(collDoc, 'len', 'length');
  get(collDoc, 'g_lst2', 'lst'); wire(collDoc, 'g_lst2', 'value', 'len', 'value');
  print(collDoc, 'p_len', 'len');

  add(collDoc, 'cntn', 'contains');
  get(collDoc, 'g_lst3', 'lst'); wire(collDoc, 'g_lst3', 'value', 'cntn', 'container');
  literal(collDoc, 'val2', 'int', 42); wire(collDoc, 'val2', 'value', 'cntn', 'item');
  print(collDoc, 'p_cntn', 'cntn');

  sequence(collDoc, 'app', 'p_len', 'p_cntn');

  const pyColl = codeFor(collDoc, 'python');
  assert.ok(pyColl.includes('lst.append(42)'));
  assert.ok(pyColl.includes('print(len(lst))'));
  assert.ok(pyColl.includes('print((42 in lst))'));

  const gdColl = codeFor(collDoc, 'gdscript');
  assert.ok(gdColl.includes('lst.append(42)'));
  assert.ok(gdColl.includes('print(len(lst))'));
  assert.ok(gdColl.includes('print((42 in lst))'));

  // 4. convert (int, float, string)
  const convDoc = graph2();
  literal(convDoc, 'strLit', 'string', '123');
  add(convDoc, 'toInt', 'convert', { toType: 'int' }); wire(convDoc, 'strLit', 'value', 'toInt', 'value');
  add(convDoc, 'toFloat', 'convert', { toType: 'float' }); wire(convDoc, 'strLit', 'value', 'toFloat', 'value');
  add(convDoc, 'toStr', 'convert', { toType: 'string' }); wire(convDoc, 'toInt', 'value', 'toStr', 'value');
  print(convDoc, 'p_int', 'toInt');
  print(convDoc, 'p_float', 'toFloat');
  print(convDoc, 'p_str', 'toStr');
  sequence(convDoc, 'p_int', 'p_float', 'p_str');

  const pyConv = codeFor(convDoc, 'python');
  assert.ok(pyConv.includes('print(int("123"))'));
  assert.ok(pyConv.includes('print(float("123"))'));
  assert.ok(pyConv.includes('print(str(int("123")))'));

  const gdConv = codeFor(convDoc, 'gdscript');
  assert.ok(gdConv.includes('print(int("123"))'));
  assert.ok(gdConv.includes('print(float("123"))'));
  assert.ok(gdConv.includes('print(str(int("123")))'));

  // 5. input
  const inpDoc = graph2();
  add(inpDoc, 'inp', 'input', { prompt: 'Prompt: ' });
  print(inpDoc, 'p_inp', 'inp');
  sequence(inpDoc, 'p_inp');

  const pyInp = codeFor(inpDoc, 'python');
  assert.ok(pyInp.includes('print(input("Prompt: "))'));

  const gdInp = codeFor(inpDoc, 'gdscript');
  assert.ok(gdInp.includes('print(_gcn_input("Prompt: "))'));
});

