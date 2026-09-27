export function clampHighlightLines(lines = [], docLines = 0) {
  return [...new Set((Array.isArray(lines) ? lines : [])
    .filter((line) => Number.isInteger(line) && line > 0 && line <= docLines))]
    .sort((a, b) => a - b);
}

export function planEditorUpdate(prev, next) {
  const stateChanged = prev.path !== next.path
    || prev.showLineNumbers !== next.showLineNumbers
    || prev.searchHighlight !== next.searchHighlight;
  const searchChanged = stateChanged || prev.searchLine !== next.searchLine;
  if (stateChanged) return ['setState', ...(searchChanged ? ['revealSearch'] : [])];

  const contentReplaced = next.content !== next.docText;
  const highlightsChanged = prev.highlightKey !== next.highlightKey;
  const actions = [];
  if (contentReplaced) actions.push('replaceContent');
  if (highlightsChanged || contentReplaced) actions.push('setHighlights');
  if (searchChanged) actions.push('revealSearch');
  return actions;
}
