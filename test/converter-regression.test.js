import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { validateGeometryDocument } from '../src/core/geometry.js';

function parsePythonSource(source) {
  const parserScript = path.resolve('electron/python-parser.py');
  const proc = spawnSync('python', [parserScript], { input: source, encoding: 'utf8', shell: false });
  return JSON.parse(proc.stdout || proc.stderr || '{"error": true}');
}

function convert(source) {
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false, parsed.message);
  const { document, error } = convertPythonAstToGcn(parsed, source, 'sample.py');
  assert.equal(error, null);
  const diagnostics = validateGeometryDocument(document);
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0, JSON.stringify(diagnostics));
  return document;
}

test('converter keeps editable main guard and allows any equality', () => {
  const doc = convert(`def main():\n    print("ok")\n\nif __name__ == "__main__":\n    main()\n`);
  assert.ok(doc.nodes.some((n) => n.type === 'symbolRef' && n.data.symbol === '__name__'));
  assert.ok(doc.nodes.some((n) => n.type === 'compare' && n.data.operator === '=='));
  const call = doc.nodes.find((n) => n.type === 'functionCall' && n.data.name === 'main');
  const fn = doc.nodes.find((n) => n.type === 'functionDef' && n.data.name === 'main');
  assert.ok(call, 'main guard call should be a Function Call Node');
  assert.equal(call.data.targetId, fn.id);
  fn.data.name = 'renamed_main';
  const exported = generateGeometryCode(doc, 'python');
  assert.match(exported.code, /def renamed_main\(/);
  assert.match(exported.code, /renamed_main\(\)/);
});

test('converter uses full statement support inside if else while and for bodies', () => {
  const doc = convert(`def f(x):\n    if x:\n        print("then")\n        f(False)\n    else:\n        f(True)\n        return 1\n    i = 0\n    while i < 1:\n        f(False)\n        i = i + 1\n    for n in range(0, 2):\n        f(False)\n\nf(True)\n`);
  const calls = [];
  const walk = (graph) => {
    for (const n of graph.nodes) {
      if (n.type === 'functionCall' && n.data.name === 'f') calls.push(n);
      if (n.data?.graph) walk(n.data.graph);
    }
  };
  walk(doc);
  assert.ok(calls.length >= 5, `expected branch/loop function calls, got ${calls.length}`);
  assert.equal(doc.nodes.some((n) => n.type === 'codeNode' && /f\(/.test(n.data.code)), false, 'supported calls must not fall back to Code Node');
});

test('converter infers variable initializer types for string bool and input', () => {
  const doc = convert(`name = input("Name: ")\nflag = True\ntext = "hello"\nprint(name)\nprint(flag)\nprint(text)\n`);
  const vars = Object.fromEntries(doc.variables.map((v) => [v.name, v]));
  assert.equal(vars.name.type, 'string');
  assert.equal(vars.flag.type, 'bool');
  assert.equal(vars.text.type, 'string');
});
