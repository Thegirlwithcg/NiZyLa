const valueTypes = ['int', 'float', 'string', 'bool'];
const operators = {
  binary: ['+', '-', '*', '/'],
  compare: ['==', '!=', '<', '<=', '>', '>='],
  boolean: ['and', 'or', 'not']
};
// Union of Python and Godot 4 keywords, literals, and names used by code generation.
const reservedNames = new Set(`False None True and as assert async await break class
  continue def del elif else except finally for from global if import in is lambda
  nonlocal not or pass raise return try while with yield match case type _
  breakpoint class_name const enum extends func namespace preload self signal static
  super trait var void when abstract export onready setget tool remote master puppet
  remotesync mastersync puppetsync sync true false null PI TAU INF NAN
  main print range float int bool str String StringName NodePath RID Object Callable
  Signal Dictionary Array Variant Vector2 Vector2i Rect2 Rect2i Vector3 Vector3i
  Transform2D Vector4 Vector4i Plane Quaternion AABB Basis Transform3D Projection Color
  PackedByteArray PackedInt32Array PackedInt64Array PackedFloat32Array PackedFloat64Array
  PackedStringArray PackedVector2Array PackedVector3Array PackedColorArray PackedVector4Array`.split(/\s+/));

const port = (id, direction, kind, valueType = null) => ({ id, direction, kind, valueType });
const input = (id, type) => port(id, 'in', 'value', type);
const output = (type) => port('value', 'out', 'value', type);
const execution = (...exits) => [port('in', 'in', 'exec'), ...exits.map((id) => port(id, 'out', 'exec'))];
const numeric = (type) => type === 'int' || type === 'float';

export const nodeDefinitions = {
  start: { label: 'Start', category: 'Entry', defaults: {}, ports: [port('next', 'out', 'exec')] },
  literal: { label: 'Value', category: 'Value', defaults: { valueType: 'int', value: 0 }, valueTypes,
    ports: (node) => [output(node.data.valueType)] },
  getVariable: { label: 'Get Variable', category: 'Variable', defaults: { variableId: '' },
    ports: (node, variables) => [output(variables.find((v) => v.id === node.data.variableId)?.type ?? 'unknown')] },
  setVariable: { label: 'Set Variable', category: 'Variable', defaults: { variableId: '' },
    ports: (node, variables) => [...execution('next'), input('value', variables.find((v) => v.id === node.data.variableId)?.type ?? 'unknown')] },
  binary: { label: 'Math', category: 'Math', defaults: { operator: '+' }, operators: operators.binary,
    ports: (node, _variables, types) => [input('a', 'number'), input('b', 'number'),
      output(node.data.operator === '/' ? 'float' : numeric(types.a) && numeric(types.b)
        ? (types.a === 'int' && types.b === 'int' ? 'int' : 'float') : 'unknown')] },
  compare: { label: 'Compare', category: 'Logic', defaults: { operator: '==' }, operators: operators.compare,
    ports: (node) => [input('a', ['==', '!='].includes(node.data.operator) ? 'any' : 'number'),
      input('b', ['==', '!='].includes(node.data.operator) ? 'any' : 'number'), output('bool')] },
  boolean: { label: 'Boolean Logic', category: 'Logic', defaults: { operator: 'and' }, operators: operators.boolean,
    ports: (node) => [input('a', 'bool'), ...(node.data.operator === 'not' ? [] : [input('b', 'bool')]), output('bool')] },
  if: { label: 'If / Else', category: 'Control', defaults: {}, ports: [...execution('then', 'else', 'next'), input('condition', 'bool')] },
  while: { label: 'While', category: 'Control', defaults: {}, ports: [...execution('body', 'next'), input('condition', 'bool')] },
  forRange: { label: 'For Range', category: 'Control', defaults: { variableId: '' },
    ports: [...execution('body', 'next'), input('start', 'int'), input('stop', 'int'), input('step', 'int')] },
  print: { label: 'Print', category: 'Output', defaults: {}, ports: [...execution('next'), input('value', 'any')] }
};

/** inputTypes contains inferred source types by input handle; no graph evaluation. */
export function getNodePorts(node, variables = [], inputTypes = {}) {
  const definition = Object.hasOwn(nodeDefinitions, node.type) ? nodeDefinitions[node.type] : null;
  if (!definition) return [];
  const ports = typeof definition.ports === 'function' ? definition.ports(node, variables, inputTypes) : definition.ports;
  return ports.map((item) => ({ ...item }));
}

export function createGeometryDocument() {
  return {
    format: 'nizyla.geometry-code', version: 1, target: 'python', variables: [],
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }
  };
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && value.trim().length > 0;
const literalMatches = (type, value) => type === 'int' ? Number.isSafeInteger(value)
  : type === 'float' ? Number.isFinite(value)
    : type === 'string' ? typeof value === 'string' : type === 'bool' && typeof value === 'boolean';
const diagnostic = (code, message, location = {}, severity = 'error') => ({ severity, code, message, ...location });

// File shape is deliberately separate from editable graph errors.
function schemaDiagnostics(doc) {
  if (!record(doc)) return [diagnostic('invalid-schema', 'Document must be an object.')];
  if (doc.format !== 'nizyla.geometry-code') return [diagnostic('invalid-format', 'Not a Geometry Code document.')];
  if (doc.version !== 1) return [diagnostic('unsupported-version', 'Only Geometry Code version 1 is supported.')];
  const result = [];
  const check = (valid, message, location) => {
    if (!valid) result.push(diagnostic('invalid-schema', message, location));
  };
  check(['python', 'gdscript'].includes(doc.target), 'target must be python or gdscript.');
  check(record(doc.viewport) && Number.isFinite(doc.viewport.x) && Number.isFinite(doc.viewport.y)
    && Number.isFinite(doc.viewport.zoom) && doc.viewport.zoom > 0, 'viewport requires finite x/y and positive zoom.');
  for (const key of ['variables', 'nodes', 'edges']) check(Array.isArray(doc[key]), `${key} must be an array.`);
  if (!['variables', 'nodes', 'edges'].every((key) => Array.isArray(doc[key]))) return result;
  for (const [index, variable] of doc.variables.entries()) {
    check(record(variable) && identifier(variable.id) && typeof variable.name === 'string'
      && valueTypes.includes(variable.type) && literalMatches(variable.type, variable.initialValue),
    `variables[${index}] requires id, name, type and a matching initialValue.`);
  }
  for (const [index, node] of doc.nodes.entries()) {
    const location = identifier(node?.id) ? { nodeId: node.id } : {};
    if (!record(node) || !identifier(node.id) || !Object.hasOwn(nodeDefinitions, node.type)
      || !record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !record(node.data)) {
      check(false, `nodes[${index}] requires id, known type, finite position and data.`, location);
      continue;
    }
    const data = node.data;
    if (node.type === 'literal') check(valueTypes.includes(data.valueType) && literalMatches(data.valueType, data.value), 'Literal value must match valueType.', location);
    if (Object.hasOwn(operators, node.type)) check(operators[node.type].includes(data.operator), 'Unknown or missing operator.', location);
    if (['getVariable', 'setVariable', 'forRange'].includes(node.type)) check(typeof data.variableId === 'string', 'variableId must be a string.', location);
  }
  for (const [index, edge] of doc.edges.entries()) {
    check(record(edge) && ['id', 'source', 'sourceHandle', 'target', 'targetHandle'].every((key) => identifier(edge[key])),
      `edges[${index}] requires nonempty id, source, sourceHandle, target and targetHandle.`, identifier(edge?.id) ? { edgeId: edge.id } : {});
  }
  return result;
}

export function parseGeometryDocument(text) {
  let document;
  try {
    if (typeof text !== 'string') throw new TypeError('Expected JSON text.');
    document = JSON.parse(text);
  } catch {
    return { document: null, diagnostics: [diagnostic('invalid-json', 'Could not parse Geometry Code JSON.')] };
  }
  const errors = schemaDiagnostics(document);
  return errors.length ? { document: null, diagnostics: errors }
    : { document, diagnostics: validateGeometryDocument(document) };
}

export function serializeGeometryDocument(document) {
  const errors = schemaDiagnostics(document);
  if (errors.length) throw new TypeError(errors.map((item) => item.message).join(' '));
  const { format, version, target, variables, nodes, edges, viewport } = document;
  return JSON.stringify({ format, version, target,
    variables: variables.map(({ id, name, type, initialValue }) => ({ id, name, type, initialValue })),
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position: { x: position.x, y: position.y },
      data: Object.fromEntries(Object.keys(nodeDefinitions[type].defaults).map((key) => [key, data[key]])) })),
    edges: edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
  }, null, 2) + '\n';
}

// Iterative topological ordering handles long chains and cycles without recursion.
function orderNodes(nodes, outgoing) {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edges of outgoing.values()) for (const edge of edges) degrees.set(edge.target, degrees.get(edge.target) + 1);
  const order = nodes.filter((node) => degrees.get(node.id) === 0).map((node) => node.id);
  for (let i = 0; i < order.length; i++) {
    for (const edge of outgoing.get(order[i])) {
      degrees.set(edge.target, degrees.get(edge.target) - 1);
      if (degrees.get(edge.target) === 0) order.push(edge.target);
    }
  }
  return order;
}

export function validateGeometryDocument(doc) {
  const diagnostics = schemaDiagnostics(doc);
  if (diagnostics.length) return diagnostics;
  const error = (code, message, location) => diagnostics.push(diagnostic(code, message, location));
  for (const key of ['nodes', 'edges', 'variables']) {
    const seen = new Set();
    for (const item of doc[key]) {
      if (seen.has(item.id)) error('duplicate-id', `Duplicate ${key} ID: ${item.id}.`, key === 'nodes' ? { nodeId: item.id } : key === 'edges' ? { edgeId: item.id } : {});
      seen.add(item.id);
    }
  }
  // References are ambiguous with duplicate IDs; keep the document editable.
  if (diagnostics.length) return diagnostics;
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const variables = new Map(doc.variables.map((variable) => [variable.id, variable]));
  const names = new Set();
  for (const variable of doc.variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name) || reservedNames.has(variable.name) || variable.name.startsWith('_gcn_')) {
      error('invalid-variable-name', `Variable ${variable.id} has an invalid or reserved name: ${variable.name}.`);
    }
    if (names.has(variable.name)) error('duplicate-variable-name', `Duplicate variable name: ${variable.name}.`);
    names.add(variable.name);
  }
  const starts = doc.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) error('start-count', 'A graph requires exactly one Start node.');
  for (const node of doc.nodes) {
    if (['getVariable', 'setVariable', 'forRange'].includes(node.type)) {
      const variable = variables.get(node.data.variableId);
      if (!variable) error('missing-variable', `Variable ${node.data.variableId || '(unselected)'} does not exist.`, { nodeId: node.id });
      else if (node.type === 'forRange' && variable.type !== 'int') error('for-variable-type', 'For Range requires an int variable.', { nodeId: node.id });
    }
  }
  const portMaps = new Map(doc.nodes.map((node) => [node.id, new Map(getNodePorts(node, doc.variables).map((p) => [p.id, p]))]));
  const execOut = new Map(doc.nodes.map((node) => [node.id, []]));
  const valueOut = new Map(doc.nodes.map((node) => [node.id, []]));
  const incoming = new Map(doc.nodes.map((node) => [node.id, new Map()]));
  const execPorts = new Map(doc.nodes.map((node) => [node.id, new Set()]));
  for (const edge of doc.edges) {
    const location = { edgeId: edge.id, nodeId: edge.target };
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      error('missing-node', 'Edge refers to a missing node.', location);
      continue;
    }
    const source = portMaps.get(edge.source).get(edge.sourceHandle);
    const target = portMaps.get(edge.target).get(edge.targetHandle);
    if (!source || !target) { error('missing-port', 'Edge refers to an unknown port.', location); continue; }
    if (source.direction !== 'out' || target.direction !== 'in') { error('port-direction', 'Connections must run from output to input.', location); continue; }
    if (source.kind !== target.kind) { error('port-kind', 'Execution and value ports cannot connect.', location); continue; }
    if (incoming.get(edge.target).has(edge.targetHandle)) error('input-connected', 'Input already has a connection; statements cannot have multiple parents.', location);
    else incoming.get(edge.target).set(edge.targetHandle, edge);
    if (source.kind === 'exec') {
      if (execPorts.get(edge.source).has(edge.sourceHandle)) error('exec-output-connected', 'Execution output already has a connection.', location);
      execPorts.get(edge.source).add(edge.sourceHandle);
    }
    (source.kind === 'exec' ? execOut : valueOut).get(edge.source).push(edge);
  }
  const execOrder = orderNodes(doc.nodes, execOut);
  const valueOrder = orderNodes(doc.nodes, valueOut);
  if (execOrder.length !== doc.nodes.length) error('exec-cycle', 'Execution connections contain a cycle. Use body/next instead of a back edge.');
  if (valueOrder.length !== doc.nodes.length) error('value-cycle', 'Value connections contain a cycle.');

  const used = new Set();
  const pending = starts.map((node) => node.id);
  while (pending.length) {
    const id = pending.pop();
    if (used.has(id)) continue;
    used.add(id);
    for (const edge of execOut.get(id)) pending.push(edge.target);
    for (const [handle, edge] of incoming.get(id)) if (portMaps.get(id).get(handle).kind === 'value') pending.push(edge.source);
  }
  for (const node of doc.nodes) {
    if (!used.has(node.id)) {
      diagnostics.push(diagnostic('unused-node', 'Node is not used by Start and will not be generated.', { nodeId: node.id }, 'warning'));
      continue;
    }
    for (const p of portMaps.get(node.id).values()) {
      if (p.direction === 'in' && p.kind === 'value' && !incoming.get(node.id).has(p.id)) error('missing-input', `Connect input ${p.id}.`, { nodeId: node.id });
    }
  }

  const outputTypes = new Map();
  for (const id of valueOrder) {
    const node = nodes.get(id);
    const types = {};
    for (const [handle, edge] of incoming.get(id)) {
      if (portMaps.get(id).get(handle).kind === 'value') types[handle] = outputTypes.get(edge.source) ?? 'unknown';
    }
    const ports = getNodePorts(node, doc.variables, types);
    outputTypes.set(id, ports.find((p) => p.direction === 'out' && p.kind === 'value')?.valueType ?? 'unknown');
    for (const p of ports.filter((p) => p.direction === 'in' && p.kind === 'value')) {
      const actual = types[p.id];
      if (!actual || actual === 'unknown' || p.valueType === 'unknown') continue;
      const matches = p.valueType === 'any' || p.valueType === actual || p.valueType === 'number' && numeric(actual)
        || p.valueType === 'float' && actual === 'int';
      if (!matches) error('type-mismatch', `${p.id} expects ${p.valueType}, received ${actual}.`, { nodeId: id, edgeId: incoming.get(id).get(p.id).id });
    }
    if (node.type === 'compare' && ['==', '!='].includes(node.data.operator) && types.a && types.b
      && types.a !== 'unknown' && types.b !== 'unknown' && types.a !== types.b && !(numeric(types.a) && numeric(types.b))) {
      error('comparison-type', 'Equality requires matching types or an int/float pair.', { nodeId: id });
    }
    if (node.type === 'forRange') {
      const step = nodes.get(incoming.get(id).get('step')?.source);
      if (step?.type === 'literal' && step.data.value === 0) error('zero-step', 'For Range step must not be zero.', { nodeId: id });
    }
  }
  const scopes = new Map();
  for (const id of execOrder) {
    const node = nodes.get(id);
    const scope = scopes.get(id) ?? new Set();
    if (node.type === 'forRange' && scope.has(node.data.variableId)) error('nested-for-variable', 'Nested For Range nodes must use different variables.', { nodeId: id });
    for (const edge of execOut.get(id)) {
      if (node.type === 'forRange' && edge.sourceHandle === 'body') {
        // ponytail: copies grow with nesting depth; use parent-linked scopes if deep nesting matters.
        scopes.set(edge.target, new Set([...scope, node.data.variableId]));
      } else scopes.set(edge.target, scope);
    }
  }
  return diagnostics;
}
