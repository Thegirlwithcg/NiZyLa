import test from 'node:test';
import assert from 'node:assert/strict';
import { clampHighlightLines, planEditorUpdate } from '../src/core/editor-update.js';

const base = {
  path: 'preview.py', showLineNumbers: true, searchHighlight: '', searchLine: null,
  content: 'old', docText: 'old', highlightKey: '1,2'
};

 test('content and highlight changes are applied in order', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, content: 'new', docText: 'old', highlightKey: '2,3' }), ['replaceContent', 'setHighlights']);
});

test('content-only changes do not reveal search', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, content: 'new', docText: 'old' }), ['replaceContent', 'setHighlights']);
  assert.equal(planEditorUpdate(base, { ...base, content: 'new', docText: 'old' }).includes('revealSearch'), false);
});

test('highlight-only changes do not reveal search', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, highlightKey: '2,3' }), ['setHighlights']);
  assert.equal(planEditorUpdate(base, { ...base, highlightKey: '2,3' }).includes('revealSearch'), false);
});

test('searchLine changes reveal search without recreating the state', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, searchLine: 8 }), ['revealSearch']);
});

test('path changes set state and reveal search', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, path: 'other.py' }), ['setState', 'revealSearch']);
});

test('same highlight key with no content change does nothing', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base }), []);
});

test('same key with new content still replaces content', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, content: 'new', docText: 'old' }), ['replaceContent', 'setHighlights']);
});

test('path changes set state and reveal search', () => {
  assert.deepEqual(planEditorUpdate(base, { ...base, path: 'other.py', content: 'new', highlightKey: '9' }), ['setState', 'revealSearch']);
});

test('highlight lines are clamped to the document', () => {
  assert.deepEqual(clampHighlightLines([1, 3, 9, 0, -1], 3), [1, 3]);
});
