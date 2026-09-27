import test from 'node:test';
import assert from 'node:assert/strict';
import { addMenuAnchor, geometryContextMenuItems, pointInRect } from '../src/core/geometry-context-menu.js';

test('pointInRect uses strict canvas bounds', () => {
  const rect = { left: 10, top: 20, width: 100, height: 80 };
  assert.equal(pointInRect({ x: 50, y: 60 }, rect), true);
  assert.equal(pointInRect({ x: 10, y: 60 }, rect), false);
  assert.equal(pointInRect({ x: 110, y: 60 }, rect), false);
  assert.equal(pointInRect(null, rect), false);
});

test('add menu anchor uses the pointer only when it is inside the canvas', () => {
  const canvasRect = { left: 10, top: 20, width: 100, height: 80 };
  assert.deepEqual(addMenuAnchor({ pointer: { x: 50, y: 60 }, canvasRect }), { x: 50, y: 60 });
  assert.deepEqual(addMenuAnchor({ pointer: { x: 10, y: 20 }, canvasRect }), { x: 60, y: 60 });
  assert.deepEqual(addMenuAnchor({ pointer: { x: 110, y: 100 }, canvasRect }), { x: 60, y: 60 });
  assert.deepEqual(addMenuAnchor({ pointer: null, canvasRect }), { x: 60, y: 60 });
});

test('geometry context menu model enables the correct actions', () => {
  const start = geometryContextMenuItems({ kind: 'node', selectedTypes: ['start'] });
  assert.equal(start.find((item) => item.id === 'copy').enabled, false);
  assert.equal(start.find((item) => item.id === 'convertToCode').enabled, false);
  assert.equal(start.find((item) => item.id === 'paste').enabled, true);
  for (const types of [['print'], ['print', 'literal', 'binary']]) {
    const items = geometryContextMenuItems({ kind: 'node', selectedTypes: types });
    assert.ok(items.filter((item) => item.id !== 'paste').every((item) => item.enabled));
    assert.equal(items.findIndex((item) => item.id === 'convertToCode'), items.findIndex((item) => item.id === 'duplicate') + 1);
  }
  assert.equal(geometryContextMenuItems({ kind: 'node', selectedTypes: ['start', 'print'] }).find((item) => item.id === 'convertToCode').enabled, true);
  assert.deepEqual(geometryContextMenuItems({ kind: 'empty' }).map((item) => item.id), ['paste', 'add']);
});
