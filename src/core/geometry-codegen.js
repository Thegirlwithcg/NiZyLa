import { getNodePorts, validateGeometryDocument } from './geometry.js';

// Limits keep output inside what Python (100 indent levels, 200 nested parentheses) accepts.
const MAX_BLOCK_DEPTH = 50;
const MAX_EXPRESSION_DEPTH = 64;
const MAX_EXPRESSION_CHARS = 100000;

class GenerationError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.diagnostic = { severity: 'error', code, message, ...location };
  }
}

const escapes = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const hex = (char, width) => char.charCodeAt(0).toString(16).padStart(width, '0');

function stringLiteral(value, target, location) {
  if (!value.isWellFormed() || (target === 'gdscript' && value.includes('\0'))) {
    throw new GenerationError('invalid-string-literal', 'String contains a lone surrogate or a character the target cannot store.', location);
  }
  return '"' + value.replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, (char) => escapes[char]
    ?? (target === 'python' && char < 'Ā' ? `\\x${hex(char, 2)}` : `\\u${hex(char, 4)}`)) + '"';
}

function literal(type, value, target, location) {
  if (type === 'string') return stringLiteral(value, target, location);
  if (type === 'bool') return target === 'python' ? (value ? 'True' : 'False') : String(value);
  const text = type === 'float' && Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value);
  return value < 0 ? `(${text})` : text;
}

/** Renders a value node after its inputs are cached; iterative so deep graphs cannot overflow the stack. */
function render(node, sources, context) {
  const { cache, variables, target } = context;
  const location = { nodeId: node.id };
  const inputs = Object.fromEntries([...sources].map(([handle, id]) => [handle, cache.get(id)]));
  const types = Object.fromEntries(Object.entries(inputs).map(([handle, item]) => [handle, item.type]));
  const type = getNodePorts(node, [...variables.values()], types).find((p) => p.direction === 'out' && p.kind === 'value')?.valueType;
  const { a, b } = inputs;
  const operator = node.data.operator;
  let text;
  if (node.type === 'literal') text = literal(node.data.valueType, node.data.value, target, location);
  else if (node.type === 'getVariable') text = variables.get(node.data.variableId).name;
  else if (node.type === 'boolean' && operator === 'not') text = `(not ${a.text})`;
  else if (node.type === 'binary' && operator === '/' && target === 'gdscript') text = `(float(${a.text}) / ${b.text})`;
  else text = `(${a.text} ${operator} ${b.text})`;
  const depth = 1 + Math.max(-1, ...Object.values(inputs).map((item) => item.depth));
  if (depth > MAX_EXPRESSION_DEPTH) throw new GenerationError('expression-too-deep', `Expression nesting exceeds ${MAX_EXPRESSION_DEPTH} levels.`, location);
  if (text.length > MAX_EXPRESSION_CHARS) throw new GenerationError('expression-too-large', `Expression exceeds ${MAX_EXPRESSION_CHARS} characters.`, location);
  return { text, type, depth };
}

function expression(id, context) {
  const { cache, nodes, values } = context;
  const stack = [id];
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (cache.has(current)) { stack.pop(); continue; }
    const sources = values.get(current);
    const pending = [...sources.values()].filter((source) => !cache.has(source));
    if (pending.length) { stack.push(...pending); continue; }
    stack.pop();
    cache.set(current, render(nodes.get(current), sources, context));
  }
  return cache.get(id);
}

function generate(doc, target) {
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const variables = new Map(doc.variables.map((variable) => [variable.id, variable]));
  const exits = new Map(doc.nodes.map((node) => [node.id, new Map()]));
  const values = new Map(doc.nodes.map((node) => [node.id, new Map()]));
  for (const edge of doc.edges) {
    const sourcePort = getNodePorts(nodes.get(edge.source), doc.variables).find((p) => p.id === edge.sourceHandle);
    if (sourcePort.kind === 'exec') exits.get(edge.source).set(edge.sourceHandle, edge.target);
    else values.get(edge.target).set(edge.targetHandle, edge.source);
  }
  const context = { nodes, values, variables, target, cache: new Map() };
  const python = target === 'python';
  const body = [];
  const emit = (depth, text) => {
    if (depth > MAX_BLOCK_DEPTH) throw new GenerationError('block-too-deep', `Blocks are nested deeper than ${MAX_BLOCK_DEPTH} levels.`);
    body.push('    '.repeat(depth) + text);
  };

  const declared = { int: 'int', float: 'float', string: 'String', bool: 'bool' };
  for (const variable of doc.variables) {
    const value = literal(variable.type, variable.initialValue, target, {});
    emit(1, python ? `${variable.name} = ${value}` : `var ${variable.name}: ${declared[variable.type]} = ${value}`);
  }

  // Explicit work stack: pops are in execution order, so `next` never recurses.
  const work = [];
  const schedule = (...items) => work.push(...items.filter(Boolean).reverse());
  const chain = (id, depth) => id && { id, depth };
  const block = (id, depth) => chain(id, depth + 1) ?? { line: 'pass', depth: depth + 1 };
  const startId = doc.nodes.find((node) => node.type === 'start').id;
  schedule(chain(exits.get(startId).get('next'), 1));
  let iterators = 0;
  while (work.length) {
    const item = work.pop();
    if (item.line) { emit(item.depth, item.line); continue; }
    const { id, depth } = item;
    const node = nodes.get(id);
    const exit = (handle) => exits.get(id).get(handle);
    const input = (handle) => expression(values.get(id).get(handle), context);
    if (node.type === 'setVariable') {
      const variable = variables.get(node.data.variableId);
      const value = input('value');
      emit(depth, `${variable.name} = ${variable.type === 'float' && value.type === 'int' ? `float(${value.text})` : value.text}`);
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'print') {
      emit(depth, `print(${input('value').text})`);
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'if') {
      emit(depth, `if ${input('condition').text}:`);
      schedule(block(exit('then'), depth), exit('else') && { line: 'else:', depth },
        exit('else') && chain(exit('else'), depth + 1), chain(exit('next'), depth));
    } else if (node.type === 'while') {
      emit(depth, `while ${input('condition').text}:`);
      schedule(block(exit('body'), depth), chain(exit('next'), depth));
    } else if (node.type === 'forRange') {
      const iterator = `_gcn_i${iterators++}`;
      emit(depth, `for ${iterator} in range(${input('start').text}, ${input('stop').text}, ${input('step').text}):`);
      emit(depth + 1, `${variables.get(node.data.variableId).name} = ${iterator}`);
      schedule(chain(exit('body'), depth + 1), chain(exit('next'), depth));
    }
  }
  if (!body.length) emit(1, 'pass');
  const lines = python
    ? ['def main():', ...body, '', '', 'if __name__ == "__main__":', '    main()']
    : ['extends Node', '', 'func _ready():', ...body];
  return lines.join('\n') + '\n';
}

/** Generates Python or GDScript from a valid graph. `target` overrides document.target for this call only. */
export function generateGeometryCode(document, target = document?.target) {
  const diagnostics = validateGeometryDocument(document);
  if (target !== 'python' && target !== 'gdscript') {
    diagnostics.push({ severity: 'error', code: 'unsupported-target', message: 'Target must be python or gdscript.' });
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { code: null, diagnostics };
  try {
    return { code: generate(document, target), diagnostics };
  } catch (error) {
    if (error instanceof GenerationError) return { code: null, diagnostics: [...diagnostics, error.diagnostic] };
    if (error instanceof RangeError) {
      return { code: null, diagnostics: [...diagnostics, { severity: 'error', code: 'generation-limit', message: 'Graph is too large or deep to generate.' }] };
    }
    throw error;
  }
}
