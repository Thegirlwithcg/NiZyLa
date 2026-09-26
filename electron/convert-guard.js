export const CONVERT_LIMITS = Object.freeze({
  maxSourceBytes: 1_000_000,
  maxSourceLines: 20_000,
  maxNodesTotal: 1500,
  maxNodesPerScope: 300,
  parseTimeoutMs: 15_000,
  convertTimeoutMs: 10_000
});

export function countDocumentNodes(document) {
  let total = 0;
  let largestScope = 0;
  function visit(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return;
    largestScope = Math.max(largestScope, graph.nodes.length);
    total += graph.nodes.length;
    for (const node of graph.nodes) visit(node?.data?.graph);
  }
  visit(document);
  return { total, largestScope };
}

export function preflightConversion(document, schemaDiagnostics) {
  const diagnostics = schemaDiagnostics(document);
  if (diagnostics.length) return { ok: false, reason: 'invalid-output', details: diagnostics.slice(0, 5) };
  const counts = countDocumentNodes(document);
  if (counts.total > CONVERT_LIMITS.maxNodesTotal || counts.largestScope > CONVERT_LIMITS.maxNodesPerScope) {
    return { ok: false, reason: 'too-large', counts };
  }
  return { ok: true, counts };
}
