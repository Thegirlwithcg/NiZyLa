import test from 'node:test';
import assert from 'node:assert/strict';
import { GEOMETRY_FILE_RE, geometryExtension, isGeometryPath, normalizeGeometryTarget, targetForGeometryPath, withGeometryExtension } from '../src/core/geometry-files.js';

test('geometry file extensions identify new and legacy formats', () => {
  assert.equal(GEOMETRY_FILE_RE.test('main.gcpy'), true);
  assert.equal(isGeometryPath('logic.GCGD'), true);
  assert.equal(isGeometryPath('legacy.gcn'), true);
  assert.equal(isGeometryPath('main.py'), false);
  assert.equal(targetForGeometryPath('main.gcpy'), 'python');
  assert.equal(targetForGeometryPath('main.gcgd'), 'gdscript');
  assert.equal(targetForGeometryPath('legacy.gcn'), null);
  assert.equal(geometryExtension('python'), '.gcpy');
  assert.equal(geometryExtension('gdscript'), '.gcgd');
  assert.equal(withGeometryExtension('logic.gcn', 'python'), 'logic.gcpy');
  assert.equal(withGeometryExtension('logic', 'gdscript'), 'logic.gcgd');
});

test('normalizeGeometryTarget accepts only supported targets', () => {
  assert.equal(normalizeGeometryTarget('gdscript'), 'gdscript');
  assert.equal(normalizeGeometryTarget({ type: 'click' }), 'python');
  assert.equal(normalizeGeometryTarget(undefined), 'python');
  assert.equal(normalizeGeometryTarget('x'), 'python');
});
