import test from 'node:test';
import assert from 'node:assert/strict';
import { getPreviewStatus } from '../src/core/geometry-preview-status.js';

test('preview status uses the last good code for drafts when available', () => {
  assert.deepEqual(getPreviewStatus(true, false, true), {
    source: 'lastGood', message: 'Showing last valid preview'
  });
});

test('drafts without a last good code are blocked', () => {
  assert.deepEqual(getPreviewStatus(true, false, false), {
    source: 'none', message: 'Fix invalid input to see code.'
  });
});

test('preview status uses the last good code for document failures when available', () => {
  assert.deepEqual(getPreviewStatus(false, true, true), {
    source: 'lastGood', message: 'Showing last valid preview'
  });
});

test('document failures without a last good code are blocked', () => {
  assert.deepEqual(getPreviewStatus(false, true, false), {
    source: 'none', message: 'Graph has errors; nothing to preview yet.'
  });
});

test('a stray unused-node error still shows the current preview', () => {
  assert.deepEqual(getPreviewStatus(false, false, true), {
    source: 'current', message: ''
  });
});
