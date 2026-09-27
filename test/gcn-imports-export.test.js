import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGeometryDocument } from '../src/core/geometry.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';
import { buildGcnBuildPlan, planExportTargets } from '../src/core/gcn-imports.js';

const generate = (doc, target, options) => generateGeometryCode(doc, target, options);
const readDoc = async () => null;
const withImport = (target = 'python') => {
  const doc = createGeometryDocument(target);
  doc.nodes.push({ id: 'imp', type: 'import', position: { x: 0, y: 0 }, data: { importType: 'gcn', path: 'lib/shapes.gcn', alias: 'shapes' } });
  return doc;
};

test('entryOutPath uses root and subfolder paths', async () => {
  const root = await buildGcnBuildPlan({ entryPath: '/project/main.gcn', projectRoot: '/project', entryDoc: createGeometryDocument('python'), target: 'python', readDoc, generate });
  const nested = await buildGcnBuildPlan({ entryPath: '/project/app/main.gcn', projectRoot: '/project', entryDoc: createGeometryDocument('python'), target: 'python', readDoc, generate });
  assert.equal(root.entryOutPath, 'main.py');
  assert.equal(nested.entryOutPath, 'app/main.py');
});

test('entryOutPath uses gdscript extension', async () => {
  const plan = await buildGcnBuildPlan({ entryPath: '/project/main.gcn', projectRoot: '/project', entryDoc: createGeometryDocument('gdscript'), target: 'gdscript', readDoc, generate });
  assert.equal(plan.entryOutPath, 'main.gd');
});

test('planExportTargets maps nested paths', () => {
  const result = planExportTargets('/project/export', [{ outPath: 'lib/shapes.py', code: 'x' }], path.posix);
  assert.deepEqual(result, [{ target: '/project/export/lib/shapes.py', code: 'x', relFromFolder: 'lib/shapes.py' }]);
});

test('planExportTargets rejects escaping paths', () => {
  assert.throws(() => planExportTargets('/project/export', [{ outPath: '../outside.py', code: 'x' }], path.posix), /escapes/);
});

test('planExportTargets supports Windows paths', () => {
  const result = planExportTargets('C:/project/export', [{ outPath: 'lib/shapes.py', code: 'x' }], path.win32);
  assert.equal(result[0].target, ['C:', 'project', 'export', 'lib', 'shapes.py'].join(String.fromCharCode(92)));
  assert.equal(result[0].relFromFolder, ['lib', 'shapes.py'].join(String.fromCharCode(92)));
});

test('no-import plan entry code uses its importer directory', async () => {
  const doc = createGeometryDocument('python');
  const plan = await buildGcnBuildPlan({ entryPath: '/project/app/main.gcn', projectRoot: '/project', entryDoc: doc, target: 'python', readDoc, generate });
  const expected = generateGeometryCode(doc, 'python', { importerRelDir: 'app' }).code;
  assert.equal(plan.entryCode, expected);
});

test('no-import plan handles a document without a project root', async () => {
  const plan = await buildGcnBuildPlan({ entryPath: 'main.gcn', entryDoc: createGeometryDocument('python'), target: 'python', readDoc, generate });
  assert.equal(plan.entryOutPath, 'main.py');
});

test('import fixture helper creates a GCN document', () => {
  assert.equal(withImport().nodes[1].data.path, 'lib/shapes.gcn');
});
