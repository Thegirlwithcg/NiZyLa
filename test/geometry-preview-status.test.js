import test from 'node:test';
import assert from 'node:assert/strict';
import { getPreviewStatus, previewLinesForNodes } from '../src/core/geometry-preview-status.js';

const pythonPreviewFixture = {
  code: [
    '# commented node',
    'def outer():',
    '    if condition:',
    '        work()',
    '    else:',
    '        other()',
    '',
    'class Thing:',
    '    def run(self):',
    '        return 1',
    '',
    'multi_line_code(',
    '    value)',
    ''
  ].join('\n'),
  sourceMap: [
    { line: 1, nodeId: 'commented' },
    { line: 2, nodeId: 'outer' },
    { line: 3, nodeId: 'if' },
    { line: 4, nodeId: 'if-body' },
    { line: 5, nodeId: 'if' },
    { line: 6, nodeId: 'else-body' },
    { line: 8, nodeId: 'class' },
    { line: 9, nodeId: 'method' },
    { line: 10, nodeId: 'method-body' },
    { line: 12, nodeId: 'multi' },
    { line: 13, nodeId: 'multi' }
  ]
};

const gdscriptPreviewFixture = {
  code: ['func run():', '    if ready:', '        pass', '    return', '', 'func _ready():', '    run()'].join('\n'),
  sourceMap: [
    { line: 1, nodeId: 'run' },
    { line: 2, nodeId: 'if' },
    { line: 3, nodeId: 'if-body' },
    { line: 4, nodeId: 'run-return' },
    { line: 6, nodeId: 'ready' },
    { line: 7, nodeId: 'ready-body' }
  ]
};

test('preview line highlighting covers comments, blocks, multiline nodes, and multi-select', () => {
  assert.deepEqual(previewLinesForNodes(pythonPreviewFixture, ['commented']), [1]);
  assert.deepEqual(previewLinesForNodes(pythonPreviewFixture, ['if']), [3, 4, 5, 6]);
  assert.deepEqual(previewLinesForNodes(pythonPreviewFixture, ['outer']), [2, 3, 4, 5, 6]);
  assert.deepEqual(previewLinesForNodes(pythonPreviewFixture, ['multi']), [12, 13]);
  assert.deepEqual(previewLinesForNodes(pythonPreviewFixture, ['if', 'multi', 'commented']), [1, 3, 4, 5, 6, 12, 13]);
});

test('preview line highlighting handles GDScript function blocks', () => {
  assert.deepEqual(previewLinesForNodes(gdscriptPreviewFixture, ['run']), [1, 2, 3, 4]);
  assert.deepEqual(previewLinesForNodes(gdscriptPreviewFixture, ['ready']), [6, 7]);
});

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
