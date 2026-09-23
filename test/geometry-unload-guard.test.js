import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeometryDocument, serializeGeometryDocument, parseGeometryDocument } from '../src/core/geometry.js';
import { addNode, sameContent, sameDocument, setViewport, createEditorState } from '../src/core/geometry-editor.js';
import { generateGeometryCode } from '../src/core/geometry-codegen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSveltePath = path.join(__dirname, '..', 'src', 'App.svelte');
const mainJsPath = path.join(__dirname, '..', 'electron', 'main.js');

test('geometry dirty detection triggers beforeunload prevention cleanly', () => {
  const initialDoc = createGeometryDocument();
  let currentDoc = initialDoc;

  // Clean document -> not changed
  assert.equal(sameContent(currentDoc, initialDoc), true);
  assert.equal(sameDocument(currentDoc, initialDoc), true);

  const simulateBeforeUnload = (doc, baseline = initialDoc, hasDrafts = false) => {
    const isDirty = hasDrafts || !sameDocument(doc, baseline);
    const event = {
      defaultPrevented: false,
      returnValue: undefined,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    if (isDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
    return event;
  };

  const cleanEvent = simulateBeforeUnload(currentDoc);
  assert.equal(cleanEvent.defaultPrevented, false);
  assert.equal(cleanEvent.returnValue, undefined);

  // Edit document -> changed
  const editResult = addNode(currentDoc, 'int');
  currentDoc = editResult.doc;
  assert.equal(sameContent(currentDoc, initialDoc), false);
  assert.equal(sameDocument(currentDoc, initialDoc), false);

  const dirtyEvent = simulateBeforeUnload(currentDoc);
  assert.equal(dirtyEvent.defaultPrevented, true);
  assert.equal(dirtyEvent.returnValue, '');
});

test('sameDocument accurately compares content and viewport coordinates', () => {
  const doc1 = createGeometryDocument();
  const doc2 = JSON.parse(JSON.stringify(doc1));

  assert.equal(sameDocument(doc1, doc2), true);

  // Pan / zoom viewport only: sameContent is true, but sameDocument is false!
  const moved = { ...doc1, viewport: { x: 100, y: 200, zoom: 1.5 } };
  assert.equal(sameContent(doc1, moved), true, 'sameContent ignores viewport');
  assert.equal(sameDocument(doc1, moved), false, 'sameDocument requires matching viewport');

  // Move back to exact coordinates: sameDocument is true again!
  const movedBack = { ...moved, viewport: { ...doc1.viewport } };
  assert.equal(sameDocument(doc1, movedBack), true);

  // Edit node: both are false
  const nodeAdded = addNode(doc1, 'int').doc;
  assert.equal(sameContent(doc1, nodeAdded), false);
  assert.equal(sameDocument(doc1, nodeAdded), false);
});

test('src/App.svelte has no heuristic reload keys, flags, or renderer confirms', async () => {
  const content = await fs.readFile(appSveltePath, 'utf8');

  // No confirm() in renderer
  assert.doesNotMatch(content, /confirm\s*\(/, 'Renderer must not call confirm()');

  // No reloadKeyAt or noteReloadKey heuristics
  assert.doesNotMatch(content, /reloadKeyAt/, 'reloadKeyAt heuristic must be removed');
  assert.doesNotMatch(content, /noteReloadKey/, 'noteReloadKey heuristic must be removed');

  // No discardGeometry flag
  assert.doesNotMatch(content, /discardGeometry/, 'discardGeometry flag must be removed');

  // requestClose delegates to windowControl('close')
  assert.match(content, /function\s+requestClose\s*\(\)\s*\{\s*windowControl\('close'\);\s*\}/);

  // beforeunload checks geometryDirty and syncs unload state
  assert.match(content, /const\s+beforeUnload\s*=\s*\(event\)\s*=>\s*\{/);
  assert.match(content, /syncGeometryUnloadState/);
});

test('electron/main.js registers will-prevent-unload with synchronous dialog and proper action handling', async () => {
  const content = await fs.readFile(mainJsPath, 'utf8');

  // will-prevent-unload listener attached to mainWindow.webContents
  assert.match(content, /mainWindow\.webContents\.on\('will-prevent-unload',\s*\(event\)\s*=>\s*\{/);

  // Uses dialog.showMessageBoxSync attached to mainWindow
  assert.match(content, /dialog\.showMessageBoxSync\s*\(\s*mainWindow\s*,/);

  // Supports Save when file path is present, plus Discard and Cancel
  assert.match(content, /buttons:\s*\[['"]Save['"],\s*["']Don't Save["'],\s*['"]Cancel['"]\]/);

  // Supports multi-document Save all
  assert.match(content, /buttons:\s*\[['"]Save All['"],\s*['"]Discard All['"],\s*['"]Cancel['"]\]/);

  // Also supports Cancel and Discard when scratch or drafts
  assert.match(content, /buttons:\s*\[['"]Cancel['"],\s*["']Don't Save["']\]/);
  assert.match(content, /buttons:\s*\[['"]Cancel['"],\s*['"]Discard All['"]\]/);

  // No window.close() or location.reload() inside will-prevent-unload
  const willPreventUnloadBlock = content.match(/mainWindow\.webContents\.on\('will-prevent-unload'[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(willPreventUnloadBlock, 'will-prevent-unload block must exist');
  assert.doesNotMatch(willPreventUnloadBlock, /close\(\)/);
  assert.doesNotMatch(willPreventUnloadBlock, /reload\(\)/);
});

test('will-prevent-unload handler semantics: Save writes and unloads, Discard unloads, Cancel keeps page', () => {
  function handleWillPreventUnload(snapshot, event, showMessageBoxSync, writeSync) {
    const canSave = snapshot && snapshot.filePath && !snapshot.hasDrafts && snapshot.document;

    if (canSave) {
      const choice = showMessageBoxSync({
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2
      });
      if (choice === 0) {
        try {
          writeSync(snapshot.filePath, serializeGeometryDocument(snapshot.document));
          event.preventDefault();
        } catch (_) {}
      } else if (choice === 1) {
        event.preventDefault();
      }
    } else {
      const choice = showMessageBoxSync({
        type: 'warning',
        buttons: ['Cancel', "Don't Save"],
        defaultId: 0,
        cancelId: 0
      });
      if (choice === 1) {
        event.preventDefault();
      }
    }
  }

  const validDoc = createGeometryDocument();

  // Case 1: canSave -> Save (index 0) succeeds
  {
    let preventDefaultCalled = false;
    let written = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: false },
      event,
      () => 0,
      () => { written = true; }
    );
    assert.equal(written, true, 'Save must write the file');
    assert.equal(preventDefaultCalled, true, 'Save success must allow unload');
  }

  // Case 2: canSave -> Save fails (writeSync throws)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: false },
      event,
      () => 0,
      () => { throw new Error('Write failed'); }
    );
    assert.equal(preventDefaultCalled, false, 'Save failure must abort unload');
  }

  // Case 3: canSave -> Discard (index 1)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: false },
      event,
      () => 1,
      () => {}
    );
    assert.equal(preventDefaultCalled, true, 'Discard must allow unload without saving');
  }

  // Case 4: canSave -> Cancel (index 2)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: false },
      event,
      () => 2,
      () => {}
    );
    assert.equal(preventDefaultCalled, false, 'Cancel must abort unload');
  }

  // Case 5: hasDrafts -> Discard (index 1)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: true },
      event,
      () => 1,
      () => {}
    );
    assert.equal(preventDefaultCalled, true, 'Drafts Discard must allow unload');
  }

  // Case 6: hasDrafts -> Cancel (index 0)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(
      { filePath: '/project/test.gcn', document: validDoc, hasDrafts: true },
      event,
      () => 0,
      () => {}
    );
    assert.equal(preventDefaultCalled, false, 'Drafts Cancel must abort unload');
  }
});

test('multi-document unload guard handles 2+ dirty graphs correctly', () => {
  function handleMultiWillPreventUnload(docs, event, showMessageBoxSync, writeSync) {
    const canSaveAll = docs.every((d) => d.filePath && !d.hasDrafts && d.document);
    if (canSaveAll) {
      const choice = showMessageBoxSync({
        type: 'warning',
        buttons: ['Save All', 'Discard All', 'Cancel'],
        defaultId: 0,
        cancelId: 2
      });
      if (choice === 0) {
        try {
          for (const docItem of docs) {
            writeSync(docItem.filePath, serializeGeometryDocument(docItem.document));
          }
          event.preventDefault();
        } catch (_) {}
      } else if (choice === 1) {
        event.preventDefault();
      }
    } else {
      const choice = showMessageBoxSync({
        type: 'warning',
        buttons: ['Cancel', 'Discard All'],
        defaultId: 0,
        cancelId: 0
      });
      if (choice === 1) {
        event.preventDefault();
      }
    }
  }

  const docA = createGeometryDocument();
  const docB = createGeometryDocument();
  const docsAllSaveable = [
    { filePath: '/project/a.gcn', document: docA, hasDrafts: false },
    { filePath: '/project/b.gcn', document: docB, hasDrafts: false }
  ];

  // 1: Save all (choice 0) -> writes all, calls preventDefault
  {
    const written = [];
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsAllSaveable, event, () => 0, (p) => written.push(p));
    assert.deepEqual(written, ['/project/a.gcn', '/project/b.gcn']);
    assert.equal(preventDefaultCalled, true);
  }

  // 2: Save all fails on second file -> aborts unload
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsAllSaveable, event, () => 0, (p) => {
      if (p.includes('b.gcn')) throw new Error('write failed');
    });
    assert.equal(preventDefaultCalled, false);
  }

  // 3: Discard all (choice 1)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsAllSaveable, event, () => 1, () => {});
    assert.equal(preventDefaultCalled, true);
  }

  // 4: Cancel (choice 2)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsAllSaveable, event, () => 2, () => {});
    assert.equal(preventDefaultCalled, false);
  }

  // 5: Scratch tab or draft present -> buttons are ['Cancel', 'Discard All']
  const docsWithScratch = [
    { filePath: null, document: docA, hasDrafts: false },
    { filePath: '/project/b.gcn', document: docB, hasDrafts: false }
  ];
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsWithScratch, event, () => 1, () => {});
    assert.equal(preventDefaultCalled, true, 'Discard all allows unload');
  }
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleMultiWillPreventUnload(docsWithScratch, event, () => 0, () => {});
    assert.equal(preventDefaultCalled, false, 'Cancel aborts unload');
  }
});

