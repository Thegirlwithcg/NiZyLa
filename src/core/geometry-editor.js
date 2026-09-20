import { getNodePorts, nodeDefinitions, validateGeometryDocument } from './geometry.js';

// Pure document editing + history for the Geometry Code UI. No DOM, no Svelte Flow objects:
// every function takes a plain .gcn document and returns a new one (inputs are never mutated).

export const HISTORY_LIMIT = 100;
export const defaultValues = { int: 0, float: 0, string: '', bool: false };

// Content = everything except the viewport; pan/zoom never counts as an edit.
export const contentKey = (doc) => JSON.stringify([doc.target,
  doc.variables.map(({ id, name, type, initialValue }) => [id, name, type, initialValue]),
  doc.nodes.map(({ id, type, position, data }) => [id, type, position.x, position.y,
    Object.keys(nodeDefinitions[type].defaults).map((key) => data[key])]),
  doc.edges.map(({ id, source, sourceHandle, target, targetHandle }) => [id, source, sourceHandle, target, targetHandle])]);
export const sameContent = (a, b) => a === b || contentKey(a) === contentKey(b);

// ---- history ----------------------------------------------------------------------------------

export function createEditorState(doc) {
  return { present: doc, past: [], future: [], pending: null };
}

/** Ends a live edit (typing/dragging): one history entry if anything changed. */
export function endEdit(state) {
  if (!state.pending) return state;
  const changed = !sameContent(state.pending, state.present);
  return { ...state, pending: null, past: changed ? [...state.past, state.pending].slice(-HISTORY_LIMIT) : state.past };
}

/** live=true groups repeated edits into a single transaction until endEdit(). */
export function applyEdit(state, next, live = false) {
  if (sameContent(next, state.present)) return next.viewport === state.present.viewport ? state : { ...state, present: next };
  if (live) return { ...state, present: next, future: [], pending: state.pending ?? state.present };
  const base = endEdit(state);
  return { ...base, past: [...base.past, base.present].slice(-HISTORY_LIMIT), present: next, future: [], pending: null };
}

export function undo(state) {
  const s = endEdit(state);
  if (!s.past.length) return s;
  return { present: { ...s.past.at(-1), viewport: s.present.viewport }, past: s.past.slice(0, -1), future: [...s.future, s.present], pending: null };
}

export function redo(state) {
  const s = endEdit(state);
  if (!s.future.length) return s;
  return { present: { ...s.future.at(-1), viewport: s.present.viewport }, past: [...s.past, s.present].slice(-HISTORY_LIMIT), future: s.future.slice(0, -1), pending: null };
}

export function setViewport(state, viewport) {
  const { x, y, zoom } = state.present.viewport;
  if (x === viewport.x && y === viewport.y && zoom === viewport.zoom) return state;
  return { ...state, present: { ...state.present, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } } };
}

// ---- node presets -----------------------------------------------------------------------------

const preset = (id, label, category, type, data = {}) => ({ id, label, category, type, data });
export const nodePresets = [
  preset('int', 'Integer', 'Value', 'literal', { valueType: 'int', value: 0 }),
  preset('float', 'Float', 'Value', 'literal', { valueType: 'float', value: 0 }),
  preset('string', 'String', 'Value', 'literal', { valueType: 'string', value: '' }),
  preset('bool', 'Boolean', 'Value', 'literal', { valueType: 'bool', value: false }),
  preset('get', 'Get Variable', 'Variable', 'getVariable'),
  preset('set', 'Set Variable', 'Variable', 'setVariable'),
  preset('add', 'Add', 'Math', 'binary', { operator: '+' }),
  preset('subtract', 'Subtract', 'Math', 'binary', { operator: '-' }),
  preset('multiply', 'Multiply', 'Math', 'binary', { operator: '*' }),
  preset('divide', 'Divide', 'Math', 'binary', { operator: '/' }),
  preset('equal', 'Equal', 'Logic', 'compare', { operator: '==' }),
  preset('not-equal', 'Not Equal', 'Logic', 'compare', { operator: '!=' }),
  preset('less', 'Less', 'Logic', 'compare', { operator: '<' }),
  preset('less-equal', 'Less or Equal', 'Logic', 'compare', { operator: '<=' }),
  preset('greater', 'Greater', 'Logic', 'compare', { operator: '>' }),
  preset('greater-equal', 'Greater or Equal', 'Logic', 'compare', { operator: '>=' }),
  preset('and', 'And', 'Logic', 'boolean', { operator: 'and' }),
  preset('or', 'Or', 'Logic', 'boolean', { operator: 'or' }),
  preset('not', 'Not', 'Logic', 'boolean', { operator: 'not' }),
  preset('if', 'If / Else', 'Control', 'if'),
  preset('for', 'For Range', 'Control', 'forRange'),
  preset('while', 'While', 'Control', 'while'),
  preset('print', 'Print', 'Output', 'print')
];

const uuid = () => globalThis.crypto.randomUUID();
const finitePoint = (p) => ({ x: Number.isFinite(p?.x) ? Math.round(p.x) : 0, y: Number.isFinite(p?.y) ? Math.round(p.y) : 0 });

/** Returns { doc, nodeId } or null for an unknown preset. Start is never offered. */
export function addNode(doc, presetId, position) {
  const item = nodePresets.find((p) => p.id === presetId);
  if (!item) return null;
  const data = { ...nodeDefinitions[item.type].defaults, ...item.data };
  if (item.type === 'getVariable' || item.type === 'setVariable') data.variableId = doc.variables[0]?.id ?? '';
  if (item.type === 'forRange') data.variableId = doc.variables.find((v) => v.type === 'int')?.id ?? '';
  const node = { id: uuid(), type: item.type, position: finitePoint(position), data };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, nodeId: node.id };
}

/** Deletes nodes (never Start) and every wire touching them, plus explicitly listed wires. */
export function removeItems(doc, { nodeIds = [], edgeIds = [] } = {}) {
  const gone = new Set(nodeIds.filter((id) => doc.nodes.find((n) => n.id === id)?.type !== 'start'));
  const wires = new Set(edgeIds);
  const nodes = doc.nodes.filter((n) => !gone.has(n.id));
  const edges = doc.edges.filter((e) => !wires.has(e.id) && !gone.has(e.source) && !gone.has(e.target));
  return nodes.length === doc.nodes.length && edges.length === doc.edges.length ? null : { ...doc, nodes, edges };
}

export function moveNodes(doc, positions) {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    const p = positions[node.id];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return node;
    if (p.x === node.position.x && p.y === node.position.y) return node;
    changed = true;
    return { ...node, position: { x: p.x, y: p.y } };
  });
  return changed ? { ...doc, nodes } : null;
}

/** Applies a data patch. Wires attached to ports that no longer exist are removed in the same step. */
export function setNodeData(doc, nodeId, patch) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const next = { ...node, data: { ...node.data, ...patch } };
  const ports = new Set(getNodePorts(next, doc.variables).map((p) => p.id));
  const removedEdges = doc.edges.filter((e) => (e.target === nodeId && !ports.has(e.targetHandle))
    || (e.source === nodeId && !ports.has(e.sourceHandle)));
  const removed = new Set(removedEdges);
  return {
    doc: { ...doc, nodes: doc.nodes.map((n) => n === node ? next : n), edges: removed.size ? doc.edges.filter((e) => !removed.has(e)) : doc.edges },
    removedEdges
  };
}

/** Literal type change keeps a compatible number, otherwise falls back to the type's default. */
export function setLiteralType(doc, nodeId, valueType) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || !(valueType in defaultValues)) return null;
  const old = node.data.value;
  const keep = typeof old === 'number' && (valueType === 'float' || (valueType === 'int' && Number.isSafeInteger(old)));
  return setNodeData(doc, nodeId, { valueType, value: keep ? old : defaultValues[valueType] });
}

// ---- connections ------------------------------------------------------------------------------

// New errors of these kinds mean the wire itself is wrong; other new errors (missing-input on a
// node that just became reachable, zero-step, nested-for) are normal work-in-progress diagnostics.
const blockingCodes = new Set(['exec-cycle', 'value-cycle', 'type-mismatch', 'comparison-type']);
const diagnosticKey = (d) => `${d.code}|${d.nodeId ?? ''}|${d.edgeId ?? ''}|${d.message}`;

/** Checks a candidate wire without requiring the rest of the graph to be complete. */
export function checkConnection(doc, { source, sourceHandle, target, targetHandle }) {
  const from = doc.nodes.find((n) => n.id === source);
  const to = doc.nodes.find((n) => n.id === target);
  if (!from || !to) return { ok: false, message: 'Connection refers to a missing node.' };
  const out = getNodePorts(from, doc.variables).find((p) => p.id === sourceHandle);
  const inn = getNodePorts(to, doc.variables).find((p) => p.id === targetHandle);
  if (!out || !inn) return { ok: false, message: 'Unknown port.' };
  if (out.direction !== 'out' || inn.direction !== 'in') return { ok: false, message: 'Connect an output to an input.' };
  if (out.kind !== inn.kind) return { ok: false, message: 'Execution and value ports cannot connect.' };
  if (doc.edges.some((e) => e.target === target && e.targetHandle === targetHandle)) {
    return { ok: false, message: 'Input already has a wire. Delete it first.' };
  }
  if (out.kind === 'exec' && doc.edges.some((e) => e.source === source && e.sourceHandle === sourceHandle)) {
    return { ok: false, message: 'Execution output already has a wire. Delete it first.' };
  }
  const candidate = { ...doc, edges: [...doc.edges, { id: '_candidate', source, sourceHandle, target, targetHandle }] };
  const before = new Set(validateGeometryDocument(doc).map(diagnosticKey));
  const added = validateGeometryDocument(candidate).find((d) => d.severity === 'error' && blockingCodes.has(d.code)
    && !before.has(diagnosticKey(d)));
  return added ? { ok: false, message: added.message } : { ok: true };
}

/** Returns { doc, edgeId } or { error }. */
export function addEdge(doc, connection) {
  const check = checkConnection(doc, connection);
  if (!check.ok) return { error: check.message };
  const { source, sourceHandle, target, targetHandle } = connection;
  const edge = { id: uuid(), source, sourceHandle, target, targetHandle };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, edgeId: edge.id };
}

// ---- variables --------------------------------------------------------------------------------

const referencing = ['getVariable', 'setVariable', 'forRange'];
export const variableUsage = (doc, id) => doc.nodes.filter((n) => referencing.includes(n.type) && n.data.variableId === id).length;

export function addVariable(doc) {
  const names = new Set(doc.variables.map((v) => v.name));
  let n = 1;
  while (names.has(`value${n}`)) n++;
  const variable = { id: uuid(), name: `value${n}`, type: 'int', initialValue: 0 };
  return { doc: { ...doc, variables: [...doc.variables, variable] }, variableId: variable.id };
}

/** Rename keeps the ID; a type change resets the initial value (one transaction). */
export function updateVariable(doc, id, patch) {
  const old = doc.variables.find((v) => v.id === id);
  if (!old) return null;
  const next = { ...old, ...patch };
  if (patch.type && patch.type !== old.type) next.initialValue = defaultValues[patch.type];
  return { ...doc, variables: doc.variables.map((v) => v === old ? next : v) };
}

/** Nodes keep their variableId, so validation reports missing-variable and Undo restores everything. */
export const deleteVariable = (doc, id) => ({ ...doc, variables: doc.variables.filter((v) => v.id !== id) });

export const setTarget = (doc, target) => doc.target === target ? null : { ...doc, target };

// ---- flow mapping -----------------------------------------------------------------------------

/** Svelte Flow view state -> .gcn positions. Only position is read back; everything else comes from the document. */
export function positionsFromFlow(flowNodes) {
  return Object.fromEntries(flowNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
}
