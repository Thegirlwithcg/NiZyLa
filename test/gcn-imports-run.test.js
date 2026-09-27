import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGeometryDocument, parseGeometryDocument, serializeGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { buildGcnBuildPlan } from '../src/core/gcn-imports.js';
import { buildRunnerScript } from '../electron/python-runner.js';

const NL = String.fromCharCode(10);
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const gcn = (id, pathName, alias) => node(id, 'import', { importType: 'gcn', path: pathName, alias });
const graph = () => ({ nodes: [node('start', 'start')], edges: [], variables: [], viewport: { x: 0, y: 0, zoom: 1 } });
const docWithImport = (pathName, alias = 'shapes', target = 'python') => { const d = createGeometryDocument(target); d.nodes.push(gcn('imp', pathName, alias)); return d; };
const functionDoc = () => { const d = createGeometryDocument('python'); d.nodes.push(node('fn', 'functionDef', { name: 'area', parameters: [{ name: 'r' }], returnType: 'any', isStatic: false, graph: graph() })); d.edges.push({ id: 'start-fn', source: 'start', target: 'fn', sourceHandle: 'next', targetHandle: 'in' }); return d; };
const readMap = (mapping) => async file => mapping[file] || null;
const generate = (doc, target, options) => generateGeometryCode(doc, target, options);

const oldRunner = ({ cwd, snapshotFile, logicalFile }) => ['import sys', `sys.path.insert(0, ${JSON.stringify(cwd)})`, `sys.argv = [${JSON.stringify(logicalFile)}]`, `with open(${JSON.stringify(snapshotFile)}, "rb") as f:`, '    source_bytes = f.read()', `code_obj = compile(source_bytes, ${JSON.stringify(logicalFile)}, "exec")`, `exec(code_obj, {"__name__": "__main__", "__file__": ${JSON.stringify(logicalFile)}, "__doc__": None})`, ''].join(NL);

test('GCN Python imports support module, wildcard from, explicit from, and bare references', () => {
  const make = (style, names) => {
    const d = createGeometryDocument('python');
    d.nodes.push(gcn('imp', 'lib/player.gcpy', 'player'));
    d.nodes[1].data.style = style;
    d.nodes[1].data.names = names;
    d.nodes.push(node('call', 'functionCall', { importNodeId: 'imp', name: 'spawn', argumentNames: [] }), node('print', 'print', { argCount: 1 }));
    d.edges.push({ id: 'start', source: 'start', target: 'print', sourceHandle: 'next', targetHandle: 'in' }, { id: 'value', source: 'call', target: 'print', sourceHandle: 'value', targetHandle: 'value' });
    return generateGeometryCode(d, 'python', { importerRelDir: '' }).code;
  };
  assert.match(make('module', []), /import lib\.player as player/);
  assert.match(make('from', [{ name: '*' }]), /from lib\.player import \*/);
  assert.match(make('from', [{ name: 'Player' }, { name: 'spawn' }]), /from lib\.player import Player, spawn/);
  assert.match(make('from', [{ name: '*' }]), /print\(spawn\(\)\)/);
  assert.match(make('module', []), /print\(player\.spawn\(\)\)/);
});

test('build plan with no imports does not call readDoc', async () => { const d = createGeometryDocument('python'); let reads = 0; const plan = await buildGcnBuildPlan({ entryPath: 'main.gcn', entryDoc: d, target: 'python', readDoc: async () => { reads++; }, generate }); assert.equal(plan.ok, true); assert.deepEqual(plan.deps, []); assert.equal(reads, 0); });
test('build plan emits a Python dependency', async () => { const entry = docWithImport('lib/shapes.gcn'); const dep = functionDoc(); const plan = await buildGcnBuildPlan({ entryPath: '/project/main.gcn', projectRoot: '/project', entryDoc: entry, target: 'python', readDoc: readMap({ '/project/lib/shapes.gcn': dep }), generate }); assert.equal(plan.ok, true); assert.equal(plan.deps[0].outPath, 'lib/shapes.py'); assert.equal(plan.deps[0].code.includes('def area'), true); });
test('build plan resolves entry importer directory', async () => { const entry = docWithImport('../lib/shapes.gcn'); const dep = functionDoc(); const plan = await buildGcnBuildPlan({ entryPath: '/project/app/main.gcn', projectRoot: '/project', entryDoc: entry, target: 'python', readDoc: readMap({ '/project/lib/shapes.gcn': dep }), generate }); assert.equal(plan.entryCode.includes('import lib.shapes as shapes'), true); });
test('build plan resolves dependency importer directory', async () => { const entry = docWithImport('lib/a.gcn'); const dep = docWithImport('b.gcn', 'b'); const leaf = functionDoc('b.gcn'); const plan = await buildGcnBuildPlan({ entryPath: '/project/main.gcn', projectRoot: '/project', entryDoc: entry, target: 'python', readDoc: readMap({ '/project/lib/a.gcn': dep, '/project/lib/b.gcn': leaf }), generate }); assert.equal(plan.deps.find(item => item.relPath === 'lib/a.gcn').code.includes('import lib.b as b'), true); });
test('build plan reports closure cycles', async () => { const entry = docWithImport('b.gcn'); const dep = docWithImport('a.gcn'); const plan = await buildGcnBuildPlan({ entryPath: '/project/a.gcn', projectRoot: '/project', entryDoc: entry, target: 'python', readDoc: readMap({ '/project/b.gcn': dep, '/project/a.gcn': entry }), generate }); assert.equal(plan.ok, false); assert.equal(plan.error.includes('a.gcn → b.gcn → a.gcn'), true); });
test('build plan reports dependency codegen errors by relPath', async () => { const entry = docWithImport('lib/a.gcn'); const dep = docWithImport('bad-name.gcn'); const plan = await buildGcnBuildPlan({ entryPath: '/project/main.gcn', projectRoot: '/project', entryDoc: entry, target: 'python', readDoc: readMap({ '/project/lib/a.gcn': dep }), generate }); assert.equal(plan.ok, false); assert.equal(plan.error.includes('lib/a.gcn:'), true); });
test('build plan rejects imports without a project root', async () => { const plan = await buildGcnBuildPlan({ entryPath: 'main.gcn', entryDoc: docWithImport('lib/a.gcn'), target: 'python', readDoc: async () => null, generate }); assert.equal(plan.ok, false); assert.equal(plan.error, 'Save this graph inside an open project folder to use .gcn imports.'); });
test('build plan emits GDScript dependency paths', async () => { const entry = docWithImport('lib/shapes.gcn', 'shapes', 'gdscript'); const dep = createGeometryDocument('gdscript'); const plan = await buildGcnBuildPlan({ entryPath: '/project/main.gd', projectRoot: '/project', entryDoc: entry, target: 'gdscript', readDoc: readMap({ '/project/lib/shapes.gcn': dep }), generate }); assert.equal(plan.deps[0].outPath, 'lib/shapes.gd'); });
test('runner without dependencies matches the old template', () => { const args = { cwd: 'C:/project', snapshotFile: 'C:/tmp/snapshot.py', logicalFile: 'C:/project/main.py' }; assert.equal(buildRunnerScript(args), oldRunner(args)); });
test('runner places dependency path after cwd path', () => { const code = buildRunnerScript({ cwd: 'C:/project', depsDir: 'C:/tmp/deps', snapshotFile: 'C:/tmp/snapshot.py', logicalFile: 'C:/project/main.py' }); assert.equal(code.indexOf('C:/project') < code.indexOf('C:/tmp/deps'), true); });

test('real Python run across GCN files', async (t) => {
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('Python 3 not found'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-gcn-run-'));
  const bodyGraph = () => ({ nodes: [node('start', 'start')], edges: [], variables: [], viewport: { x: 0, y: 0, zoom: 1 } });
  try {
    const mainDoc = createGeometryDocument('python');
    mainDoc.nodes.push(gcn('imp', 'lib/shapes.gcn', 'shapes'));
    mainDoc.nodes.at(-1).data.style = 'from';
    mainDoc.nodes.at(-1).data.names = [{ name: '*' }];
    mainDoc.nodes.push(node('areaCall', 'functionCall', { importNodeId: 'imp', name: 'area', argumentNames: ['r'] }), node('two', 'literal', { valueType: 'int', value: 2 }), node('printArea', 'print', { argCount: 1 }), node('circle', 'instantiate', { importNodeId: 'imp', className: 'Circle', argumentNames: ['r'] }), node('three', 'literal', { valueType: 'int', value: 3 }), node('member', 'getMember', { memberName: 'r' }), node('printMember', 'print', { argCount: 1 }));
    mainDoc.edges.push({ id: 'start-area', source: 'start', target: 'printArea', sourceHandle: 'next', targetHandle: 'in' }, { id: 'area-value', source: 'areaCall', target: 'printArea', sourceHandle: 'value', targetHandle: 'value' }, { id: 'two-area', source: 'two', target: 'areaCall', sourceHandle: 'value', targetHandle: 'arg_0' }, { id: 'area-next', source: 'printArea', target: 'printMember', sourceHandle: 'next', targetHandle: 'in' }, { id: 'three-circle', source: 'three', target: 'circle', sourceHandle: 'value', targetHandle: 'arg_0' }, { id: 'circle-member', source: 'circle', target: 'member', sourceHandle: 'value', targetHandle: 'object' }, { id: 'member-print', source: 'member', target: 'printMember', sourceHandle: 'value', targetHandle: 'value' });
    const depDoc = createGeometryDocument('python');
    const areaBody = bodyGraph();
    areaBody.nodes.push(node('param', 'parameter', { parameterId: 'r', name: 'r', paramType: 'int' }), node('square', 'binary', { operator: '*' }), node('return', 'return', { hasValue: true }), node('r2', 'parameter', { parameterId: 'r', name: 'r', paramType: 'int' }));
    areaBody.edges.push({ id: 'body-return', source: 'start', target: 'return', sourceHandle: 'next', targetHandle: 'in' }, { id: 'r-square-a', source: 'param', target: 'square', sourceHandle: 'value', targetHandle: 'a' }, { id: 'r2-square-b', source: 'r2', target: 'square', sourceHandle: 'value', targetHandle: 'b' }, { id: 'square-return', source: 'square', target: 'return', sourceHandle: 'value', targetHandle: 'value' });
    depDoc.nodes.push(node('area', 'functionDef', { name: 'area', parameters: [{ id: 'r', name: 'r', type: 'int' }], returnType: 'int', isStatic: false, graph: areaBody }));
    const initBody = bodyGraph();
    initBody.nodes.push(node('set', 'setMember', { memberName: 'r' }), node('self', 'parameter', { parameterId: 'self', name: 'self', paramType: 'any' }), node('value', 'parameter', { parameterId: 'r', name: 'r', paramType: 'int' }));
    initBody.edges.push({ id: 'init-set', source: 'start', target: 'set', sourceHandle: 'next', targetHandle: 'in' }, { id: 'self-set', source: 'self', target: 'set', sourceHandle: 'value', targetHandle: 'object' }, { id: 'value-set', source: 'value', target: 'set', sourceHandle: 'value', targetHandle: 'value' });
    const classGraph = bodyGraph();
    classGraph.nodes.push(node('init', 'functionDef', { name: '__init__', parameters: [{ id: 'self', name: 'self', type: 'any' }, { id: 'r', name: 'r', type: 'int' }], returnType: 'void', graph: initBody }));
    depDoc.nodes.push(node('circleDef', 'classDef', { name: 'Circle', baseClass: '', graph: classGraph }));
    const mainPath = path.join(root, 'main.gcn');
    const depPath = path.join(root, 'lib', 'shapes.gcn');
    await fs.mkdir(path.dirname(depPath), { recursive: true });
    await fs.writeFile(mainPath, serializeGeometryDocument(mainDoc));
    await fs.writeFile(depPath, serializeGeometryDocument(depDoc));
    const readDoc = async file => parseGeometryDocument(await fs.readFile(file, 'utf8')).document;
    const plan = await buildGcnBuildPlan({ entryPath: mainPath, projectRoot: root, entryDoc: mainDoc, target: 'python', readDoc, generate });
    assert.equal(plan.ok, true, plan.error);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nizyla-gcn-temp-'));
    try {
      const depsDir = path.join(temp, 'deps');
      for (const dep of plan.deps) { const out = path.join(depsDir, ...dep.outPath.split('/')); await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, dep.code); }
      const snapshot = path.join(temp, 'snapshot.py'); await fs.writeFile(snapshot, plan.entryCode);
      const runner = path.join(temp, 'runner.py'); await fs.writeFile(runner, buildRunnerScript({ cwd: root, depsDir, snapshotFile: snapshot, logicalFile: mainPath }));
      const run = spawnSync('python', ['-u', runner], { encoding: 'utf8', cwd: root });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.replaceAll(String.fromCharCode(13), ''), '4' + NL + '3' + NL);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
