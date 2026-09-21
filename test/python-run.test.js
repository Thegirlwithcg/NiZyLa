import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

test('Python Run with input() receives streaming input and replies', async () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push(
    {
      id: 'c1',
      type: 'codeNode',
      position: { x: 100, y: 100 },
      data: {
        codeKind: 'statement',
        code: 'name = input("Enter name: ")\nprint(f"Hello, {name}!")',
        language: 'python'
      }
    }
  );
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'c1', targetHandle: 'in' });

  const { code } = generateGeometryCode(doc, 'python');
  assert.ok(code);

  const proc = spawn('python', ['-u', '-c', code], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  const exitPromise = new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const s = d.toString('utf8');
      output += s;
      if (s.includes('Enter name:')) {
        proc.stdin.write('NiZyLaUser\n');
      }
    });
    proc.on('close', (exitCode) => {
      resolve(exitCode);
    });
  });

  const exitCode = await exitPromise;
  assert.equal(exitCode, 0);
  assert.ok(output.includes('Hello, NiZyLaUser!'));
});

test('Python Run with Thai Unicode output streams cleanly', async () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push(
    {
      id: 'lit_th',
      type: 'literal',
      position: { x: 100, y: 50 },
      data: { valueType: 'string', value: 'สวัสดีชาวโลก ๑๒๓' }
    },
    {
      id: 'p1',
      type: 'print',
      position: { x: 250, y: 50 },
      data: {}
    }
  );
  doc.edges.push(
    { id: 'e1', source: 'start', sourceHandle: 'next', target: 'p1', targetHandle: 'in' },
    { id: 'e2', source: 'lit_th', sourceHandle: 'value', target: 'p1', targetHandle: 'value' }
  );

  const { code } = generateGeometryCode(doc, 'python');
  const run = spawnSync('python', ['-u', '-c', code], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  assert.equal(run.status, 0);
  assert.ok(run.stdout.includes('สวัสดีชาวโลก ๑๒๓'));
});

test('Python Run with Exception outputs traceback and nonzero exit code', async () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push(
    {
      id: 'bad',
      type: 'codeNode',
      position: { x: 100, y: 100 },
      data: { codeKind: 'statement', code: 'raise ValueError("Custom test exception")', language: 'python' }
    }
  );
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'bad', targetHandle: 'in' });

  const { code } = generateGeometryCode(doc, 'python');
  const run = spawnSync('python', ['-u', '-c', code], { encoding: 'utf8' });

  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes('ValueError: Custom test exception'));
  assert.ok(run.stderr.includes('Traceback'));
});

test('Python Run infinite loop can be stopped cleanly', async () => {
  const doc = createGeometryDocument('python', 2);
  doc.nodes.push(
    {
      id: 'loop',
      type: 'codeNode',
      position: { x: 100, y: 100 },
      data: {
        codeKind: 'statement',
        code: 'import time\nprint("LOOP_STARTED", flush=True)\nwhile True:\n    time.sleep(0.05)',
        language: 'python'
      }
    }
  );
  doc.edges.push({ id: 'e1', source: 'start', sourceHandle: 'next', target: 'loop', targetHandle: 'in' });

  const { code } = generateGeometryCode(doc, 'python');

  const proc = spawn('python', ['-u', '-c', code], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const stopPromise = new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      if (d.toString('utf8').includes('LOOP_STARTED')) {
        // Trigger stop
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
        } else {
          proc.kill('SIGKILL');
        }
      }
    });

    proc.on('close', (code) => {
      resolve(code);
    });
  });

  const exitCode = await stopPromise;
  assert.ok(exitCode !== 0);
});

test('Python Run from directory with spaces, Thai, and apostrophe', () => {
  const tempBase = os.tmpdir();
  const testDir = path.join(tempBase, `test 'dir' ภาษาไทย ${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  try {
    const scriptPath = path.join(testDir, "script 'run' ทดสอบ.py");
    fs.writeFileSync(scriptPath, 'print("SUCCESS_FROM_PATH")', 'utf8');

    const run = spawnSync('python', ['-u', scriptPath], {
      cwd: testDir,
      encoding: 'utf8',
      shell: false
    });

    assert.equal(run.status, 0);
    assert.ok(run.stdout.includes('SUCCESS_FROM_PATH'));
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
