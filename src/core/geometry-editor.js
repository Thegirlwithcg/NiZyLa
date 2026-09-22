import { createChildGraph, getNodePorts, nodeDefinitions, parseGeometryDocument, serializeGeometryDocument, validateGeometryDocument } from './geometry.js';

// Pure document editing + history for the Geometry Code UI. No DOM, no Svelte Flow objects:
// every function takes a plain .gcn document and returns a new one (inputs are never mutated).

export const HISTORY_LIMIT = 100;
export const defaultValues = {
  int: 0,
  float: 0,
  string: '',
  bool: false,
  get list() { return []; },
  get dict() { return {}; }
};

function serializeGraphContent(graph) {
  if (!graph) return null;
  return [
    graph.target,
    (graph.variables || []).map(({ id, name, type, initialValue }) => [id, name, type, initialValue]),
    (graph.nodes || []).map((node) => {
      const def = nodeDefinitions[node.type];
      const defaults = def ? def.defaults : {};
      const dataValues = Object.keys(defaults).map((k) => {
        if (k === 'graph' && node.data?.graph) {
          return serializeGraphContent(node.data.graph);
        }
        return node.data ? node.data[k] : undefined;
      });
      if (node.type === 'start') {
        dataValues.push(node.data?.mainGuard === true);
      }
      return [node.id, node.type, node.position?.x, node.position?.y, dataValues];
    }),
    (graph.edges || []).map(({ id, source, sourceHandle, target, targetHandle }) => [id, source, sourceHandle, target, targetHandle])
  ];
}

// Content = everything except the viewport; pan/zoom never counts as an edit.
export const contentKey = (doc) => JSON.stringify(serializeGraphContent(doc));
export const sameContent = (a, b) => a === b || contentKey(a) === contentKey(b);

function sameViewports(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const vA = a.viewport;
  const vB = b.viewport;
  if (vA && vB && (vA.x !== vB.x || vA.y !== vB.y || vA.zoom !== vB.zoom)) return false;
  // Compare child viewports recursively
  for (const nodeA of a.nodes || []) {
    if (nodeA.data?.graph) {
      const nodeB = (b.nodes || []).find((n) => n.id === nodeA.id);
      if (nodeB?.data?.graph && !sameViewports(nodeA.data.graph, nodeB.data.graph)) return false;
    }
  }
  return true;
}

export const sameDocument = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!sameContent(a, b)) return false;
  return sameViewports(a, b);
};

// ---- history ----------------------------------------------------------------------------------

export function createEditorState(doc) {
  return { present: doc, past: [], future: [], pending: null };
}

/** Ends a live edit (typing/dragging): one history entry if anything changed. */
export function endEdit(state) {
  if (!state.pending) return state;
  const changed = !sameContent(state.pending, state.present);
  return { ...state, pending: null, past: changed ? [...state.past, state.pending].slice(-HISTORY_LIMIT) : state.past, future: changed ? [] : state.future };
}

/** Cancels a live edit: restores state before live edits began, keeping current viewport. */
export function cancelEdit(state) {
  if (!state.pending) return state;
  return { ...state, present: { ...state.pending, viewport: state.present.viewport }, pending: null };
}

/** live=true groups repeated edits into a single transaction until endEdit(). */
export function applyEdit(state, next, live = false) {
  if (sameContent(next, state.present)) return sameViewports(next, state.present) ? state : { ...state, present: next };
  // A live edit keeps Redo until it ends with a real change (endEdit), so Undo -> edit -> revert keeps Redo.
  if (live) return { ...state, present: next, pending: state.pending ?? state.present };
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

// ---- scope navigation -------------------------------------------------------------------------

export function getGraphAtScope(doc, scopePath = []) {
  if (!doc) return null;
  let current = doc;
  for (const id of scopePath) {
    const parentNode = current.nodes?.find((n) => n.id === id);
    if (!parentNode || !parentNode.data?.graph) return current;
    current = parentNode.data.graph;
  }
  return current;
}

export function updateGraphAtScope(doc, scopePath = [], updateFn) {
  if (!scopePath || scopePath.length === 0) {
    return updateFn(doc);
  }
  const [head, ...tail] = scopePath;
  const parentNode = doc.nodes?.find((n) => n.id === head);
  if (!parentNode || !parentNode.data?.graph) return doc;
  const updatedChild = updateGraphAtScope(parentNode.data.graph, tail, updateFn);
  const nextNodes = doc.nodes.map((n) => (n.id === head ? { ...n, data: { ...n.data, graph: updatedChild } } : n));
  return { ...doc, nodes: nextNodes };
}

export function setViewportAtScope(doc, scopePath = [], viewport) {
  return updateGraphAtScope(doc, scopePath, (g) => {
    if (g.viewport?.x === viewport.x && g.viewport?.y === viewport.y && g.viewport?.zoom === viewport.zoom) return g;
    return { ...g, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } };
  });
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
  preset('print', 'Print', 'Output', 'print'),
  preset('fstring', 'F-String', 'Text', 'formatText', { style: 'fstring', template: 'Value: {x}' }),
  preset('format-string', 'Format String', 'Text', 'formatText', { style: 'format', template: 'Value: {x}' }),
  preset('concat-text', 'Concat Text', 'Text', 'formatText', { style: 'concat', template: 'Value: {x}' }),
  preset('list', 'List', 'Collection', 'list', { itemCount: 0 }),
  preset('array', 'Array', 'Collection', 'array', { elementType: 'int', itemCount: 0 }),
  preset('dict', 'Dictionary', 'Collection', 'dict', { entries: [] }),
  preset('get-item', 'Get Item', 'Collection', 'getItem'),
  preset('set-item', 'Set Item', 'Collection', 'setItem'),

  // v2 presets
  preset('function', 'Function', 'Function', 'functionDef', { name: 'my_function', parameters: [], returnType: 'any' }),
  preset('call', 'Call Function', 'Function', 'functionCall', { name: 'call', argumentNames: [] }),
  preset('parameter', 'Parameter', 'Function', 'parameter', { parameterId: '', name: 'param', paramType: 'any' }),
  preset('return', 'Return', 'Function', 'return', { hasValue: true }),
  preset('class', 'Class', 'Class', 'classDef', { name: 'MyClass', baseClass: '' }),
  preset('instantiate', 'New Instance', 'Class', 'instantiate', { className: 'MyClass', argumentNames: [] }),
  preset('import', 'Import', 'Module', 'import', { importType: 'module', module: '', names: [] }),
  preset('symbol', 'Symbol', 'Module', 'symbolRef', { symbol: '' }),
  preset('get-member', 'Get Member', 'Member', 'getMember', { memberName: '' }),
  preset('set-member', 'Set Member', 'Member', 'setMember', { memberName: '' }),
  preset('code-stmt', 'Code (Statement)', 'Code', 'codeNode', { codeKind: 'statement', code: 'pass', language: 'python' }),
  preset('code-expr', 'Code (Expression)', 'Code', 'codeNode', { codeKind: 'expression', code: 'None', language: 'python' }),
  preset('code-block', 'Code (Block)', 'Code', 'codeNode', { codeKind: 'block', code: 'pass', language: 'python' })
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
  if (['functionDef', 'classDef'].includes(item.type) && !data.graph) {
    data.graph = createChildGraph();
  }
  const node = { id: uuid(), type: item.type, position: finitePoint(position), data };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, nodeId: node.id };
}

export function addNodeAtScope(doc, scopePath, presetId, position) {
  let createdNodeId = null;
  const nextDoc = updateGraphAtScope(doc, scopePath, (graph) => {
    const res = addNode(graph, presetId, position);
    if (!res) return graph;
    createdNodeId = res.nodeId;
    return res.doc;
  });
  return createdNodeId ? { doc: nextDoc, nodeId: createdNodeId } : null;
}

/** Deletes nodes (never Start) and every wire touching them, plus explicitly listed wires. */
export function removeItems(doc, { nodeIds = [], edgeIds = [] } = {}) {
  const gone = new Set(nodeIds.filter((id) => doc.nodes.find((n) => n.id === id)?.type !== 'start'));
  const wires = new Set(edgeIds);
  const nodes = doc.nodes.filter((n) => !gone.has(n.id));
  const edges = doc.edges.filter((e) => !wires.has(e.id) && !gone.has(e.source) && !gone.has(e.target));
  return nodes.length === doc.nodes.length && edges.length === doc.edges.length ? null : { ...doc, nodes, edges };
}

export function duplicateNodes(graph, nodeIds, offset = { x: 40, y: 40 }) {
  if (!graph || !Array.isArray(nodeIds)) return null;
  const targetIds = new Set(nodeIds);
  const toDuplicate = (graph.nodes || []).filter((n) => targetIds.has(n.id) && n.type !== 'start');
  if (toDuplicate.length === 0) return null;

  const idMap = new Map();
  const newNodes = [];
  const offX = offset?.x ?? 40;
  const offY = offset?.y ?? 40;

  for (const orig of toDuplicate) {
    const newId = uuid();
    idMap.set(orig.id, newId);
    const newPos = finitePoint({ x: (orig.position?.x ?? 0) + offX, y: (orig.position?.y ?? 0) + offY });
    const newData = orig.data ? structuredClone(orig.data) : {};
    newNodes.push({
      ...orig,
      id: newId,
      position: newPos,
      data: newData
    });
  }

  const newEdges = [];
  for (const edge of graph.edges || []) {
    if (idMap.has(edge.source) && idMap.has(edge.target)) {
      newEdges.push({
        id: uuid(),
        source: idMap.get(edge.source),
        sourceHandle: edge.sourceHandle,
        target: idMap.get(edge.target),
        targetHandle: edge.targetHandle
      });
    }
  }

  const nextDoc = {
    ...graph,
    nodes: [...(graph.nodes || []), ...newNodes],
    edges: [...(graph.edges || []), ...newEdges]
  };

  return { doc: nextDoc, nodeIds: newNodes.map((n) => n.id) };
}

export function duplicateNodesAtScope(doc, scopePath, nodeIds, offset) {
  let createdNodeIds = null;
  const nextDoc = updateGraphAtScope(doc, scopePath, (graph) => {
    const res = duplicateNodes(graph, nodeIds, offset);
    if (!res) return graph;
    createdNodeIds = res.nodeIds;
    return res.doc;
  });
  return createdNodeIds ? { doc: nextDoc, nodeIds: createdNodeIds } : null;
}

export function removeItemsAtScope(doc, scopePath, { nodeIds = [], edgeIds = [] } = {}) {
  return updateGraphAtScope(doc, scopePath, (graph) => removeItems(graph, { nodeIds, edgeIds }) || graph);
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

export function moveNodesAtScope(doc, scopePath, positions) {
  return updateGraphAtScope(doc, scopePath, (graph) => moveNodes(graph, positions) || graph);
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

export function setNodeDataAtScope(doc, scopePath, nodeId, patch) {
  let removed = [];
  const nextDoc = updateGraphAtScope(doc, scopePath, (graph) => {
    const res = setNodeData(graph, nodeId, patch);
    if (!res) return graph;
    removed = res.removedEdges;
    return res.doc;
  });
  return { doc: nextDoc, removedEdges: removed };
}

/** Literal type change keeps a compatible number, otherwise falls back to the type's default. */
export function setLiteralType(doc, nodeId, valueType) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || !(valueType in defaultValues)) return null;
  const old = node.data?.value;
  const keep = typeof old === 'number' && (valueType === 'float' || (valueType === 'int' && Number.isSafeInteger(old)));
  return setNodeData(doc, nodeId, { valueType, value: keep ? old : defaultValues[valueType] });
}

// ---- signature editing ------------------------------------------------------------------------

export function addFunctionParameter(doc, funcNodeId, param = {}) {
  const node = doc.nodes.find((n) => n.id === funcNodeId);
  if (!node || node.type !== 'functionDef') return null;
  const paramId = `p_${uuid().slice(0, 8)}`;
  const newParam = {
    id: paramId,
    name: param.name || `arg${(node.data.parameters || []).length + 1}`,
    type: param.type || 'any',
    defaultValue: param.defaultValue !== undefined ? param.defaultValue : null
  };
  const nextParams = [...(node.data.parameters || []), newParam];
  return setNodeData(doc, funcNodeId, { parameters: nextParams });
}

export function updateFunctionParameter(doc, funcNodeId, paramId, patch) {
  const node = doc.nodes.find((n) => n.id === funcNodeId);
  if (!node || node.type !== 'functionDef') return null;
  const oldParam = (node.data.parameters || []).find((p) => p.id === paramId);
  if (!oldParam) return null;
  const updatedParam = { ...oldParam, ...patch };
  const nextParams = (node.data.parameters || []).map((p) => (p.id === paramId ? updatedParam : p));

  // Also update any parameter reference nodes in the child graph
  let childGraph = node.data.graph;
  if (childGraph) {
    const nextChildNodes = childGraph.nodes.map((cn) => {
      if (cn.type === 'parameter' && cn.data.parameterId === paramId) {
        return { ...cn, data: { ...cn.data, name: updatedParam.name, paramType: updatedParam.type } };
      }
      return cn;
    });
    childGraph = { ...childGraph, nodes: nextChildNodes };
  }

  const nextNode = { ...node, data: { ...node.data, parameters: nextParams, graph: childGraph } };
  return { doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === funcNodeId ? nextNode : n)) }, removedEdges: [] };
}

export function removeFunctionParameter(doc, funcNodeId, paramId) {
  const node = doc.nodes.find((n) => n.id === funcNodeId);
  if (!node || node.type !== 'functionDef') return null;
  const nextParams = (node.data.parameters || []).filter((p) => p.id !== paramId);

  // In child graph, remove any parameter nodes referencing this paramId and their connected edges
  let childGraph = node.data.graph;
  if (childGraph) {
    const affectedNodeIds = childGraph.nodes.filter((cn) => cn.type === 'parameter' && cn.data.parameterId === paramId).map((cn) => cn.id);
    if (affectedNodeIds.length) {
      childGraph = removeItems(childGraph, { nodeIds: affectedNodeIds }) || childGraph;
    }
  }

  const nextNode = { ...node, data: { ...node.data, parameters: nextParams, graph: childGraph } };
  return { doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === funcNodeId ? nextNode : n)) }, removedEdges: [] };
}

export function reorderFunctionParameters(doc, funcNodeId, newOrderIds) {
  const node = doc.nodes.find((n) => n.id === funcNodeId);
  if (!node || node.type !== 'functionDef') return null;
  const paramMap = new Map((node.data.parameters || []).map((p) => [p.id, p]));
  const nextParams = newOrderIds.map((id) => paramMap.get(id)).filter(Boolean);
  return setNodeData(doc, funcNodeId, { parameters: nextParams });
}

// ---- connections ------------------------------------------------------------------------------

const blockingCodes = new Set(['exec-cycle', 'value-cycle', 'type-mismatch', 'comparison-type']);
const diagnosticKey = (d) => `${d.code}|${d.nodeId ?? ''}|${d.edgeId ?? ''}|${d.message}`;

/** Checks a candidate wire without requiring the rest of the graph to be complete. */
export function checkConnection(graph, { source, sourceHandle, target, targetHandle }) {
  const from = graph.nodes.find((n) => n.id === source);
  const to = graph.nodes.find((n) => n.id === target);
  if (!from || !to) return { ok: false, message: 'Connection refers to a missing node.' };
  const out = getNodePorts(from, graph.variables).find((p) => p.id === sourceHandle);
  const inn = getNodePorts(to, graph.variables).find((p) => p.id === targetHandle);
  if (!out || !inn) return { ok: false, message: 'Unknown port.' };
  if (out.direction !== 'out' || inn.direction !== 'in') return { ok: false, message: 'Connect an output to an input.' };
  if (out.kind !== inn.kind) return { ok: false, message: 'Execution and value ports cannot connect.' };
  if (graph.edges.some((e) => e.target === target && e.targetHandle === targetHandle)) {
    return { ok: false, message: 'Input already has a wire. Delete it first.' };
  }
  if (out.kind === 'exec' && graph.edges.some((e) => e.source === source && e.sourceHandle === sourceHandle)) {
    return { ok: false, message: 'Execution output already has a wire. Delete it first.' };
  }
  const candidate = { ...graph, edges: [...graph.edges, { id: '_candidate', source, sourceHandle, target, targetHandle }] };
  const before = new Set(validateGeometryDocument(graph).map(diagnosticKey));
  const added = validateGeometryDocument(candidate).find((d) => d.severity === 'error' && blockingCodes.has(d.code)
    && !before.has(diagnosticKey(d)));
  return added ? { ok: false, message: added.message } : { ok: true };
}

/** Returns { doc, edgeId } or { error }. */
export function addEdge(graph, connection) {
  const check = checkConnection(graph, connection);
  if (!check.ok) return { error: check.message };
  const { source, sourceHandle, target, targetHandle } = connection;
  const edge = { id: uuid(), source, sourceHandle, target, targetHandle };
  return { doc: { ...graph, edges: [...graph.edges, edge] }, edgeId: edge.id };
}

export function addEdgeAtScope(doc, scopePath, connection) {
  let createdEdgeId = null;
  let errorMsg = null;
  const nextDoc = updateGraphAtScope(doc, scopePath, (graph) => {
    const res = addEdge(graph, connection);
    if (res.error) {
      errorMsg = res.error;
      return graph;
    }
    createdEdgeId = res.edgeId;
    return res.doc;
  });
  return errorMsg ? { error: errorMsg } : { doc: nextDoc, edgeId: createdEdgeId };
}

// ---- variables --------------------------------------------------------------------------------

const referencing = ['getVariable', 'setVariable', 'forRange'];
export const variableUsage = (doc, id) => doc.nodes.filter((n) => referencing.includes(n.type) && n.data?.variableId === id).length;

export function addVariable(doc) {
  const names = new Set(doc.variables.map((v) => v.name));
  let n = 1;
  while (names.has(`value${n}`)) n++;
  const variable = { id: uuid(), name: `value${n}`, type: 'int', initialValue: 0 };
  return { doc: { ...doc, variables: [...doc.variables, variable] }, variableId: variable.id };
}

export function addVariableAtScope(doc, scopePath) {
  let createdVarId = null;
  const nextDoc = updateGraphAtScope(doc, scopePath, (graph) => {
    const res = addVariable(graph);
    createdVarId = res.variableId;
    return res.doc;
  });
  return { doc: nextDoc, variableId: createdVarId };
}

/** Rename keeps the ID; a type change resets the initial value (one transaction). */
export function updateVariable(doc, id, patch) {
  const old = doc.variables.find((v) => v.id === id);
  if (!old) return null;
  const next = { ...old, ...patch };
  if (patch.type && patch.type !== old.type) next.initialValue = defaultValues[patch.type];
  return { ...doc, variables: doc.variables.map((v) => (v === old ? next : v)) };
}

export function updateVariableAtScope(doc, scopePath, id, patch) {
  return updateGraphAtScope(doc, scopePath, (graph) => updateVariable(graph, id, patch) || graph);
}

/** Nodes keep their variableId, so validation reports missing-variable and Undo restores everything. */
export const deleteVariable = (doc, id) => ({ ...doc, variables: doc.variables.filter((v) => v.id !== id) });

export function deleteVariableAtScope(doc, scopePath, id) {
  return updateGraphAtScope(doc, scopePath, (graph) => deleteVariable(graph, id));
}

export const setTarget = (doc, target) => (doc.target === target ? null : { ...doc, target });

// ---- flow mapping -----------------------------------------------------------------------------

/** Svelte Flow view state -> .gcn positions. Only position is read back; everything else comes from the document. */
export function positionsFromFlow(flowNodes) {
  return Object.fromEntries(flowNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
}

// ---- ports for display ------------------------------------------------------------------------

export function computePorts(graph) {
  const nodeMap = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const incoming = new Map();
  for (const e of graph.edges || []) {
    if (!incoming.has(e.target)) incoming.set(e.target, new Map());
    incoming.get(e.target).set(e.targetHandle, e.source);
  }
  const outType = (ports) => ports.find((p) => p.direction === 'out' && p.kind === 'value')?.valueType ?? 'unknown';
  const memo = new Map();
  const sourceType = (id) => {
    if (memo.has(id)) return memo.get(id);
    const node = nodeMap.get(id);
    return node && node.type !== 'binary' ? outType(getNodePorts(node, graph.variables)) : 'unknown';
  };
  const inputTypes = (id) => {
    const types = {};
    for (const handle of ['a', 'b']) {
      const source = incoming.get(id)?.get(handle);
      if (source) types[handle] = sourceType(source);
    }
    return types;
  };
  const visiting = new Set();
  for (const root of graph.nodes || []) {
    if (root.type !== 'binary' || memo.has(root.id)) continue;
    const stack = [root.id];
    while (stack.length) {
      const id = stack.at(-1);
      if (memo.has(id)) { stack.pop(); continue; }
      if (!visiting.has(id)) {
        visiting.add(id);
        const pending = ['a', 'b'].map((h) => incoming.get(id)?.get(h))
          .filter((s) => s && nodeMap.get(s)?.type === 'binary' && !memo.has(s) && !visiting.has(s));
        if (pending.length) { stack.push(...pending); continue; }
      }
      // Sources still unresolved here are part of a cycle: they stay 'unknown'.
      memo.set(id, outType(getNodePorts(nodeMap.get(id), graph.variables, inputTypes(id))));
      stack.pop();
    }
  }
  return new Map((graph.nodes || []).map((n) => [n.id, getNodePorts(n, graph.variables, n.type === 'binary' ? inputTypes(n.id) : {})]));
}

// ---- clipboard fragment operations ------------------------------------------------------------

function dedupeVariableName(name, existingNames) {
  if (!existingNames.has(name)) return name;
  const match = name.match(/^(.*)_(\d+)$/);
  const base = match ? match[1] : name;
  let n = match ? parseInt(match[2], 10) + 1 : 2;
  while (existingNames.has(`${base}_${n}`)) {
    n++;
  }
  return `${base}_${n}`;
}

export function copyFragment(graph, nodeIds, accessibleVariables = []) {
  if (!graph || !Array.isArray(nodeIds) || nodeIds.length === 0) return null;
  const targetIds = new Set(nodeIds);
  const selectedNodes = (graph.nodes || []).filter((n) => targetIds.has(n.id) && n.type !== 'start');
  if (selectedNodes.length === 0) return null;

  const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
  const selectedEdges = (graph.edges || []).filter((e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target));

  const referencedVarIds = new Set();
  function collectVarIds(nodes) {
    for (const n of nodes || []) {
      if (referencing.includes(n.type) && n.data?.variableId) {
        referencedVarIds.add(n.data.variableId);
      }
      if (n.data?.graph?.nodes) {
        collectVarIds(n.data.graph.nodes);
      }
    }
  }
  collectVarIds(selectedNodes);

  const allVars = [...(accessibleVariables.length ? accessibleVariables : (graph.variables || [])), ...(graph.variables || [])];
  const fragmentVars = [];
  const seenVarIds = new Set();
  for (const varId of referencedVarIds) {
    if (seenVarIds.has(varId)) continue;
    const v = allVars.find((item) => item.id === varId);
    if (v) {
      seenVarIds.add(varId);
      fragmentVars.push(structuredClone(v));
    }
  }

  const fragmentDoc = {
    format: 'nizyla.geometry-code',
    version: 2,
    target: graph.target || 'python',
    variables: fragmentVars,
    nodes: structuredClone(selectedNodes),
    edges: structuredClone(selectedEdges),
    viewport: { x: 0, y: 0, zoom: 1 }
  };

  return serializeGeometryDocument(fragmentDoc);
}

export function pasteFragment(graph, text, anchor = { x: 0, y: 0 }, accessibleVariables = []) {
  if (!graph || typeof text !== 'string') return null;
  if (text.length > 1000000) {
    return { error: 'Clipboard content exceeds 1,000,000 characters.' };
  }
  const parsed = parseGeometryDocument(text);
  if (!parsed.document) return null;
  const doc = parsed.document;
  if ((doc.nodes || []).length > 1000) {
    return { error: 'Clipboard content exceeds 1,000 nodes.' };
  }

  const fragmentNodes = (doc.nodes || []).filter((n) => n.type !== 'start');
  if (fragmentNodes.length === 0) {
    return { doc: { ...graph }, nodeIds: [], addedVariableIds: [] };
  }

  // Top-left node lands on anchor (flow coords), layout kept
  const minX = Math.min(...fragmentNodes.map((n) => n.position?.x ?? 0));
  const minY = Math.min(...fragmentNodes.map((n) => n.position?.y ?? 0));
  let topLeft = fragmentNodes[0];
  let minD = Infinity;
  for (const n of fragmentNodes) {
    const nx = n.position?.x ?? 0;
    const ny = n.position?.y ?? 0;
    const d = (nx - minX) + (ny - minY);
    if (d < minD) {
      minD = d;
      topLeft = n;
    } else if (d === minD) {
      if (ny < (topLeft.position?.y ?? 0)) {
        topLeft = n;
      } else if (ny === (topLeft.position?.y ?? 0) && nx < (topLeft.position?.x ?? 0)) {
        topLeft = n;
      }
    }
  }

  const ax = Number.isFinite(anchor?.x) ? Math.round(anchor.x) : 0;
  const ay = Number.isFinite(anchor?.y) ? Math.round(anchor.y) : 0;
  const dx = ax - (topLeft.position?.x ?? 0);
  const dy = ay - (topLeft.position?.y ?? 0);

  // Fresh node IDs
  const nodeIdMap = new Map();
  for (const n of fragmentNodes) {
    nodeIdMap.set(n.id, uuid());
  }

  // Edges: drop dangling, assign fresh IDs
  const newEdges = [];
  for (const e of doc.edges || []) {
    if (nodeIdMap.has(e.source) && nodeIdMap.has(e.target)) {
      newEdges.push({
        id: uuid(),
        source: nodeIdMap.get(e.source),
        sourceHandle: e.sourceHandle,
        target: nodeIdMap.get(e.target),
        targetHandle: e.targetHandle
      });
    }
  }

  // Variable handling
  const accList = accessibleVariables && accessibleVariables.length > 0 ? accessibleVariables : (graph.variables || []);
  const accVars = [...accList];
  const fragmentDocVars = doc.variables || [];
  const currentGraphVars = [...(graph.variables || [])];
  const addedVariableIds = [];
  const varIdMap = new Map();
  const existingNames = new Set([
    ...currentGraphVars.map((v) => v.name),
    ...accVars.map((v) => v.name)
  ]);

  const refVarIds = new Set();
  function collectVarIds(nodes) {
    for (const n of nodes || []) {
      if (referencing.includes(n.type) && n.data?.variableId) {
        refVarIds.add(n.data.variableId);
      }
      if (n.data?.graph?.nodes) {
        collectVarIds(n.data.graph.nodes);
      }
    }
  }
  collectVarIds(fragmentNodes);

  for (const origVarId of refVarIds) {
    const origVar = fragmentDocVars.find((v) => v.id === origVarId) || accVars.find((v) => v.id === origVarId);
    if (!origVar) {
      varIdMap.set(origVarId, origVarId);
      continue;
    }

    // 1. Same id+type accessible -> keep
    const keepMatch = accVars.find((v) => v.id === origVar.id && v.type === origVar.type);
    if (keepMatch) {
      varIdMap.set(origVarId, origVar.id);
      continue;
    }

    // 2. Same name+type accessible -> remap
    const remapMatch = accVars.find((v) => v.name === origVar.name && v.type === origVar.type);
    if (remapMatch) {
      varIdMap.set(origVarId, remapMatch.id);
      continue;
    }

    // 3. Add to current graph with fresh id and deduped name (score, score_2, ...)
    const freshId = uuid();
    const freshName = dedupeVariableName(origVar.name, existingNames);
    existingNames.add(freshName);
    const newVar = {
      id: freshId,
      name: freshName,
      type: origVar.type,
      initialValue: origVar.initialValue !== undefined ? structuredClone(origVar.initialValue) : (defaultValues[origVar.type] ?? 0)
    };
    currentGraphVars.push(newVar);
    accVars.push(newVar);
    addedVariableIds.push(freshId);
    varIdMap.set(origVarId, freshId);
  }

  // Construct pasted nodes
  const newNodes = [];
  for (const n of fragmentNodes) {
    const newId = nodeIdMap.get(n.id);
    const newPos = {
      x: Math.round((n.position?.x ?? 0) + dx),
      y: Math.round((n.position?.y ?? 0) + dy)
    };
    const newData = n.data ? structuredClone(n.data) : {};
    if (referencing.includes(n.type) && newData.variableId && varIdMap.has(newData.variableId)) {
      newData.variableId = varIdMap.get(newData.variableId);
    }
    newNodes.push({
      ...n,
      id: newId,
      position: newPos,
      data: newData
    });
  }

  const nextDoc = {
    ...graph,
    variables: currentGraphVars,
    nodes: [...(graph.nodes || []), ...newNodes],
    edges: [...(graph.edges || []), ...newEdges]
  };

  return {
    doc: nextDoc,
    nodeIds: newNodes.map((n) => n.id),
    addedVariableIds
  };
}
