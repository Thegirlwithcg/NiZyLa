import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { validateGeometryDocument, serializeGeometryDocument, parseGeometryDocument } from '../src/core/geometry.js';

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

test('collapses python main guard into start node flag and emits clean codegen', () => {
  const input = `def main():
    if (5.0 <= 10.0):
        print((5.0 * 10.0))
    else:
        print(5.0)


if __name__ == "__main__":
    main()
`;

  // 1. Root node types: ['start', 'functionDef', 'functionCall'], mainGuard flag, call target ID, renaming
  const doc = convert(input);
  const rootNodeTypes = doc.nodes.map((n) => n.type);
  assert.deepEqual(rootNodeTypes, ['start', 'functionDef', 'functionCall']);
  const start = doc.nodes.find((n) => n.type === 'start');
  assert.equal(start.data?.mainGuard, true);
  const fn = doc.nodes.find((n) => n.type === 'functionDef');
  const call = doc.nodes.find((n) => n.type === 'functionCall');
  assert.ok(fn && call);
  assert.equal(call.data.targetId, fn.id);

  // 2. Codegen matches exact expected characters and outputs 50.0 when executed
  const expectedCode = 'def main():\n    if (5.0 <= 10.0):\n        print((5.0 * 10.0))\n    else:\n        print(5.0)\n\nif __name__ == "__main__":\n    main()\n';
  const exported = generateGeometryCode(doc, 'python');
  assert.equal(exported.code, expectedCode);

  const proc = spawnSync('python', ['-c', exported.code], { encoding: 'utf8', shell: false });
  assert.equal(proc.status, 0, proc.stderr);
  assert.equal(proc.stdout.trim(), '50.0');

  // Verify rename propagation
  fn.data.name = 'renamed_main';
  const renamedExport = generateGeometryCode(doc, 'python');
  assert.match(renamedExport.code, /def renamed_main\(/);
  assert.match(renamedExport.code, /renamed_main\(\)/);

  // 3. Fallback: statement precedes guard, or guard has else -> keeps 'if' node and no mainGuard
  const fallbackPreceding = convert('x = 1\nif __name__ == "__main__":\n    print(x)\n');
  assert.ok(fallbackPreceding.nodes.some((n) => n.type === 'if'));
  assert.notEqual(fallbackPreceding.nodes.find((n) => n.type === 'start').data?.mainGuard, true);

  const fallbackElse = convert('def main():\n    print("ok")\n\nif __name__ == "__main__":\n    main()\nelse:\n    print("fallback")\n');
  assert.ok(fallbackElse.nodes.some((n) => n.type === 'if'));
  assert.notEqual(fallbackElse.nodes.find((n) => n.type === 'start').data?.mainGuard, true);

  // 4. serialize -> parse preserves mainGuard: true; Start without flag serializes as data: {}
  const freshDoc = convert(input);
  const serializedWithGuard = serializeGeometryDocument(freshDoc);
  const { document: parsedWithGuard } = parseGeometryDocument(serializedWithGuard);
  assert.equal(parsedWithGuard.nodes.find((n) => n.type === 'start').data?.mainGuard, true);

  const docNoGuard = convert('x = 1\n');
  const serializedNoGuard = serializeGeometryDocument(docNoGuard);
  const parsedRawNoGuard = JSON.parse(serializedNoGuard);
  assert.deepEqual(parsedRawNoGuard.nodes.find((n) => n.type === 'start').data, {});

  // 5. x = 5\nprint(x)\n -> code is exactly 'x = 5\nx = 5\nprint(x)\n' (declaration + setVariable)
  const docVar = convert('x = 5\nprint(x)\n');
  const exportedVar = generateGeometryCode(docVar, 'python');
  assert.equal(exportedVar.code, 'x = 5\nx = 5\nprint(x)\n');
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
