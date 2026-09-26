import { nodeDefinitions } from './geometry.js';

// Conservative CSS measurements from GeometryNode.svelte (padding, header, form and handles included).
// The table intentionally errs high so an unmeasured graph never overlaps after mounting.
export const NODE_SIZE_ESTIMATES = {
  start: [300, 112], literal: [300, 154], getVariable: [360, 190], setVariable: [330, 154],
  binary: [300, 170], compare: [300, 170], boolean: [300, 170], if: [330, 154], while: [330, 154],
  forRange: [350, 190], forEach: [350, 170], break: [300, 112], continue: [300, 112], print: [330, 154],
  formatText: [360, 190], list: [330, 190], array: [330, 190], dict: [360, 220], getItem: [330, 170],
  setItem: [350, 190], append: [350, 170], length: [300, 154], contains: [340, 170], convert: [320, 154],
  input: [340, 154], functionDef: [430, 330], parameter: [330, 154], return: [300, 154], classDef: [430, 250],
  functionCall: [380, 220], instantiate: [380, 190], import: [380, 180], symbolRef: [300, 140], getMember: [330, 170],
  setMember: [350, 190], codeNode: [430, 180]
};
const H_GAP = 60, V_GAP = 24, MAX_COLUMNS = 6;
export function estimateNodeSize(node) {
  const [width, base] = NODE_SIZE_ESTIMATES[node?.type] || [360, 180];
  if (node?.type === 'codeNode') return { width, height: Math.max(base, String(node.data?.code || '').split('\n').length * 24 + 90) };
  return { width, height: base };
}
const sizeOf = (n, sizes) => {
  const measured = sizes?.get?.(n.id) || sizes?.[n.id];
  return measured?.width && measured?.height ? { width: measured.width, height: measured.height } : estimateNodeSize(n);
};
const box = (n, sizes) => ({ x: n.position.x, y: n.position.y, ...sizeOf(n, sizes) });
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Layout one graph and every nested graph. Positions are deterministic for a fixed graph. */
export function layoutGraph(graph, sizes = null) {
  if (!graph?.nodes?.length) return graph;
  const nodes = graph.nodes, byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const incoming = (id, handles) => edges.filter((e) => e.target === id && handles.includes(e.targetHandle));
  const outgoing = (id, handle) => edges.find((e) => e.source === id && e.sourceHandle === handle)?.target;
  const placed = new Set();
  const start = byId.get('start');
  const columnWidth = Math.max(...nodes.map((n) => sizeOf(n, sizes).width), 360);
  const rowHeight = Math.max(...nodes.map((n) => sizeOf(n, sizes).height), 180);

  function valueEdges(id) {
    return edges.filter((e) => e.target === id && !['in', 'next', 'then', 'else', 'body'].includes(e.targetHandle)
      && e.sourceHandle !== 'exec').sort((a, b) => String(a.targetHandle).localeCompare(String(b.targetHandle)));
  }
  function valueHeight(node, seen = new Set()) {
    if (!node || seen.has(node.id)) return 0;
    seen.add(node.id);
    const children = valueEdges(node.id).map((e) => byId.get(e.source)).filter(Boolean);
    const own = sizeOf(node, sizes).height;
    return Math.max(own, children.reduce((sum, child) => sum + valueHeight(child, seen) + V_GAP, -V_GAP));
  }
  function placeValueTree(node, x, y, seen = new Set()) {
    if (!node || seen.has(node.id)) return sizeOf(node, sizes).height;
    seen.add(node.id);
    const children = valueEdges(node.id).map((e) => byId.get(e.source)).filter(Boolean);
    let nextY = y;
    for (const child of children) {
      const h = valueHeight(child);
      placeValueTree(child, x - sizeOf(child, sizes).width - H_GAP, nextY + Math.max(0, (h - sizeOf(child, sizes).height) / 2), seen);
      nextY += h + V_GAP;
    }
    const s = sizeOf(node, sizes);
    node.position = { x, y: children.length ? (y + nextY - V_GAP) / 2 - s.height / 2 : y };
    placed.add(node.id);
    return Math.max(s.height, nextY - y - V_GAP);
  }

  function layoutSequence(firstId, originX, originY, depth = 0) {
    let id = firstId, index = 0, safety = 0, forcedY = null, forcedX = null, sequenceBottom = originY;
    while (id && safety++ < nodes.length * 2) {
      const node = byId.get(id);
      if (!node || placed.has(id)) break;
      const s = sizeOf(node, sizes);
      const column = index % MAX_COLUMNS;
      const row = Math.floor(index / MAX_COLUMNS);
      node.position = { x: forcedX ?? originX + column * (columnWidth + H_GAP), y: forcedY ?? originY + row * (rowHeight + V_GAP) };
      forcedX = null; forcedY = null;
      placed.add(id);
      sequenceBottom = Math.max(sequenceBottom, node.position.y + s.height);
      // Branch bodies are below their owner and start one column to the right.
      const branchBottoms = [];
      for (const handle of ['then', 'else', 'body']) {
        const child = outgoing(id, handle);
        if (child) branchBottoms.push(layoutSequence(child, node.position.x + s.width + H_GAP, node.position.y + s.height + V_GAP, depth + 1));
      }
      const next = outgoing(id, 'next');
      // Continue after the largest block bounding box; never place it over a body.
      if (next && branchBottoms.length) {
        const nextNode = byId.get(next);
        if (nextNode && !placed.has(next)) {
          forcedX = node.position.x + s.width + H_GAP;
          forcedY = Math.max(node.position.y + s.height, ...branchBottoms) + V_GAP;
        }
      }
      id = next;
      index++;
    }
    return sequenceBottom;
  }
  for (const node of nodes) node.position = { x: 0, y: 0 };
  if (start) layoutSequence(start.id, 40, 40);
  // Disconnected nodes still receive stable positions.
  let extra = 0;
  for (const node of nodes) if (!placed.has(node.id)) {
    node.position = { x: 40 + (extra++ % MAX_COLUMNS) * (sizeOf(node, sizes).width + H_GAP), y: 40 + Math.floor(extra / MAX_COLUMNS) * 220 };
    placed.add(node.id);
  }
  // Put value inputs left of their consumer, with sibling subtree heights accumulated.
  for (const consumer of nodes) {
    let y = consumer.position.y;
    for (const edge of valueEdges(consumer.id)) {
      const source = byId.get(edge.source);
      if (!source) continue;
      const h = valueHeight(source);
      placeValueTree(source, consumer.position.x - sizeOf(source, sizes).width - H_GAP, y + (sizeOf(consumer, sizes).height - h) / 2);
      y += h + V_GAP;
    }
  }
  // Final deterministic collision pass. Only moves boxes down, preserving left-to-right order.
  const ordered = nodes.slice().sort((a, b) => (a.position.x - b.position.x) || (a.position.y - b.position.y) || String(a.id).localeCompare(String(b.id)));
  const occupied = [];
  for (const node of ordered) {
    const s = sizeOf(node, sizes);
    while (occupied.some((other) => intersects({ x: node.position.x, y: node.position.y, width: s.width, height: s.height }, other))) node.position.y += s.height + V_GAP;
    occupied.push(box(node, sizes));
  }
  for (const node of nodes) if (node.data?.graph) layoutGraph(node.data.graph, sizes);
  return graph;
}
