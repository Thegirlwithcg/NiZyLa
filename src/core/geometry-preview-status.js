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
