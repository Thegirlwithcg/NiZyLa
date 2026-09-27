import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryDocument, validateGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { gcnAliasFor, planGcnDrop, exportEntries, importerRelDirFor, sameFilePath } from '../src/core/gcn-imports.js';
import { addGcnImports, addImportedSymbolNode } from '../src/core/geometry-editor.js';

const win = String.fromCharCode(92);
const node = (id, type, data = {}, position = { x: 0, y: 0 }) => ({ id, type, position, data });
const drop = (options = {}) => planGcnDrop({ importerPath: '/project/main.gcn', projectRoot: '/project', target: 'python', droppedPaths: [], docTargets: new Map(), existingImports: [], takenNames: new Set(), ...options });
const targetMap = (paths, target = 'python') => new Map(paths.map((file) => [file, target]));
const onlyAdd = (file, options = {}) => drop({ droppedPaths: [file], docTargets: targetMap([file]), ...options });

test('sameFilePath matches Windows backslash and forward slash paths', () => assert.equal(sameFilePath(['C:', 'Project', 'lib', 'shapes.gcn'].join(win), 'C:/Project/lib/shapes.gcn'), true));
test('sameFilePath matches Windows paths with different case', () => assert.equal(sameFilePath('C:/Project/lib/shapes.gcn', 'c:/project/LIB/SHAPES.GCN'), true));
test('sameFilePath does not ignore POSIX case', () => assert.equal(sameFilePath('/project/lib/shapes.gcn', '/PROJECT/LIB/SHAPES.GCN'), false));
test('sameFilePath rejects different files', () => assert.equal(sameFilePath('/project/lib/shapes.gcn', '/project/lib/other.gcn'), false));
test('sameFilePath rejects empty or missing paths', () => {
  assert.equal(sameFilePath('', '/project/lib/shapes.gcn'), false);
  assert.equal(sameFilePath(undefined, '/project/lib/shapes.gcn'), false);
});
test('sameFilePath normalizes trailing dot segments', () => assert.equal(sameFilePath('/project/lib/./sub/../shapes.gcn', '/project/lib/shapes.gcn'), true));

for (const [file, expected] of [['shapes.gcn', 'shapes'], ['my-lib.gcn', 'my_lib'], ['2d.gcn', '_2d'], ['print.gcn', 'print_mod'], ['.gcn', 'module']]) {
  test(`gcnAliasFor ${file}`, () => assert.equal(gcnAliasFor(file, new Set()), expected));
}
test('gcnAliasFor avoids taken names', () => assert.equal(gcnAliasFor('shapes.gcn', new Set(['shapes'])), 'shapes_2'));
test('gcnAliasFor skips multiple taken names', () => assert.equal(gcnAliasFor('shapes.gcn', new Set(['shapes', 'shapes_2'])), 'shapes_3'));
test('gcnAliasFor accepts a Windows basename', () => assert.equal(gcnAliasFor(['lib', 'shapes.gcn'].join(win), new Set()), 'shapes'));

test('planGcnDrop accepts a same-folder POSIX file', () => assert.deepEqual(onlyAdd('/project/lib/shapes.gcn').adds, [{ path: 'lib/shapes.gcn', alias: 'shapes' }]));
test('planGcnDrop accepts an importer in app and file in lib', () => {
  const result = planGcnDrop({ importerPath: '/project/app/main.gcn', projectRoot: '/project', target: 'python', droppedPaths: ['/project/lib/shapes.gcn'], docTargets: targetMap(['/project/lib/shapes.gcn']), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result.adds, [{ path: '../lib/shapes.gcn', alias: 'shapes' }]);
});
test('planGcnDrop accepts Windows root and separators', () => {
  const file = ['C:', 'project', 'lib', 'shapes.gcn'].join(win);
  const result = planGcnDrop({ importerPath: ['C:', 'project', 'main.gcn'].join(win), projectRoot: ['C:', 'project'].join(win), target: 'python', droppedPaths: [file], docTargets: targetMap([file]), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result.adds, [{ path: 'lib/shapes.gcn', alias: 'shapes' }]);
});
test('planGcnDrop reports mixed non-GCN files in one toast', () => {
  const result = drop({ droppedPaths: ['/project/a.py', '/project/lib/shapes.gcn', '/project/b.txt'], docTargets: targetMap(['/project/lib/shapes.gcn']) });
  assert.deepEqual(result.adds, [{ path: 'lib/shapes.gcn', alias: 'shapes' }]);
  assert.deepEqual(result.toasts, ['Only .gcn files can be imported: a.py, b.txt']);
});
test('planGcnDrop reports missing importer once', () => {
  const result = planGcnDrop({ importerPath: null, projectRoot: '/project', target: 'python', droppedPaths: ['/project/a.gcn', '/project/b.gcn'], docTargets: targetMap(['/project/a.gcn', '/project/b.gcn']), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result.adds, []);
  assert.deepEqual(result.toasts, ['Save this graph first']);
});
test('planGcnDrop rejects a missing project root', () => assert.match(onlyAdd('/project/a.gcn', { projectRoot: null }).toasts[0], /File must be inside/));
test('planGcnDrop rejects a file outside project', () => assert.match(onlyAdd('/other/a.gcn').toasts[0], /File must be inside.*a.gcn/));
test('planGcnDrop rejects the importer itself', () => assert.deepEqual(onlyAdd('/project/main.gcn').toasts, ['A file cannot import itself']));
test('planGcnDrop rejects an unreadable document', () => assert.deepEqual(onlyAdd('/project/a.gcn', { docTargets: new Map([['/project/a.gcn', null]]) }).toasts, ['Cannot read a.gcn']));
test('planGcnDrop rejects a target mismatch', () => assert.deepEqual(onlyAdd('/project/a.gcn', { docTargets: targetMap(['/project/a.gcn'], 'gdscript') }).toasts, ['Target mismatch: a.gcn is gdscript']));
test('planGcnDrop rejects a bad Python module segment', () => assert.match(onlyAdd('/project/my-lib/a.gcn').toasts[0], /my-lib/));
test('planGcnDrop accepts a bad GDScript module segment', () => {
  const result = onlyAdd('/project/my-lib/a.gcn', { target: 'gdscript', docTargets: targetMap(['/project/my-lib/a.gcn'], 'gdscript') });
  assert.deepEqual(result.adds, [{ path: 'my-lib/a.gcn', alias: 'a' }]);
});
test('planGcnDrop selects an existing import', () => {
  const result = onlyAdd('/project/lib/shapes.gcn', { existingImports: [{ nodeId: 'import-1', path: 'lib/shapes.gcn' }] });
  assert.deepEqual(result.selectNodeIds, ['import-1']);
  assert.deepEqual(result.adds, []);
});
test('planGcnDrop skips a same-file duplicate in one drop', () => {
  const file = '/project/lib/shapes.gcn';
  const result = drop({ droppedPaths: [file, file], docTargets: targetMap([file]) });
  assert.equal(result.adds.length, 1);
});
test('planGcnDrop makes same-stem aliases unique', () => {
  const a = '/project/a/shapes.gcn';
  const b = '/project/b/shapes.gcn';
  const result = drop({ droppedPaths: [a, b], docTargets: targetMap([a, b]) });
  assert.deepEqual(result.adds.map((item) => item.alias), ['shapes', 'shapes_2']);
});
test('planGcnDrop avoids a taken variable name', () => assert.equal(onlyAdd('/project/shapes.gcn', { takenNames: new Set(['shapes']) }).adds[0].alias, 'shapes_2'));
test('planGcnDrop compares Windows self paths case-insensitively', () => {
  const importer = ['C:', 'Project', 'main.gcn'].join(win);
  const result = planGcnDrop({ importerPath: importer, projectRoot: ['C:', 'Project'].join(win), target: 'python', droppedPaths: [['c:', 'project', 'MAIN.GCN'].join(win)], docTargets: new Map(), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result.toasts, ['A file cannot import itself']);
});
test('planGcnDrop compares Windows project containment case-insensitively', () => {
  const file = ['c:', 'project', 'lib', 'a.gcn'].join(win);
  const result = planGcnDrop({ importerPath: ['C:', 'Project', 'main.gcn'].join(win), projectRoot: ['C:', 'Project'].join(win), target: 'python', droppedPaths: [file], docTargets: targetMap([file]), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result.adds, [{ path: 'lib/a.gcn', alias: 'a' }]);
});
test('planGcnDrop lists at most five invalid names', () => {
  const files = ['a.py', 'b.py', 'c.py', 'd.py', 'e.py', 'f.py'].map((name) => `/project/${name}`);
  const result = drop({ droppedPaths: files, docTargets: new Map() });
  assert.equal(result.toasts[0], 'Only .gcn files can be imported: a.py, b.py, c.py, d.py, e.py, …');
});

test('addGcnImports adds root nodes with vertical offsets', () => {
  const doc = createGeometryDocument('python');
  const result = addGcnImports(doc, [{ path: 'lib/a.gcn', alias: 'a' }, { path: 'lib/b.gcn', alias: 'b' }], { x: 100, y: 200 });
  assert.deepEqual(result.doc.nodes.slice(-2).map((item) => [item.position, item.data.path]), [[{ x: 100, y: 200 }, 'lib/a.gcn'], [{ x: 100, y: 290 }, 'lib/b.gcn']]);
  assert.notEqual(result.doc, doc);
  assert.equal(validateGeometryDocument(result.doc).filter((item) => item.code?.startsWith('gcn-')).length, 0);
});
test('addGcnImports does not mutate the input document', () => {
  const doc = createGeometryDocument('python');
  const before = JSON.stringify(doc);
  addGcnImports(doc, [{ path: 'a.gcn', alias: 'a' }], { x: 0, y: 0 });
  assert.equal(JSON.stringify(doc), before);
});
test('addImportedSymbolNode creates a function call and class instance', () => {
  let doc = addGcnImports(createGeometryDocument('python'), [{ path: 'shapes.gcn', alias: 'shapes' }], { x: 10, y: 20 }).doc;
  const importId = doc.nodes.at(-1).id;
  const fn = addImportedSymbolNode(doc, importId, { kind: 'function', name: 'area', params: ['r'] }, 0);
  const cls = addImportedSymbolNode(fn.doc, importId, { kind: 'class', name: 'Circle', initParams: ['r'] }, 1);
  assert.equal(fn.doc.nodes.at(-1).data.name, 'area');
  assert.deepEqual(cls.doc.nodes.at(-1).position, { x: 270, y: 90 });
  const area = fn.doc.nodes.at(-1);
  const circle = cls.doc.nodes.at(-1);
  const member = node('member', 'getMember', { memberName: 'r' });
  const litArea = node('lit-area', 'literal', { valueType: 'int', value: 2 });
  const litCircle = node('lit-circle', 'literal', { valueType: 'int', value: 3 });
  const printArea = node('print-area', 'print', { argCount: 1 });
  const printCircle = node('print-circle', 'print', { argCount: 1 });
  doc = { ...cls.doc, nodes: [...cls.doc.nodes, member, litArea, litCircle, printArea, printCircle], edges: [
    { id: 'start-area', source: 'start', target: printArea.id, sourceHandle: 'next', targetHandle: 'in' },
    { id: 'area-print', source: area.id, target: printArea.id, sourceHandle: 'value', targetHandle: 'value' },
    { id: 'area-arg', source: litArea.id, target: area.id, sourceHandle: 'value', targetHandle: 'arg_0' },
    { id: 'print-next', source: printArea.id, target: printCircle.id, sourceHandle: 'next', targetHandle: 'in' },
    { id: 'circle-member', source: circle.id, target: member.id, sourceHandle: 'value', targetHandle: 'object' },
    { id: 'circle-arg', source: litCircle.id, target: circle.id, sourceHandle: 'value', targetHandle: 'arg_0' },
    { id: 'member-print', source: member.id, target: printCircle.id, sourceHandle: 'value', targetHandle: 'value' }
  ] };
  const code = generateGeometryCode(doc, 'python').code;
  assert.match(code, /area[(]/);
  assert.match(code, /Circle[(]/);
  assert.equal(doc.nodes.find((item) => item.id === importId).data.style, 'from');
  assert.deepEqual(doc.nodes.find((item) => item.id === importId).data.names, [{ name: '*' }]);
});
test('addImportedSymbolNode rejects a non-root import', () => assert.throws(() => addImportedSymbolNode(createGeometryDocument('python'), 'missing', { kind: 'function', name: 'x', params: [] }, 0), /root gcn import/));
test('addImportedSymbolNode rejects a non-GCN root import', () => {
  const doc = createGeometryDocument('python');
  doc.nodes.push(node('module', 'import', { importType: 'module', module: 'math' }));
  assert.throws(() => addImportedSymbolNode(doc, 'module', { kind: 'function', name: 'x', params: [] }, 0), /root gcn import/);
});

test('exportEntries orders Python functions before classes', () => {
  const rows = exportEntries({ functions: [{ name: 'area', params: ['r'] }], classes: [{ name: 'Circle', initParams: ['r'] }] }, 'python');
  assert.deepEqual(rows.map((row) => [row.kind, row.label, row.disabled, row.title]), [['function', 'ƒ area(r)', false, ''], ['class', '◻ Circle(r)', false, '']]);
});
test('exportEntries disables nonstatic GDScript functions', () => {
  const row = exportEntries({ functions: [{ name: 'area', params: ['r'], isStatic: false }], classes: [] }, 'gdscript')[0];
  assert.equal(row.disabled, true);
  assert.equal(row.title, 'Mark as Static in the source file to call it from GDScript');
});
test('exportEntries leaves static GDScript functions enabled', () => assert.equal(exportEntries({ functions: [{ name: 'area', params: [], isStatic: true }], classes: [] }, 'gdscript')[0].disabled, false));
test('exportEntries returns no rows for null exports', () => assert.deepEqual(exportEntries(null, 'python'), []));
test('planGcnDrop rejects an importer outside a POSIX project', () => {
  const result = planGcnDrop({ importerPath: '/other/main.gcn', projectRoot: '/project', target: 'python', droppedPaths: ['/project/a.gcn'], docTargets: targetMap(['/project/a.gcn']), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result, { adds: [], selectNodeIds: [], toasts: ['Save this graph inside the open project folder'] });
});
test('planGcnDrop rejects an importer outside a Windows project', () => {
  const result = planGcnDrop({ importerPath: ['C:', 'other', 'main.gcn'].join(win), projectRoot: ['C:', 'project'].join(win), target: 'python', droppedPaths: [['C:', 'project', 'a.gcn'].join(win)], docTargets: new Map([[[ 'C:', 'project', 'a.gcn' ].join(win), 'python']]), existingImports: [], takenNames: new Set() });
  assert.deepEqual(result, { adds: [], selectNodeIds: [], toasts: ['Save this graph inside the open project folder'] });
});
test('importerRelDirFor resolves a POSIX root file', () => assert.equal(importerRelDirFor('/project', '/project/main.gcn'), ''));
test('importerRelDirFor resolves a POSIX subfolder file', () => assert.equal(importerRelDirFor('/project', '/project/app/main.gcn'), 'app'));
test('importerRelDirFor resolves a Windows subfolder file', () => assert.equal(importerRelDirFor(['C:', 'Project'].join(win), ['c:', 'project', 'app', 'main.gcn'].join(win)), 'app'));
test('importerRelDirFor rejects a POSIX outside file', () => assert.equal(importerRelDirFor('/project', '/other/main.gcn'), ''));
test('importerRelDirFor returns empty for missing inputs', () => assert.equal(importerRelDirFor(null, '/project/main.gcn'), ''));
test('GCN exports diagnose a missing imported function', () => {
  const doc = createGeometryDocument('python');
  doc.nodes.push(node('imp', 'import', { importType: 'gcn', path: 'lib/shapes.gcn', alias: 'shapes' }), node('call', 'functionCall', { importNodeId: 'imp', name: 'nope', argumentNames: [], isMethod: false }));
  const result = generateGeometryCode(doc, 'python', { importerRelDir: '', gcnExports: new Map([['lib/shapes.gcn', { functions: [{ name: 'area', params: [] }], classes: [] }]]) });
  assert.ok(result.diagnostics.some((item) => item.code === 'gcn-import-missing-symbol' && item.nodeId === 'call'));
});
