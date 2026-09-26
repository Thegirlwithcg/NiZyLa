export const SESSION_VERSION = 1;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_NAME = /[\\/<>:"|?*\u0000-\u001f]/;

export function validateRenameName(value) {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, error: 'Name must not be empty.' };
  if (value.length > 255) return { ok: false, error: 'Name must be 255 characters or fewer.' };
  if (value === '.' || value === '..') return { ok: false, error: 'Name cannot be . or ..' };
  if (INVALID_NAME.test(value)) return { ok: false, error: 'Name contains an invalid character.' };
  if (/[. ]$/.test(value)) return { ok: false, error: 'Name cannot end with a dot or space.' };
  if (WINDOWS_RESERVED.test(value)) return { ok: false, error: 'That name is reserved by Windows.' };
  return { ok: true };
}

function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function rect(value) {
  return value && ['x', 'y', 'width', 'height'].every((key) => finiteNumber(value[key]))
    && (value.maximized === undefined || typeof value.maximized === 'boolean');
}

export function validateSessionState(state) {
  if (!state || typeof state !== 'object' || state.version !== SESSION_VERSION) return { ok: false, error: 'Unsupported session version.' };
  if (!Array.isArray(state.projects) || state.projects.some((p) => typeof p !== 'string')) return { ok: false, error: 'Invalid session projects.' };
  if (!Number.isInteger(state.activeProjectIndex) || state.activeProjectIndex < 0) return { ok: false, error: 'Invalid active project index.' };
  if (!Array.isArray(state.panes) || state.panes.some((pane) => !pane || !Number.isInteger(pane.id) || typeof pane.floating !== 'boolean' || !rect(pane.floatRect) || !Array.isArray(pane.tabs) || pane.tabs.some((tab) => !tab || typeof tab.path !== 'string') || (pane.active !== null && typeof pane.active !== 'string'))) return { ok: false, error: 'Invalid session panes.' };
  if (!Number.isInteger(state.activePaneId)) return { ok: false, error: 'Invalid active pane.' };
  const graph = state.graph;
  if (!graph || typeof graph.visible !== 'boolean' || typeof graph.floating !== 'boolean' || !rect(graph.floatRect) || !['folder', 'all'].includes(graph.viewMode) || (graph.folderId !== null && typeof graph.folderId !== 'string')) return { ok: false, error: 'Invalid session graph.' };
  const terminal = state.terminal;
  if (!terminal || typeof terminal.visible !== 'boolean' || typeof terminal.floating !== 'boolean' || !rect(terminal.floatRect)) return { ok: false, error: 'Invalid session terminal.' };
  if (!state.layoutSize || !['sidebar', 'graph', 'terminal'].every((key) => finiteNumber(state.layoutSize[key]))) return { ok: false, error: 'Invalid session layout.' };
  return { ok: true };
}

export function repathTab(tab, oldPath, newPath, newRelativePath) {
  if (!tab?.file?.path || !tab.file.path.startsWith(oldPath)) return tab;
  const suffix = tab.file.path.slice(oldPath.length);
  const relativeSuffix = suffix.replace(/^[/\\]/, '').replace(/\\/g, '/');
  const nextPath = `${newPath}${suffix}`;
  return {
    ...tab,
    id: nextPath,
    file: { ...tab.file, path: nextPath, name: nextPath.split(/[\\/]/).pop(), relativePath: [newRelativePath, relativeSuffix].filter(Boolean).join('/') }
  };
}

export function serializeSessionState(state) {
  const result = validateSessionState(state);
  if (!result.ok) throw new Error(result.error);
  const content = JSON.stringify(state, null, 2);
  if (new TextEncoder().encode(content).byteLength > 256 * 1024) throw new Error('Session state exceeds the 256 KB limit.');
  return content;
}
