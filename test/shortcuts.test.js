import test from 'node:test';
import assert from 'node:assert/strict';
import { isShortcut } from '../src/core/shortcuts.js';

test('shortcuts use physical codes with non-Latin keyboard layouts', () => {
  const thaiUndo = { key: 'ผ', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
  assert.equal(isShortcut(thaiUndo, 'KeyZ', { mod: true }), true);
  assert.equal(isShortcut({ ...thaiUndo, code: 'KeyC' }, 'KeyC', { mod: true }), true);
  assert.equal(isShortcut({ ...thaiUndo, code: 'KeyA', key: 'ฟ', ctrlKey: false, shiftKey: true }, 'KeyA', { shift: true }), true);
  assert.equal(isShortcut(thaiUndo, 'KeyZ', { mod: false }), false);
});
