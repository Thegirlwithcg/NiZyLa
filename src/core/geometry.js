export const valueTypes = ['int', 'float', 'string', 'bool'];
export const variableTypes = [...valueTypes, 'list', 'dict'];
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
  main print prints range float int bool str String StringName NodePath RID Object Callable
  Signal Dictionary Array Variant Vector2 Vector2i Rect2 Rect2i Vector3 Vector3i
  Transform2D Vector4 Vector4i Plane Quaternion AABB Basis Transform3D Projection Color
  PackedByteArray PackedInt32Array PackedInt64Array PackedFloat32Array PackedFloat64Array
  PackedStringArray PackedVector2Array PackedVector3Array PackedColorArray PackedVector4Array`.split(/\s+/));

const port = (id, direction, kind, valueType = null, label = null) => ({ id, direction, kind, valueType, ...(label !== null && label !== undefined ? { label } : {}) });
const input = (id, type, label = null) => port(id, 'in', 'value', type, label);
const output = (type) => port('value', 'out', 'value', type);
const execution = (...exits) => [port('in', 'in', 'exec'), ...exits.map((id) => port(id, 'out', 'exec'))];
const numeric = (type) => type === 'int' || type === 'float';

export function parseTemplate(template) {
  if (typeof template !== 'string') {
    return { parts: [], names: [], error: 'Template must be a string.' };
  }
  const parts = [];
  const names = [];
  const seenNames = new Set();
  let currentText = '';
  let error = null;
  let i = 0;

  const flushText = () => {
    if (currentText.length > 0) {
      parts.push({ text: currentText });
      currentText = '';
    }
  };

  while (i < template.length) {
    const ch = template[i];
    if (ch === '{') {
      if (i + 1 < template.length && template[i + 1] === '{') {
        currentText += '{';
        i += 2;
      } else {
        const closeIdx = template.indexOf('}', i + 1);
        if (closeIdx === -1) {
          error = error ?? 'Unclosed brace in template.';
          currentText += '{';
          i++;
        } else {
          const inner = template.slice(i + 1, closeIdx);
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
            flushText();
            parts.push({ name: inner });
            if (!seenNames.has(inner)) {
              seenNames.add(inner);
              names.push(inner);
            }
            i = closeIdx + 1;
          } else {
            error = error ?? `Invalid placeholder "{${inner}}".`;
            currentText += '{';
            i++;
          }
        }
      }
    } else if (ch === '}') {
      if (i + 1 < template.length && template[i + 1] === '}') {
        currentText += '}';
        i += 2;
      } else {
        error = error ?? 'Unexpected closing brace "}".';
        currentText += '}';
        i++;
      }
    } else {
      currentText += ch;
      i++;
    }
  }
  flushText();
  return { parts, names, error };
}

export const nodeDefinitions = {
  start: { label: 'Start', category: 'Entry', defaults: {}, ports: [port('next', 'out', 'exec')] },
  literal: { label: 'Value', category: 'Value', defaults: { valueType: 'int', value: 0 }, valueTypes,
    ports: (node) => [output(node.data?.valueType ?? 'int')] },
  getVariable: { label: 'Get Variable', category: 'Variable', defaults: { variableId: '' },
    ports: (node, variables) => [output(variables.find((v) => v.id === node.data?.variableId)?.type ?? 'unknown')] },
  setVariable: { label: 'Set Variable', category: 'Variable', defaults: { variableId: '' },
    ports: (node, variables) => [...execution('next'), input('value', variables.find((v) => v.id === node.data?.variableId)?.type ?? 'unknown')] },
  binary: { label: 'Math', category: 'Math', defaults: { operator: '+' }, operators: operators.binary,
    ports: (node, _variables, types) => [input('a', 'number'), input('b', 'number'),
      output(node.data?.operator === '/' ? 'float' : numeric(types?.a) && numeric(types?.b)
        ? (types.a === 'int' && types.b === 'int' ? 'int' : 'float') : 'unknown')] },
  compare: { label: 'Compare', category: 'Logic', defaults: { operator: '==' }, operators: operators.compare,
    ports: (node) => [input('a', ['==', '!='].includes(node.data?.operator) ? 'any' : 'number'),
      input('b', ['==', '!='].includes(node.data?.operator) ? 'any' : 'number'), output('bool')] },
  boolean: { label: 'Boolean Logic', category: 'Logic', defaults: { operator: 'and' }, operators: operators.boolean,
    ports: (node) => [input('a', 'bool'), ...(node.data?.operator === 'not' ? [] : [input('b', 'bool')]), output('bool')] },
  if: { label: 'If / Else', category: 'Control', defaults: {}, ports: [...execution('then', 'else', 'next'), input('condition', 'bool')] },
  while: { label: 'While', category: 'Control', defaults: {}, ports: [...execution('body', 'next'), input('condition', 'bool')] },
  forRange: { label: 'For Range', category: 'Control', defaults: { variableId: '' },
    ports: [...execution('body', 'next'), input('start', 'int'), input('stop', 'int'), input('step', 'int')] },
  print: {
    label: 'Print', category: 'Output',
    defaults: { argCount: 1 },
    ports: (node) => {
      const count = Number.isSafeInteger(node.data?.argCount) ? node.data.argCount : 1;
      const inputs = [];
      if (count >= 1) inputs.push(input('value', 'any'));
      for (let i = 1; i < count; i++) {
        inputs.push(input(`value_${i}`, 'any'));
      }
      return [...execution('next'), ...inputs];
    }
  },
  formatText: {
    label: 'Format Text', category: 'Text',
    defaults: { style: 'fstring', template: 'Value: {x}' },
    ports: (node) => {
      const template = typeof node.data?.template === 'string' ? node.data.template : 'Value: {x}';
      const { names } = parseTemplate(template);
      return [...names.map((name) => input(`{${name}}`, 'any')), output('string')];
    }
  },
  list: {
    label: 'List', category: 'Collection',
    defaults: { itemCount: 0 },
    ports: (node) => {
      const count = Number.isSafeInteger(node.data?.itemCount) ? node.data.itemCount : 0;
      const inputs = [];
      for (let i = 0; i < count; i++) {
        inputs.push(input(`item_${i}`, 'any'));
      }
      return [...inputs, output('list')];
    }
  },
  array: {
    label: 'Array', category: 'Collection',
    defaults: { elementType: 'int', itemCount: 0 },
    ports: (node) => {
      const count = Number.isSafeInteger(node.data?.itemCount) ? node.data.itemCount : 0;
      const elemType = valueTypes.includes(node.data?.elementType) ? node.data.elementType : 'int';
      const inputs = [];
      for (let i = 0; i < count; i++) {
        inputs.push(input(`item_${i}`, elemType));
      }
      return [...inputs, output('list')];
    }
  },
  dict: {
    label: 'Dictionary', category: 'Collection',
    defaults: { entries: [] },
    ports: (node) => {
      const entries = Array.isArray(node.data?.entries) ? node.data.entries : [];
      return [
        ...entries.map((entry) => port(entry.id, 'in', 'value', 'any', entry.key)),
        output('dict')
      ];
    }
  },
  getItem: {
    label: 'Get Item', category: 'Collection',
    defaults: {},
    ports: [input('container', 'any'), input('key', 'any'), output('any')]
  },
  setItem: {
    label: 'Set Item', category: 'Collection',
    defaults: {},
    ports: [...execution('next'), input('container', 'any'), input('key', 'any'), input('value', 'any')]
  },

  // --- v2 nodes ---
  functionDef: {
    label: 'Function', category: 'Function',
    defaults: { name: 'my_function', parameters: [], returnType: 'any', isAsync: false, decorators: [], graph: null },
    ports: () => execution('next')
  },
  parameter: {
    label: 'Parameter', category: 'Function',
    defaults: { parameterId: '', name: '', paramType: 'any' },
    ports: (node) => [output(node.data?.paramType || 'any')]
  },
  return: {
    label: 'Return', category: 'Function',
    defaults: { hasValue: true },
    ports: (node) => [port('in', 'in', 'exec'), ...(node.data?.hasValue !== false ? [input('value', 'any')] : [])]
  },
  classDef: {
    label: 'Class', category: 'Class',
    defaults: { name: 'MyClass', baseClass: '', decorators: [], graph: null },
    ports: () => execution('next')
  },
  functionCall: {
    label: 'Call Function', category: 'Function',
    defaults: { targetId: '', name: 'call', argumentNames: [], isMethod: false },
    ports: (node) => {
      const args = (node.data?.argumentNames || []).map((name, i) => input(name || `arg_${i}`, 'any'));
      const targetInput = node.data?.isMethod ? [input('target', 'any')] : [];
      return [...execution('next'), ...targetInput, ...args, output('any')];
    }
  },
  instantiate: {
    label: 'New Instance', category: 'Class',
    defaults: { targetId: '', className: 'MyClass', argumentNames: [] },
    ports: (node) => {
      const args = (node.data?.argumentNames || []).map((name, i) => input(name || `arg_${i}`, 'any'));
      return [...execution('next'), ...args, output('any')];
    }
  },
  import: {
    label: 'Import', category: 'Module',
    defaults: { importType: 'module', module: '', names: [], isRelative: false, level: 0 },
    ports: () => execution('next')
  },
  symbolRef: {
    label: 'Symbol', category: 'Module',
    defaults: { importNodeId: '', symbol: '' },
    ports: () => [output('any')]
  },
  getMember: {
    label: 'Get Member', category: 'Member',
    defaults: { memberName: '' },
    ports: () => [input('object', 'any'), output('any')]
  },
  setMember: {
    label: 'Set Member', category: 'Member',
    defaults: { memberName: '' },
    ports: () => [...execution('next'), input('object', 'any'), input('value', 'any')]
  },
  codeNode: {
    label: 'Code', category: 'Code',
    defaults: { title: '', codeKind: 'statement', code: 'pass', language: 'python', sourceLocation: null },
    ports: (node) => {
      if (node.data?.codeKind === 'expression') return [output('any')];
      return execution('next');
    }
  }
};

/** inputTypes contains inferred source types by input handle; no graph evaluation. */
export function getNodePorts(node, variables = [], inputTypes = {}) {
  const definition = Object.hasOwn(nodeDefinitions, node.type) ? nodeDefinitions[node.type] : null;
  if (!definition) return [];
  const ports = typeof definition.ports === 'function' ? definition.ports(node, variables, inputTypes) : definition.ports;
  return ports.map((item) => ({ ...item }));
}

export function createChildGraph() {
  return {
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    variables: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

export function createGeometryDocument(target = 'python', version = 2) {
  return {
    format: 'nizyla.geometry-code',
    version,
    target,
    variables: [],
    nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  };
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && value.trim().length > 0;
const literalMatches = (type, value) =>
  type === 'int' ? Number.isSafeInteger(value)
  : type === 'float' ? Number.isFinite(value)
  : type === 'string' ? typeof value === 'string'
  : type === 'bool' ? typeof value === 'boolean'
  : type === 'list' ? Array.isArray(value) && value.length === 0
  : type === 'dict' ? record(value) && Object.keys(value).length === 0
  : false;
const diagnostic = (code, message, location = {}, severity = 'error') => ({ severity, code, message, ...location });

function validateGraphShape(graph, path = '', isV1 = false) {
  const result = [];
  const p = path ? `${path}.` : '';
  const check = (valid, message, location = {}) => {
    if (!valid) result.push(diagnostic('invalid-schema', message, location));
  };
  check(record(graph.viewport) && Number.isFinite(graph.viewport.x) && Number.isFinite(graph.viewport.y)
    && Number.isFinite(graph.viewport.zoom) && graph.viewport.zoom > 0, `${p}viewport requires finite x/y and positive zoom.`);
  for (const key of ['variables', 'nodes', 'edges']) check(Array.isArray(graph[key]), `${p}${key} must be an array.`);
  if (!['variables', 'nodes', 'edges'].every((key) => Array.isArray(graph[key]))) return result;

  for (const [index, variable] of graph.variables.entries()) {
    check(record(variable) && identifier(variable.id) && typeof variable.name === 'string'
      && variableTypes.includes(variable.type) && literalMatches(variable.type, variable.initialValue),
    `${p}variables[${index}] requires id, name, type and a matching initialValue.`);
  }

  for (const [index, node] of graph.nodes.entries()) {
    const location = identifier(node?.id) ? { nodeId: node.id } : {};
    if (!record(node) || !identifier(node.id) || !Object.hasOwn(nodeDefinitions, node.type)
      || !record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !record(node.data)) {
      check(false, `${p}nodes[${index}] requires id, known type, finite position and data.`, location);
      continue;
    }
    if (isV1) {
      // In v1, only the original 11 nodes were valid
      const v1Types = ['start', 'literal', 'getVariable', 'setVariable', 'binary', 'compare', 'boolean', 'if', 'while', 'forRange', 'print'];
      if (!v1Types.includes(node.type)) {
        check(false, `${p}nodes[${index}] has unsupported type for v1: ${node.type}`, location);
      }
    }
    const data = node.data;
    if (node.type === 'literal') {
      check(valueTypes.includes(data.valueType) && literalMatches(data.valueType, data.value), 'Literal value must match valueType.', location);
    }
    if (node.type === 'print') {
      if (data.argCount !== undefined) {
        check(Number.isSafeInteger(data.argCount) && data.argCount >= 0 && data.argCount <= 16, 'Print argCount must be an integer between 0 and 16.', location);
      }
    }
    if (node.type === 'formatText') {
      check(['fstring', 'format', 'concat'].includes(data.style), 'formatText style must be fstring, format, or concat.', location);
      check(typeof data.template === 'string', 'formatText template must be a string.', location);
    }
    if (node.type === 'list') {
      check(Number.isSafeInteger(data.itemCount) && data.itemCount >= 0 && data.itemCount <= 64, 'List itemCount must be an integer between 0 and 64.', location);
    }
    if (node.type === 'array') {
      check(valueTypes.includes(data.elementType), 'Array elementType must be int, float, string, or bool.', location);
      check(Number.isSafeInteger(data.itemCount) && data.itemCount >= 0 && data.itemCount <= 64, 'Array itemCount must be an integer between 0 and 64.', location);
    }
    if (node.type === 'dict') {
      check(Array.isArray(data.entries), 'Dictionary entries must be an array.', location);
      if (Array.isArray(data.entries)) {
        const entryIds = new Set();
        for (const [eIdx, entry] of data.entries.entries()) {
          const valid = record(entry) && identifier(entry.id) && typeof entry.key === 'string' && !entryIds.has(entry.id);
          check(valid, `Dictionary entry at index ${eIdx} must have unique nonempty id and string key.`, location);
          if (entry && identifier(entry.id)) entryIds.add(entry.id);
        }
      }
    }
    if (Object.hasOwn(operators, node.type)) {
      check(operators[node.type].includes(data.operator), 'Unknown or missing operator.', location);
    }
    if (['getVariable', 'setVariable', 'forRange'].includes(node.type)) {
      check(typeof data.variableId === 'string', 'variableId must be a string.', location);
    }
    if (node.type === 'functionDef') {
      check(typeof data.name === 'string' && data.name.trim().length > 0, 'Function requires a name.', location);
      check(Array.isArray(data.parameters), 'Function parameters must be an array.', location);
      if (data.graph) {
        check(record(data.graph), 'Function graph must be an object.', location);
        if (record(data.graph)) {
          result.push(...validateGraphShape(data.graph, `${p}nodes[${index}].data.graph`, isV1));
        }
      }
    }
    if (node.type === 'classDef') {
      check(typeof data.name === 'string' && data.name.trim().length > 0, 'Class requires a name.', location);
      if (data.graph) {
        check(record(data.graph), 'Class graph must be an object.', location);
        if (record(data.graph)) {
          result.push(...validateGraphShape(data.graph, `${p}nodes[${index}].data.graph`, isV1));
        }
      }
    }
    if (node.type === 'parameter') {
      check(typeof data.parameterId === 'string', 'Parameter node requires parameterId string.', location);
    }
    if (node.type === 'codeNode') {
      if (data.title !== undefined) {
        check(typeof data.title === 'string', 'Code node title must be a string.', location);
      }
      check(['statement', 'expression', 'block'].includes(data.codeKind), 'Code node codeKind must be statement, expression, or block.', location);
      check(typeof data.code === 'string', 'Code node requires code string.', location);
    }
  }

  for (const [index, edge] of graph.edges.entries()) {
    check(record(edge) && ['id', 'source', 'sourceHandle', 'target', 'targetHandle'].every((key) => identifier(edge[key])),
      `${p}edges[${index}] requires nonempty id, source, sourceHandle, target and targetHandle.`, identifier(edge?.id) ? { edgeId: edge.id } : {});
  }
  return result;
}

export function schemaDiagnostics(doc) {
  if (!record(doc)) return [diagnostic('invalid-schema', 'Document must be an object.')];
  if (doc.format !== 'nizyla.geometry-code') return [diagnostic('invalid-format', 'Not a Geometry Code document.')];
  if (doc.version !== 1 && doc.version !== 2) return [diagnostic('unsupported-version', 'Only Geometry Code versions 1 and 2 are supported.')];
  const result = [];
  const check = (valid, message, location) => {
    if (!valid) result.push(diagnostic('invalid-schema', message, location));
  };
  check(['python', 'gdscript'].includes(doc.target), 'target must be python or gdscript.');
  result.push(...validateGraphShape(doc, '', doc.version === 1));
  return result;
}

/**
 * Migrates a valid v1 document to v2 in-memory.
 * Python: puts the original graph into `main` and calls it under `if __name__ == "__main__": main()`.
 * GDScript: puts the original graph into `_ready` of a script that `extends Node`.
 */
export function migrateV1ToV2(doc) {
  if (doc.version === 2) return doc;
  const childGraph = {
    nodes: doc.nodes.map((n) => structuredClone(n)),
    edges: doc.edges.map((e) => structuredClone(e)),
    variables: doc.variables.map((v) => structuredClone(v)),
    viewport: { ...doc.viewport }
  };

  if (doc.target === 'python') {
    const mainFuncId = 'def_main';
    const guardId = 'main_guard';
    const rootNodes = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: mainFuncId,
        type: 'functionDef',
        position: { x: 200, y: 0 },
        data: {
          name: 'main',
          parameters: [],
          returnType: 'void',
          isAsync: false,
          decorators: [],
          graph: childGraph
        }
      },
      {
        id: guardId,
        type: 'codeNode',
        position: { x: 450, y: 0 },
        data: {
          codeKind: 'statement',
          code: 'if __name__ == "__main__":\n    main()',
          language: 'python',
          sourceLocation: null
        }
      }
    ];
    const rootEdges = [
      { id: 'e_start_def', source: 'start', sourceHandle: 'next', target: mainFuncId, targetHandle: 'in' },
      { id: 'e_def_guard', source: mainFuncId, sourceHandle: 'next', target: guardId, targetHandle: 'in' }
    ];
    return {
      format: 'nizyla.geometry-code',
      version: 2,
      target: 'python',
      variables: [],
      nodes: rootNodes,
      edges: rootEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
      isMigratedV1: true
    };
  } else {
    // GDScript
    const extendsId = 'ext_node';
    const readyFuncId = 'def_ready';
    const rootNodes = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      {
        id: extendsId,
        type: 'import',
        position: { x: 200, y: 0 },
        data: {
          importType: 'gd_extends',
          module: 'Node',
          names: [],
          isRelative: false,
          level: 0
        }
      },
      {
        id: readyFuncId,
        type: 'functionDef',
        position: { x: 450, y: 0 },
        data: {
          name: '_ready',
          parameters: [],
          returnType: 'void',
          isAsync: false,
          decorators: [],
          graph: childGraph
        }
      }
    ];
    const rootEdges = [
      { id: 'e_start_ext', source: 'start', sourceHandle: 'next', target: extendsId, targetHandle: 'in' },
      { id: 'e_ext_ready', source: extendsId, sourceHandle: 'next', target: readyFuncId, targetHandle: 'in' }
    ];
    return {
      format: 'nizyla.geometry-code',
      version: 2,
      target: 'gdscript',
      variables: [],
      nodes: rootNodes,
      edges: rootEdges,
      viewport: { x: 0, y: 0, zoom: 1 },
      isMigratedV1: true
    };
  }
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
  if (errors.length) return { document: null, diagnostics: errors };

  if (document.version === 1) {
    const migrated = migrateV1ToV2(document);
    return { document: migrated, diagnostics: validateGeometryDocument(migrated) };
  }

  return { document, diagnostics: validateGeometryDocument(document) };
}

function serializeNode(node) {
  const def = nodeDefinitions[node.type];
  const defaults = def ? def.defaults : {};
  const data = {};
  for (const key of Object.keys(defaults)) {
    if (key === 'graph' && node.data?.graph) {
      data.graph = {
        nodes: node.data.graph.nodes.map(serializeNode),
        edges: node.data.graph.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
        variables: node.data.graph.variables.map(({ id, name, type, initialValue }) => ({
          id, name, type,
          initialValue: type === 'list' ? [] : type === 'dict' ? {} : initialValue
        })),
        viewport: { x: node.data.graph.viewport.x, y: node.data.graph.viewport.y, zoom: node.data.graph.viewport.zoom }
      };
    } else if (node.data && node.data[key] !== undefined) {
      data[key] = node.data[key];
    } else if (defaults[key] !== undefined) {
      data[key] = defaults[key];
    }
  }
  // Extra properties for specific nodes like functionDef parameters
  if (node.type === 'dict') {
    data.entries = (node.data?.entries || []).map(({ id, key }) => ({ id: String(id), key: String(key ?? '') }));
  }
  if (node.type === 'start' && node.data?.mainGuard === true) {
    data.mainGuard = true;
  }
  if (node.type === 'functionDef' && Array.isArray(node.data?.parameters)) {
    data.parameters = node.data.parameters.map(({ id, name, type, defaultValue }) => ({
      id, name, type: type || 'any', ...(defaultValue !== undefined ? { defaultValue } : {})
    }));
  }
  if (node.type === 'classDef') {
    data.baseClass = node.data?.baseClass || '';
  }
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data
  };
}

export function serializeGeometryDocument(document) {
  const errors = schemaDiagnostics(document);
  if (errors.length) throw new TypeError(errors.map((item) => item.message).join(' '));
  const { format, version, target, variables, nodes, edges, viewport } = document;
  const out = {
    format,
    version,
    target,
    variables: variables.map(({ id, name, type, initialValue }) => ({
      id, name, type,
      initialValue: type === 'list' ? [] : type === 'dict' ? {} : initialValue
    })),
    nodes: nodes.map(serializeNode),
    edges: edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
  };
  return JSON.stringify(out, null, 2) + '\n';
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

function validateSingleGraph(graph, scopePath = [], enclosingSymbols = new Map(), diagnostics = []) {
  const error = (code, message, location = {}) => diagnostics.push(diagnostic(code, message, { ...location, scopePath }));
  const isRoot = scopePath.length === 0;

  for (const key of ['nodes', 'edges', 'variables']) {
    const seen = new Set();
    for (const item of graph[key]) {
      if (seen.has(item.id)) error('duplicate-id', `Duplicate ${key} ID: ${item.id}.`, key === 'nodes' ? { nodeId: item.id } : key === 'edges' ? { edgeId: item.id } : {});
      seen.add(item.id);
    }
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const localVariables = new Map(graph.variables.map((variable) => [variable.id, variable]));
  const names = new Set();
  for (const variable of graph.variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name) || reservedNames.has(variable.name) || variable.name.startsWith('_gcn_')) {
      error('invalid-variable-name', `Variable ${variable.id} has an invalid or reserved name: ${variable.name}.`);
    }
    if (names.has(variable.name)) error('duplicate-variable-name', `Duplicate variable name: ${variable.name}.`);
    names.add(variable.name);
  }

  const starts = graph.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) error('start-count', 'A graph requires exactly one Start node.');

  // Combined variables for lexical scoping: local first, then enclosing
  const accessibleVariables = new Map([...enclosingSymbols, ...localVariables]);

  for (const node of graph.nodes) {
    if (node.type === 'formatText') {
      const parsed = parseTemplate(node.data?.template ?? '');
      if (parsed.error) {
        error('invalid-template', parsed.error, { nodeId: node.id });
      }
    }
    if (node.type === 'dict') {
      const seenKeys = new Set();
      for (const entry of node.data?.entries || []) {
        if (seenKeys.has(entry.key)) {
          error('duplicate-dict-key', `Duplicate dictionary key: "${entry.key}".`, { nodeId: node.id });
        }
        seenKeys.add(entry.key);
      }
    }
    if (['getVariable', 'setVariable', 'forRange'].includes(node.type)) {
      const variable = accessibleVariables.get(node.data?.variableId);
      if (!variable) error('missing-variable', `Variable ${node.data?.variableId || '(unselected)'} does not exist.`, { nodeId: node.id });
      else if (node.type === 'forRange' && variable.type !== 'int') error('for-variable-type', 'For Range requires an int variable.', { nodeId: node.id });
    }
    if (node.type === 'parameter') {
      const enclosingFunction = enclosingSymbols.get('_current_function');
      if (!enclosingFunction) {
        error('orphan-parameter', 'Parameter node is only allowed inside a function.', { nodeId: node.id });
      } else {
        const param = (enclosingFunction.parameters || []).find((p) => p.id === node.data?.parameterId);
        if (!param) {
          error('missing-parameter', `Parameter "${node.data?.name || node.data?.parameterId}" does not exist in function signature.`, { nodeId: node.id });
        }
      }
    }
    if (node.type === 'return') {
      const enclosingFunction = enclosingSymbols.get('_current_function');
      if (!enclosingFunction) {
        error('orphan-return', 'Return node is only allowed inside a function.', { nodeId: node.id });
      }
    }
  }

  const portMaps = new Map(graph.nodes.map((node) => [node.id, new Map(getNodePorts(node, [...accessibleVariables.values()]).map((p) => [p.id, p]))]));
  const execOut = new Map(graph.nodes.map((node) => [node.id, []]));
  const valueOut = new Map(graph.nodes.map((node) => [node.id, []]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, new Map()]));
  const execPorts = new Map(graph.nodes.map((node) => [node.id, new Set()]));

  for (const edge of graph.edges) {
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

  const execOrder = orderNodes(graph.nodes, execOut);
  const valueOrder = orderNodes(graph.nodes, valueOut);
  if (execOrder.length !== graph.nodes.length) error('exec-cycle', 'Execution connections contain a cycle. Use body/next instead of a back edge.');
  if (valueOrder.length !== graph.nodes.length) error('value-cycle', 'Value connections contain a cycle.');

  const used = new Set();
  const pending = starts.map((node) => node.id);
  // Function and class definitions at root module level are considered entry points / used
  for (const node of graph.nodes) {
    if (['functionDef', 'classDef', 'import'].includes(node.type)) {
      pending.push(node.id);
    }
  }

  while (pending.length) {
    const id = pending.pop();
    if (used.has(id)) continue;
    used.add(id);
    for (const edge of execOut.get(id) || []) pending.push(edge.target);
    for (const [handle, edge] of incoming.get(id) || []) {
      if (portMaps.get(id)?.get(handle)?.kind === 'value') pending.push(edge.source);
    }
  }

  for (const node of graph.nodes) {
    if (!used.has(node.id)) {
      diagnostics.push(diagnostic('unused-node', 'Node is not used by Start and will not be generated.', { nodeId: node.id, scopePath }, 'warning'));
      continue;
    }
    for (const p of portMaps.get(node.id)?.values() || []) {
      if (p.direction === 'in' && p.kind === 'value' && !incoming.get(node.id).has(p.id)) {
        // Special case: optional inputs like method target or arguments can be checked
        error('missing-input', `Connect input ${p.label ?? p.id}.`, { nodeId: node.id });
      }
    }
  }

  const outputTypes = new Map();
  for (const id of valueOrder) {
    const node = nodes.get(id);
    const types = {};
    for (const [handle, edge] of incoming.get(id) || []) {
      if (portMaps.get(id)?.get(handle)?.kind === 'value') types[handle] = outputTypes.get(edge.source) ?? 'unknown';
    }
    const ports = getNodePorts(node, [...accessibleVariables.values()], types);
    outputTypes.set(id, ports.find((p) => p.direction === 'out' && p.kind === 'value')?.valueType ?? 'unknown');
    for (const p of ports.filter((p) => p.direction === 'in' && p.kind === 'value')) {
      const actual = types[p.id];
      if (!actual || actual === 'unknown' || p.valueType === 'unknown') continue;
      const matches = p.valueType === 'any' || actual === 'any' || p.valueType === actual || p.valueType === 'number' && numeric(actual)
        || p.valueType === 'float' && actual === 'int';
      if (!matches) error('type-mismatch', `${p.id} expects ${p.valueType}, received ${actual}.`, { nodeId: id, edgeId: incoming.get(id)?.get(p.id)?.id });
    }
    if (node.type === 'compare' && ['==', '!='].includes(node.data?.operator) && types.a && types.b
      && types.a !== 'unknown' && types.b !== 'unknown' && types.a !== 'any' && types.b !== 'any'
      && types.a !== types.b && !(numeric(types.a) && numeric(types.b))) {
      error('comparison-type', 'Equality requires matching types or an int/float pair.', { nodeId: id });
    }
    if (node.type === 'forRange') {
      const step = nodes.get(incoming.get(id)?.get('step')?.source);
      if (step?.type === 'literal' && step.data?.value === 0) error('zero-step', 'For Range step must not be zero.', { nodeId: id });
    }
  }

  const scopes = new Map();
  for (const id of execOrder) {
    const node = nodes.get(id);
    const scope = scopes.get(id) ?? new Set();
    if (node.type === 'forRange' && scope.has(node.data?.variableId)) error('nested-for-variable', 'Nested For Range nodes must use different variables.', { nodeId: id });
    for (const edge of execOut.get(id) || []) {
      if (node.type === 'forRange' && edge.sourceHandle === 'body') {
        scopes.set(edge.target, new Set([...scope, node.data?.variableId]));
      } else scopes.set(edge.target, scope);
    }
  }

  // Recursive validation of child graphs
  for (const node of graph.nodes) {
    if (node.type === 'functionDef' && node.data?.graph) {
      const childSymbols = new Map(accessibleVariables);
      childSymbols.set('_current_function', { id: node.id, name: node.data.name, parameters: node.data.parameters || [] });
      for (const p of node.data.parameters || []) {
        childSymbols.set(p.id, { id: p.id, name: p.name, type: p.type || 'any' });
      }
      validateSingleGraph(node.data.graph, [...scopePath, node.id], childSymbols, diagnostics);
    }
    if (node.type === 'classDef' && node.data?.graph) {
      const childSymbols = new Map(accessibleVariables);
      childSymbols.set('_current_class', { id: node.id, name: node.data.name });
      validateSingleGraph(node.data.graph, [...scopePath, node.id], childSymbols, diagnostics);
    }
  }

  return diagnostics;
}

export function validateGeometryDocument(doc) {
  const diagnostics = schemaDiagnostics(doc);
  if (diagnostics.length) return diagnostics;
  validateSingleGraph(doc, [], new Map(), diagnostics);
  return diagnostics;
}
