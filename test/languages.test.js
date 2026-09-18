import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { CompletionContext, completeFromList } from '@codemirror/autocomplete';
import { gdscriptLanguage, languageExtension } from '../src/core/languages.js';

async function completionLabels(fileName, doc) {
  const state = EditorState.create({ doc, extensions: [languageExtension(fileName)] });
  const context = new CompletionContext(state, state.doc.length, false);
  const labels = new Set();
  for (const value of state.languageDataAt('autocomplete', state.doc.length)) {
    const source = Array.isArray(value) ? completeFromList(value) : value;
    const result = await source(context);
    for (const option of result?.options ?? []) labels.add(option.label);
  }
  return labels;
}

test('maps supported files to language extensions', () => {
  for (const fileName of ['player.gd', 'engine.CPP', 'widget.hpp', 'Program.cs', 'app.ts', 'page.html', 'test.py']) {
    const state = EditorState.create({ extensions: [languageExtension(fileName)] });
    assert.ok(state.languageDataAt('commentTokens', 0).length, `${fileName} should load a language`);
  }
  const plainText = EditorState.create({ extensions: [languageExtension('notes.txt')] });
  assert.equal(plainText.languageDataAt('commentTokens', 0).length, 0);
});

test('GDScript parser recognizes core tokens and multiline strings', () => {
  const tree = gdscriptLanguage.parser.parse('@export var speed: float = 2.0\nfunc move():\n\tvar text = """hello\nworld"""\n');
  const output = tree.toString();
  assert.match(output, /keyword/);
  assert.match(output, /typeName/);
  assert.match(output, /string/);
});

test('built-in completions work without language servers', async () => {
  assert.ok((await completionLabels('test.py', 'pri')).has('print'));
  assert.ok((await completionLabels('inventory.gd', 'pri')).has('print'));
  assert.ok((await completionLabels('main.cpp', 'pri')).has('printf'));
  assert.ok((await completionLabels('Program.cs', 'pri')).has('private'));
  assert.ok((await completionLabels('Program.cs', 'Con')).has('Console'));
});

test('local words are completed in GDScript, C++, and C#', async () => {
  for (const fileName of ['inventory.gd', 'main.cpp', 'Program.cs']) {
    assert.ok((await completionLabels(fileName, 'custom_player\ncus')).has('custom_player'));
  }
});
