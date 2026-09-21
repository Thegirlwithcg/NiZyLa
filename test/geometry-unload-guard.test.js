import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeometryDocument } from '../src/core/geometry.js';
import { addNode, sameContent } from '../src/core/geometry-editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSveltePath = path.join(__dirname, '..', 'src', 'App.svelte');
const mainJsPath = path.join(__dirname, '..', 'electron', 'main.js');

test('geometry dirty detection triggers beforeunload prevention cleanly', () => {
  const initialDoc = createGeometryDocument();
  let currentDoc = initialDoc;

  // Clean document -> not changed
  assert.equal(sameContent(currentDoc, initialDoc), true);

  const simulateBeforeUnload = (doc) => {
    const isChanged = !sameContent(doc, initialDoc);
    const event = {
      defaultPrevented: false,
      returnValue: undefined,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    if (isChanged) {
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

  const dirtyEvent = simulateBeforeUnload(currentDoc);
  assert.equal(dirtyEvent.defaultPrevented, true);
  assert.equal(dirtyEvent.returnValue, '');
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

  // beforeunload only prevents unload when geometryChanged is true
  assert.match(content, /const\s+beforeUnload\s*=\s*\(event\)\s*=>\s*\{\s*if\s*\(!geometryChanged\)\s*return;\s*event\.preventDefault\(\);\s*event\.returnValue\s*=\s*'';\s*\};/);
});

test('electron/main.js registers will-prevent-unload with synchronous dialog and proper action handling', async () => {
  const content = await fs.readFile(mainJsPath, 'utf8');

  // will-prevent-unload listener attached to mainWindow.webContents
  assert.match(content, /mainWindow\.webContents\.on\('will-prevent-unload',\s*\(event\)\s*=>\s*\{/);

  // Uses dialog.showMessageBoxSync attached to mainWindow
  assert.match(content, /dialog\.showMessageBoxSync\s*\(\s*mainWindow\s*,/);

  // Check buttons, defaultId, cancelId
  assert.match(content, /buttons:\s*\[['"]ยกเลิก['"],\s*['"]ทิ้งกราฟ['"]\]/);
  assert.match(content, /defaultId:\s*0/);
  assert.match(content, /cancelId:\s*0/);

  // Check message covers both closing and reloading
  assert.match(content, /รีโหลด/);
  assert.match(content, /ปิด/);

  // Calls event.preventDefault() only when choice === 1 (ทิ้งกราฟ)
  assert.match(content, /if\s*\(\s*choice\s*===\s*1\s*\)\s*\{\s*event\.preventDefault\(\);\s*\}/);

  // No window.close() or location.reload() inside will-prevent-unload
  const willPreventUnloadBlock = content.match(/mainWindow\.webContents\.on\('will-prevent-unload'[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(willPreventUnloadBlock, 'will-prevent-unload block must exist');
  assert.doesNotMatch(willPreventUnloadBlock, /close\(\)/);
  assert.doesNotMatch(willPreventUnloadBlock, /reload\(\)/);
});

test('will-prevent-unload handler semantics: Discard unloads, Cancel keeps page', () => {
  function handleWillPreventUnload(event, showMessageBoxSync) {
    const choice = showMessageBoxSync({
      type: 'warning',
      buttons: ['ยกเลิก', 'ทิ้งกราฟ'],
      defaultId: 0,
      cancelId: 0,
      title: 'NiZyLa',
      message: 'มีกราฟทดลองที่ยังไม่ได้บันทึก',
      detail: 'หากปิดหน้าต่างหรือรีโหลด การเปลี่ยนแปลงทั้งหมดจะหายไป ต้องการทิ้งกราฟหรือไม่?'
    });
    if (choice === 1) {
      event.preventDefault();
    }
  }

  // Case 1: User chooses Cancel (index 0)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(event, () => 0);
    assert.equal(preventDefaultCalled, false, 'Cancel must NOT call event.preventDefault() so unload remains prevented');
  }

  // Case 2: User chooses Discard (index 1)
  {
    let preventDefaultCalled = false;
    const event = { preventDefault: () => { preventDefaultCalled = true; } };
    handleWillPreventUnload(event, () => 1);
    assert.equal(preventDefaultCalled, true, 'Discard MUST call event.preventDefault() to allow the original unload (close or reload)');
  }
});
