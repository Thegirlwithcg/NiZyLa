/** Match a physical keyboard shortcut, independent of the active keyboard layout. */
export function isShortcut(event, code, { mod = false, shift = false, alt = false } = {}) {
  if (!event || event.code !== code) return false;
  const hasMod = Boolean(event.ctrlKey || event.metaKey);
  return hasMod === mod && Boolean(event.shiftKey) === shift && Boolean(event.altKey) === alt;
}
