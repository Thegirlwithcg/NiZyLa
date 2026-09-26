import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryContextMenuItems } from '../src/core/geometry-context-menu.js';

test('geometry context menu model enables the correct actions', () => {
  const start = geometryContextMenuItems({ kind: 'node', selectedTypes: ['start'] });
  assert.equal(start.find((item) => item.id === 'copy').enabled, false);
  assert.equal(start.find((item) => item.id === 'paste').enabled, true);
  for (const types of [['print'], ['print', 'literal', 'binary']]) {
    assert.ok(geometryContextMenuItems({ kind: 'node', selectedTypes: types }).filter((item) => item.id !== 'paste').every((item) => item.enabled));
  }
  assert.deepEqual(geometryContextMenuItems({ kind: 'empty' }).map((item) => item.id), ['paste', 'add']);
});
