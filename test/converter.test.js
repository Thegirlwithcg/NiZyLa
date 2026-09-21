import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { convertPythonAstToGcn } from '../src/core/python-converter.js';
import { convertGdscriptToGcn } from '../src/core/gdscript-converter.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { validateGeometryDocument } from '../src/core/geometry.js';

function parsePythonSource(source) {
  const parserScript = path.resolve('electron/python-parser.py');
  const proc = spawnSync('python', [parserScript], {
    input: source,
    encoding: 'utf8',
    shell: false
  });
  return JSON.parse(proc.stdout || proc.stderr || '{"error": true}');
}

test('Python Convert -> Export -> Run preserves execution semantics', () => {
  const originalPy = `import math

def calculate(a: int, b: int) -> int:
    return (a * b) + 5

total = calculate(3, 4)
print(total)
`;

  const astRes = parsePythonSource(originalPy);
  assert.equal(astRes.error, false);

  const { document, error } = convertPythonAstToGcn(astRes, originalPy, 'test.py');
  assert.equal(error, null);
  assert.ok(document);

  const diags = validateGeometryDocument(document);
  const errs = diags.filter((d) => d.severity === 'error');
  assert.equal(errs.length, 0, JSON.stringify(errs));

  // Export back
  const exported = generateGeometryCode(document, 'python');
  assert.ok(exported.code);

  // Run original vs exported with Python
  const origRun = spawnSync('python', ['-c', originalPy], { encoding: 'utf8' });
  const exportRun = spawnSync('python', ['-c', exported.code], { encoding: 'utf8' });

  assert.equal(origRun.status, 0);
  assert.equal(exportRun.status, 0);
  assert.equal(exportRun.stdout.trim(), origRun.stdout.trim());
  assert.equal(exportRun.stdout.trim(), '17');
});

test('Python Convert with Class, constructor, and method call', () => {
  const code = `class Counter:
    def __init__(self, start: int = 0):
        self.val = start

    def inc(self, step: int):
        self.val = self.val + step
        print(self.val)

c = Counter(10)
c.inc(5)
`;

  const astRes = parsePythonSource(code);
  const { document, error } = convertPythonAstToGcn(astRes, code);
  assert.equal(error, null);
  assert.ok(document);

  const exported = generateGeometryCode(document, 'python');
  assert.ok(exported.code);

  const origRun = spawnSync('python', ['-c', code], { encoding: 'utf8' });
  const exportRun = spawnSync('python', ['-c', exported.code], { encoding: 'utf8' });

  assert.equal(origRun.status, 0);
  assert.equal(exportRun.status, 0);
  assert.equal(exportRun.stdout.trim(), '15');
});

test('Python syntax error reports location and prevents destructive conversion', () => {
  const broken = 'def foo(x\n    return x + 1\n';
  const astRes = parsePythonSource(broken);
  assert.equal(astRes.error, true);
  assert.ok(astRes.line > 0);
  assert.ok(astRes.message.includes('SyntaxError'));

  const { document, error } = convertPythonAstToGcn(astRes, broken);
  assert.equal(document, null);
  assert.ok(error);
});

test('GDScript Convert parses CST, creates GCN, and exports valid GDScript', async () => {
  const gdCode = `extends CharacterBody2D
class_name Hero

var health: int = 100

func _ready():
    print("Ready!")

func hit(damage: int):
    health = health - damage
    print(health)
`;

  const { document, error } = await convertGdscriptToGcn(gdCode, 'hero.gd');
  assert.equal(error, null);
  assert.ok(document);
  assert.equal(document.target, 'gdscript');

  const diags = validateGeometryDocument(document);
  const errs = diags.filter((d) => d.severity === 'error');
  assert.equal(errs.length, 0, JSON.stringify(errs));

  const exported = generateGeometryCode(document, 'gdscript');
  assert.ok(exported.code);
  assert.ok(exported.code.includes('extends CharacterBody2D'));
  assert.ok(exported.code.includes('class_name Hero'));
  assert.ok(exported.code.includes('func _ready():'));
  assert.ok(exported.code.includes('func hit('));
});

test('GDScript syntax error reports line, column, and refuses conversion', async () => {
  const brokenGd = `extends Node
func broken(
    print(1)
`;
  const { document, error } = await convertGdscriptToGcn(brokenGd);
  assert.equal(document, null);
  assert.ok(error.includes('SyntaxError in GDScript'));
});
