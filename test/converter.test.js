import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

  // Non-literal member initializers remain verbatim class members; Start stays empty.
  const setNodes1 = doc1.nodes.filter((n) => n.type === 'setVariable');
  assert.equal(setNodes1.length, 0);
  const code1 = generateGeometryCode(doc1, 'gdscript');
  assert.ok(code1.code);
  assert.ok(code1.code.includes('var a: int = 5 + 3'));
  assert.ok(code1.code.includes('var b: String = "hi"'));
  assert.ok(code1.code.includes('var c = get_count()'));
  assert.ok(code1.code.includes('var d: bool = a > 2'));
  assert.match(code1.code, /func _ready\(\):\n    pass/);

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
  // Member initialization is not moved into _ready.
  assert.ok(codeReady.code.includes('var c = get_count()'));
  assert.ok(codeReady.code.includes('func _ready():\n    print("Ready!")'));
});

test('electron/python-parser.py and resource/python-parser.py are byte-identical', () => {
  const electronBytes = fs.readFileSync('electron/python-parser.py');
  const resourceBytes = fs.readFileSync('resource/python-parser.py');
  assert.equal(electronBytes.equals(resourceBytes), true, 'Both python-parser.py files must be byte-identical');
});

test('Python convert handles Thai and international Unicode characters without surrogate errors', () => {
  const source = 'print("\\n--- \u0e41\u0e21\u0e48\u0e2a\u0e39\u0e15\u0e23\u0e04\u0e39\u0e13\u0e41\u0e21\u0e48 {number} ---")\n';
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  assert.ok(document);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);
});

test('Example 1 (fstring): source -> convert -> generateGeometryCode -> exact text, 0 errors, runs with Python 3', () => {
  const source = 'print(f"Player: {name}, Level: {level}")\n';
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const exported = generateGeometryCode(document, 'python');
  assert.equal(exported.code, source);

  // Run with real values in Python 3
  const runSource = 'name = "Alice"\nlevel = 5\n' + exported.code;
  const proc = spawnSync('python', ['-c', runSource], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.equal(proc.stdout.trim(), 'Player: Alice, Level: 5');
});

test('Example 2 (multi-arg print): source -> convert -> generateGeometryCode -> exact text, 0 errors, runs with Python 3', () => {
  const source = 'print("Position:", x, y, "Equipment:", items)\n';
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const exported = generateGeometryCode(document, 'python');
  assert.equal(exported.code, source);

  // Run with real values in Python 3
  const runSource = 'x = 10\ny = 20\nitems = ["sword"]\n' + exported.code;
  const proc = spawnSync('python', ['-c', runSource], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.equal(proc.stdout.trim(), "Position: 10 20 Equipment: ['sword']");
});

test('Example 3 (str.format): source -> convert -> generateGeometryCode -> exact text, 0 errors, runs with Python 3', () => {
  const source = 'print("Rank {}: {}".format(rank, name))\n';
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const exported = generateGeometryCode(document, 'python');
  assert.equal(exported.code, source);

  // Run with real values in Python 3
  const runSource = 'rank = 1\nname = "Alice"\n' + exported.code;
  const proc = spawnSync('python', ['-c', runSource], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.equal(proc.stdout.trim(), 'Rank 1: Alice');
});

test('Example 4 (concat): source -> convert -> generateGeometryCode -> exact text, 0 errors, runs with Python 3', () => {
  // Source with contract regenerated form
  const source = 'print(("Current score: " + str(score) + " pts"))\n';
  const parsed = parsePythonSource(source);
  assert.equal(parsed.error, false);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const exported = generateGeometryCode(document, 'python');
  assert.equal(exported.code, source);

  // Also test unparenthesized concat input regenerates as contract output
  const unparenthesized = 'print("Current score: " + str(score) + " pts")\n';
  const parsed2 = parsePythonSource(unparenthesized);
  const doc2 = convertPythonAstToGcn(parsed2, unparenthesized).document;
  const exported2 = generateGeometryCode(doc2, 'python');
  assert.equal(exported2.code, source);

  // Run with real values in Python 3
  const runSource = 'score = 100\n' + exported.code;
  const proc = spawnSync('python', ['-c', runSource], { encoding: 'utf8' });
  assert.equal(proc.status, 0);
  assert.equal(proc.stdout.trim(), 'Current score: 100 pts');
});

test('Python print with 0 args converts to print node with argCount 0', () => {
  const source = 'print()\n';
  const parsed = parsePythonSource(source);
  const { document, error } = convertPythonAstToGcn(parsed, source);
  assert.equal(error, null);
  const pNode = document.nodes.find((n) => n.type === 'print');
  assert.ok(pNode);
  assert.equal(pNode.data?.argCount, 0);
  const exported = generateGeometryCode(document, 'python');
  assert.equal(exported.code, source);
});

test('Python fstring with same Name reused creates one port and one wire', () => {
  const source = 'print(f"Hello {name}, goodbye {name}!")\n';
  const parsed = parsePythonSource(source);
  const { document } = convertPythonAstToGcn(parsed, source);
  const fmtNode = document.nodes.find((n) => n.type === 'formatText');
  assert.ok(fmtNode);
  assert.equal(fmtNode.data?.template, 'Hello {name}, goodbye {name}!');

  // Out edges to fmtNode should only be 1 (from name to {name})
  const edgesToFmt = document.edges.filter((e) => e.target === fmtNode.id);
  assert.equal(edgesToFmt.length, 1);
  assert.equal(edgesToFmt[0].targetHandle, '{name}');
});

test('Python purely numeric + chain stays binary', () => {
  const source = 'x = 1 + 2 + 3\n';
  const parsed = parsePythonSource(source);
  const { document } = convertPythonAstToGcn(parsed, source);
  const binNodes = document.nodes.filter((n) => n.type === 'binary');
  assert.equal(binNodes.length, 2);
  const fmtNodes = document.nodes.filter((n) => n.type === 'formatText');
  assert.equal(fmtNodes.length, 0);
});

function getAllNodes(graph) {
  const nodes = [...(graph.nodes || [])];
  for (const n of graph.nodes || []) {
    if (n.data?.graph) nodes.push(...getAllNodes(n.data.graph));
  }
  return nodes;
}

test('GDScript prints(a, b) round trip', async () => {
  const source = 'extends Node\n\nfunc _ready():\n    prints(a, b)\n';
  const { document, error } = await convertGdscriptToGcn(source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const allNodes = getAllNodes(document);
  const pNode = allNodes.find((n) => n.type === 'print');
  assert.ok(pNode);
  assert.equal(pNode.data?.argCount, 2);

  const exported = generateGeometryCode(document, 'gdscript');
  assert.equal(exported.code, source);
});

test('GDScript print(a, b) with 2+ args stays a code node with unchanged text', async () => {
  const source = 'extends Node\n\nfunc _ready():\n    print(a, b)\n';
  const { document, error } = await convertGdscriptToGcn(source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const allNodes = getAllNodes(document);
  const cNode = allNodes.find((n) => n.type === 'codeNode');
  assert.ok(cNode);
  assert.equal(cNode.data?.code, 'print(a, b)');
  assert.equal(allNodes.some((n) => n.type === 'print'), false);

  const exported = generateGeometryCode(document, 'gdscript');
  assert.equal(exported.code, source);
});

test('GDScript string concat + chain converts to formatText concat', async () => {
  const source = 'extends Node\n\nfunc _ready():\n    print("Current score: " + str(score) + " pts")\n';
  const { document, error } = await convertGdscriptToGcn(source);
  assert.equal(error, null);
  const diags = validateGeometryDocument(document);
  assert.equal(diags.filter((d) => d.severity === 'error').length, 0);

  const allNodes = getAllNodes(document);
  const fmtNode = allNodes.find((n) => n.type === 'formatText');
  assert.ok(fmtNode);
  assert.equal(fmtNode.data?.style, 'concat');
  assert.equal(fmtNode.data?.template, 'Current score: {score} pts');

  const pNode = allNodes.find((n) => n.type === 'print');
  assert.ok(pNode);
  assert.equal(pNode.data?.argCount, 1);

  const exported = generateGeometryCode(document, 'gdscript');
  assert.ok(exported.code.includes('print(("Current score: " + str(score) + " pts"))'));
});
