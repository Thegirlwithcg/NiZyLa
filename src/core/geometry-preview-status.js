function indentation(text) {
  return (text.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
}

function isBlockHeader(text) {
  return text.replace(/\s*#.*$/, '').trimEnd().endsWith(':');
}

export function previewLinesForNodes({ code = '', sourceMap = [] } = {}, nodeIds = []) {
  const wanted = new Set(nodeIds);
  const lines = String(code).split('\n');
  const highlighted = new Set(sourceMap
    .filter((entry) => wanted.has(entry.nodeId) && Number.isInteger(entry.line) && entry.line > 0)
    .map((entry) => entry.line));

  for (const headerLine of [...highlighted]) {
    const text = lines[headerLine - 1];
    if (text === undefined || !isBlockHeader(text)) continue;
    const headerIndent = indentation(text);
    for (let index = headerLine; index < lines.length; index++) {
      const current = lines[index];
      if (!current.trim()) {
        let next = index + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next >= lines.length || indentation(lines[next]) <= headerIndent) break;
        highlighted.add(index + 1);
        continue;
      }
      if (indentation(current) <= headerIndent) break;
      highlighted.add(index + 1);
    }
  }
  return [...highlighted].sort((a, b) => a - b);
}

export function getPreviewStatus(hasDrafts, docLevelFailure, lastGoodExists) {
  const blockedBy = hasDrafts ? 'drafts' : docLevelFailure ? 'document' : null;

  if (!blockedBy) return { source: 'current', message: '' };
  if (lastGoodExists) return { source: 'lastGood', message: 'Showing last valid preview' };
  return {
    source: 'none',
    message: blockedBy === 'drafts'
      ? 'Fix invalid input to see code.'
      : 'Graph has errors; nothing to preview yet.'
  };
}
