import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { nodeDefinitions } from '../src/core/geometry.js';
import { nodeHelp } from '../src/core/node-help.js';

test('nodeHelp keys match nodeDefinitions exactly', () => {
  const defKeys = Object.keys(nodeDefinitions).sort();
  const helpKeys = Object.keys(nodeHelp).sort();
  assert.deepEqual(helpKeys, defKeys);
});

test('every nodeHelp entry has non-empty summary, python, and gdscript fields', () => {
  for (const [type, help] of Object.entries(nodeHelp)) {
    assert.ok(typeof help.summary === 'string' && help.summary.trim().length > 0, `${type}: summary should not be empty`);
    assert.ok(typeof help.python === 'string' && help.python.trim().length > 0, `${type}: python should not be empty`);
    assert.ok(typeof help.gdscript === 'string' && help.gdscript.trim().length > 0, `${type}: gdscript should not be empty`);
  }
});

test('every python example parses cleanly in python AST', () => {
  for (const [type, help] of Object.entries(nodeHelp)) {
    const proc = spawnSync('python', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
      input: help.python,
      encoding: 'utf8',
      shell: false
    });
    assert.equal(proc.status, 0, `Python AST parse failed for ${type}:\n${help.python}\nStderr: ${proc.stderr}`);
  }
});
