import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CONVERT_LIMITS, countDocumentNodes, preflightConversion } from '../electron/convert-guard.js';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { schemaDiagnostics } from '../src/core/geometry.js';
import { tooLargeMessage } from '../electron/convert-worker.js';

function parsePython(source) {
  return JSON.parse(execFileSync('python', ['electron/python-parser.py'], { input: source, encoding: 'utf8' }));
}

test('None constants round-trip with Python None semantics', () => {
  for (const source of ['print(None)\n', 'x = None\nprint(x)\n']) {
    const result = convertPythonAstToGcn(parsePython(source), source, 'none.py');
    assert.equal(result.error, null);
    const generated = generateGeometryCode(result.document, 'python');
    assert.equal(generated.diagnostics.some((d) => d.severity === 'error'), false);
    const expected = execFileSync('python', ['-c', source], { encoding: 'utf8' });
    const actual = execFileSync('python', ['-c', generated.code], { encoding: 'utf8' });
    assert.equal(actual, expected);
  }
});

test('bytes, complex and huge integer constants round-trip as Code expressions', () => {
  const source = 'a = b"bytes"\nb = 1 + 2j\nc = 999999999999999999999999999\n';
  const result = convertPythonAstToGcn(parsePython(source), source, 'constants.py');
  assert.equal(result.error, null);
  assert.deepEqual(schemaDiagnostics(result.document), []);
  assert.equal(generateGeometryCode(result.document, 'python').diagnostics.some((d) => d.severity === 'error'), false);
});

test('preflight rejects documents over either node limit', () => {
  const document = { format: 'nizyla.geometry-code', version: 2, target: 'python', nodes: Array.from({ length: CONVERT_LIMITS.maxNodesTotal + 1 }, (_, i) => ({ id: `n${i}` })), edges: [], variables: [] };
  const result = preflightConversion(document, () => []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-large');
});

test('per-scope node limit message identifies the per-scope limit', () => {
  const message = tooLargeMessage('scope.py', { total: 1400, largestScope: CONVERT_LIMITS.maxNodesPerScope + 1 });
  assert.match(message, /per scope/);
  assert.match(message, new RegExp(String(CONVERT_LIMITS.maxNodesPerScope)));
});

test('conversion worker can be terminated while running an infinite loop', async () => {
  process.env.NIZYLA_TEST = '1';
  const started = Date.now();
  const worker = new Worker(new URL('../electron/convert-worker.js', import.meta.url), { workerData: { testInfiniteLoop: true } });
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { worker.terminate(); resolve({ reason: 'timeout' }); }, 100);
    worker.once('message', resolve);
  });
  assert.equal(result.reason, 'timeout');
  assert.ok(Date.now() - started < CONVERT_LIMITS.convertTimeoutMs + 1000);
});

test('argparse fixture has no invalid schema diagnostics', () => {
  const source = readFileSync('test/fixtures/argparse-trimmed.py', 'utf8');
  const result = convertPythonAstToGcn(parsePython(source), source, 'argparse.py');
  assert.equal(result.error, null);
  assert.equal(schemaDiagnostics(result.document).some((d) => d.code === 'invalid-schema'), false);
});
