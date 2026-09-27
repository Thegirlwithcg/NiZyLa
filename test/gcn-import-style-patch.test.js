import assert from 'node:assert/strict';
import test from 'node:test';
import { gcnImportStylePatch } from '../src/core/geometry-editor.js';

test('switching an empty GCN module import to from imports *', () => {
  assert.deepEqual(gcnImportStylePatch({ style: 'module', names: [] }, 'from'), { style: 'from', names: [{ name: '*' }] });
});

test('switching a GCN module import to from keeps existing names', () => {
  const names = [{ name: 'Thing' }];
  assert.deepEqual(gcnImportStylePatch({ style: 'module', names }, 'from'), { style: 'from', names });
});

test('switching a GCN from import to module keeps names', () => {
  const names = [{ name: 'Thing' }];
  assert.deepEqual(gcnImportStylePatch({ style: 'from', names }, 'module'), { style: 'module', names });
});
