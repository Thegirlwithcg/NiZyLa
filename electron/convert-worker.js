import { parentPort, workerData } from 'node:worker_threads';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { convertGdscriptToGcn } from '../src/core/gdscript-converter.js';
import { schemaDiagnostics } from '../src/core/geometry.js';
import { CONVERT_LIMITS, preflightConversion } from './convert-guard.js';

export function tooLargeMessage(name, counts) {
  if (counts.total > CONVERT_LIMITS.maxNodesTotal) {
    return `${name} has ${counts.total.toLocaleString()} nodes; the limit is ${CONVERT_LIMITS.maxNodesTotal.toLocaleString()}. Split the file or convert a smaller part.`;
  }
  return `${name} has a scope with ${counts.largestScope.toLocaleString()} nodes; the limit per scope is ${CONVERT_LIMITS.maxNodesPerScope.toLocaleString()}. Split the scope or convert a smaller part.`;
}

export async function convertInWorker(input) {
  // Test-only hook; production input cannot activate it.
  if (process.env.NIZYLA_TEST === '1' && input.testInfiniteLoop) { while (true) {} }
  const result = input.kind === 'python'
    ? convertPythonAstToGcn(input.ast, input.source, input.sourceFile)
    : await convertGdscriptToGcn(input.source, input.sourceFile, input.wasmDir);
  if (result.error) return { ok: false, reason: 'invalid-output', error: result.error };
  const check = preflightConversion(result.document, schemaDiagnostics);
  if (!check.ok) {
    if (check.reason === 'too-large') {
      const name = input.sourceFile?.split(/[\\/]/).pop() || 'Source';
      return { ok: false, reason: 'too-large', error: tooLargeMessage(name, check.counts), details: check.counts };
    }
    return { ok: false, reason: 'invalid-output', error: 'The converter produced an invalid Geometry Code document.', details: check.details };
  }
  return { ok: true, document: result.document };
}

if (parentPort) {
  convertInWorker(workerData).then((result) => parentPort.postMessage(result), (error) => {
    parentPort.postMessage({ ok: false, reason: 'internal', error: `Conversion failed: ${error.message}` });
  });
}
