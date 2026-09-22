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

test('GDScript Converter: root var statements preservation and _ready placement', async () => {
  // Test four bug cases without _ready (generated _ready gets a, c, d assignments)
  const fourCasesGd = `extends Node
var a: int = 5 + 3
var b: String = "hi"
var c = get_count()
var d: bool = a > 2
`;

  const res1 = await convertGdscriptToGcn(fourCasesGd, 'four.gd');
  assert.equal(res1.error, null);
  const doc1 = res1.document;
  assert.ok(doc1);

  const varA = doc1.variables.find((v) => v.name === 'a');
  const varB = doc1.variables.find((v) => v.name === 'b');
  const varC = doc1.variables.find((v) => v.name === 'c');
  const varD = doc1.variables.find((v) => v.name === 'd');

  assert.ok(varA && varB && varC && varD);
  assert.equal(varA.type, 'int');
  assert.equal(varA.initialValue, 0);

  assert.equal(varB.type, 'string');
  assert.equal(varB.initialValue, 'hi');

  assert.equal(varC.type, 'int');
  assert.equal(varC.initialValue, 0);

  assert.equal(varD.type, 'bool');
  assert.equal(varD.initialValue, false);

  // In doc1 (no user _ready), a, c, d have Set Variable nodes in the root Start chain
  const setNodes1 = doc1.nodes.filter((n) => n.type === 'setVariable');
  assert.equal(setNodes1.length, 3);
  assert.equal(setNodes1[0].data.variableId, varA.id);
  assert.equal(setNodes1[1].data.variableId, varC.id);
  assert.equal(setNodes1[2].data.variableId, varD.id);

  // Codegen on doc1 generates func _ready(): with a, c, d assignments
  const code1 = generateGeometryCode(doc1, 'gdscript');
  assert.ok(code1.code);
  assert.ok(code1.code.includes('var a: int = 0'));
  assert.ok(code1.code.includes('var b: String = "hi"'));
  assert.ok(code1.code.includes('var c: int = 0'));
  assert.ok(code1.code.includes('var d: bool = false'));
  assert.ok(code1.code.includes('func _ready():\n    a = (5 + 3)\n    c = get_count()\n    d = (a > 2)'));

  // Test plain literals becoming initialValues
  const literalsGd = `extends Node
var e: float = 1.5
var n = 3
var s = "x"
var l: Array = []
`;
  const resLit = await convertGdscriptToGcn(literalsGd, 'lit.gd');
  assert.equal(resLit.error, null);
  const docLit = resLit.document;
  const varE = docLit.variables.find((v) => v.name === 'e');
  const varN = docLit.variables.find((v) => v.name === 'n');
  const varS = docLit.variables.find((v) => v.name === 's');
  const varL = docLit.variables.find((v) => v.name === 'l');

  assert.ok(varE && varN && varS && varL);
  assert.equal(varE.type, 'float');
  assert.equal(varE.initialValue, 1.5);
  assert.equal(varN.type, 'int');
  assert.equal(varN.initialValue, 3);
  assert.equal(varS.type, 'string');
  assert.equal(varS.initialValue, 'x');
  assert.equal(varL.type, 'list');
  assert.deepEqual(varL.initialValue, []);

  // No setVariable nodes created for plain literals
  const setLitNodes = docLit.nodes.filter((n) => n.type === 'setVariable');
  assert.equal(setLitNodes.length, 0);

  // Test file with both `var c = get_count()` and `func _ready()`
  const readyGd = `extends Node
var c = get_count()

func _ready():
    print("Ready!")
`;
  const resReady = await convertGdscriptToGcn(readyGd, 'ready.gd');
  assert.equal(resReady.error, null);
  const docReady = resReady.document;

  const readyDiags = validateGeometryDocument(docReady);
  const readyErrs = readyDiags.filter((d) => d.severity === 'error');
  assert.equal(readyErrs.length, 0, JSON.stringify(readyErrs));

  const codeReady = generateGeometryCode(docReady, 'gdscript');
  assert.ok(codeReady.code);
  assert.ifError(codeReady.diagnostics.find((d) => d.severity === 'error'));
  // c's assignment is the first line of _ready
  assert.ok(codeReady.code.includes('func _ready():\n    c = get_count()\n    print("Ready!")'));
});
