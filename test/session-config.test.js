import test from 'node:test';
import assert from 'node:assert/strict';
import { repathTab, serializeSessionState, validateRenameName, validateSessionState } from '../src/core/session-config.js';

const base = {
  version: 1, projects: ['C:/work'], activeProjectIndex: 0,
  panes: [{ id: 1, floating: false, floatRect: { x: 0, y: 0, width: 100, height: 100 }, tabs: [{ path: 'C:/work/a.py' }], active: 'C:/work/a.py' }], activePaneId: 1,
  graph: { visible: false, floating: false, floatRect: { x: 0, y: 0, width: 100, height: 100 }, viewMode: 'all', folderId: null },
  terminal: { visible: false, floating: false, floatRect: { x: 0, y: 0, width: 100, height: 100 } },
  layoutSize: { sidebar: 1, graph: 2, terminal: 3 }
};

test('session schema rejects malformed state', () => {
  assert.equal(validateSessionState(null).ok, false);
  assert.equal(validateSessionState({ ...base, version: 2 }).ok, false);
  assert.equal(validateSessionState({ ...base, panes: [{}] }).ok, false);
  assert.equal(validateSessionState(base).ok, true);
  assert.doesNotThrow(() => serializeSessionState(base));
});

test('repath updates the open tab basename after rename', () => {
  const tab = { id: 'C:/work/main.py', file: { path: 'C:/work/main.py', name: 'main.py', relativePath: 'main.py' } };
  const next = repathTab(tab, 'C:/work/main.py', 'C:/work/main2.py', 'main2.py');
  assert.equal(next.file.name, 'main2.py');
  assert.equal(next.file.path, 'C:/work/main2.py');
});

test('rename name validator accepts normal and case-only names', () => {
  for (const name of ['main2.py', 'A.py', 'file.with.dots']) assert.equal(validateRenameName(name).ok, true);
});

test('rename name validator rejects unsafe and reserved names', () => {
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*', 'a.', 'a ', 'CON', 'con.txt', 'LPT9.log', 'bad\u0001']) {
    assert.equal(validateRenameName(name).ok, false, name);
  }
});
