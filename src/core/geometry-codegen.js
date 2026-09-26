import { getNodePorts, validateGeometryDocument, migrateV1ToV2, parseTemplate, LOOP_VARIABLE_NODE_TYPES } from './geometry.js';

// Limits keep output inside what Python (100 indent levels, 200 nested parentheses) accepts.
const MAX_BLOCK_DEPTH = 50;
const MAX_EXPRESSION_DEPTH = 64;
const MAX_EXPRESSION_CHARS = 100000;

// ponytail: Node properties only; inherited method names are not checked.
const NODE_MEMBERS = new Set(`name owner script multiplayer process_mode process_priority
  process_physics_priority process_thread_group process_thread_group_order
  process_thread_messages physics_interpolation_mode auto_translate_mode
  editor_description scene_file_path unique_name_in_owner`.split(/\s+/));

class GenerationError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.diagnostic = { severity: 'error', code, message, ...location };
  }
}

const escapes = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const hex = (char, width) => char.charCodeAt(0).toString(16).padStart(width, '0');

const TYPE_NAMES = {
  python: {
    int: 'int',
    float: 'float',
    string: 'str',
    bool: 'bool',
    list: 'list',
    dict: 'dict'
  },
  gdscript: {
    int: 'int',
    float: 'float',
    string: 'String',
    bool: 'bool',
    list: 'Array',
    dict: 'Dictionary',
    any: 'Variant'
  }
};

export function typeName(type, target) {
  if (!type) return '';
  const table = TYPE_NAMES[target];
  if (table && Object.hasOwn(table, type)) return table[type];
  return type;
}

function stringLiteral(value, target, location) {
  if (typeof value !== 'string') return '""';
  if (!value.isWellFormed() || (target === 'gdscript' && value.includes('\0'))) {
    throw new GenerationError('invalid-string-literal', 'String contains a lone surrogate or a character the target cannot store.', location);
  }
  return '"' + value.replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, (char) => escapes[char]
    ?? (target === 'python' && char < 'Ā' ? `\\x${hex(char, 2)}` : `\\u${hex(char, 4)}`)) + '"';
}

function literal(type, value, target, location) {
  if (type === 'list') return '[]';
  if (type === 'dict') return '{}';
  if (type === 'string') return stringLiteral(value, target, location);
  if (type === 'bool') return target === 'python' ? (value ? 'True' : 'False') : String(Boolean(value));
  const text = type === 'float' && Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value ?? 0);
  return Number(value) < 0 ? `(${text})` : text;
}

/** Renders a value node after its inputs are cached; iterative so deep graphs cannot overflow the stack. */
function render(node, sources, context) {
  const { cache, variables, target } = context;
  context.emitComment?.(node, context.commentDepth || 0, context.commentScope || []);
  const location = { nodeId: node.id };
  const inputs = Object.fromEntries([...sources].map(([handle, id]) => [handle, cache.get(id)]));
  const types = Object.fromEntries(Object.entries(inputs).map(([handle, item]) => [handle, item?.type]));
  const type = getNodePorts(node, [...variables.values()], types).find((p) => p.direction === 'out' && p.kind === 'value')?.valueType || 'any';
  const { a, b } = inputs;
  const operator = node.data?.operator;
  let text = '';

  if (node.type === 'literal') {
    text = literal(node.data?.valueType ?? 'int', node.data?.value, target, location);
  } else if (node.type === 'getVariable') {
    const v = variables.get(node.data?.variableId);
    text = v ? v.name : (node.data?.variableId || 'unknown_var');
  } else if (node.type === 'parameter') {
    text = node.data?.name || 'param';
  } else if (node.type === 'symbolRef') {
    text = node.data?.symbol || 'symbol';
  } else if (node.type === 'boolean' && operator === 'not') {
    text = `(not ${a?.text ?? 'False'})`;
  } else if (node.type === 'binary' && operator === '/' && target === 'gdscript') {
    text = `(float(${a?.text ?? '0'}) / ${b?.text ?? '1'})`;
  } else if (node.type === 'binary' && operator === '%' && target === 'gdscript') {
    text = types.a === 'int' && types.b === 'int'
      ? `posmod(${a?.text ?? '0'}, ${b?.text ?? '0'})`
      : `fposmod(${a?.text ?? '0'}, ${b?.text ?? '0'})`;
  } else if (node.type === 'binary' && operator === '//' && target === 'gdscript') {
    // ponytail: exact only below 2^53; switch to integer arithmetic if large ints matter
    text = types.a === 'int' && types.b === 'int'
      ? `floori(float(${a?.text ?? '0'}) / ${b?.text ?? '1'})`
      : `floor(float(${a?.text ?? '0'}) / ${b?.text ?? '1'})`;
  } else if (node.type === 'binary' || node.type === 'compare' || node.type === 'boolean') {
    text = `(${a?.text ?? '0'} ${operator} ${b?.text ?? '0'})`;
  } else if (node.type === 'getMember') {
    const obj = inputs.object?.text ?? (target === 'python' ? 'self' : 'self');
    text = `${obj}.${node.data?.memberName || 'member'}`;
  } else if (node.type === 'functionCall') {
    const targetNode = node.data?.targetId ? context.definitions?.get(node.data.targetId) : null;
    const funcName = targetNode?.data?.name || node.data?.name || 'call';
    const argNames = node.data?.argumentNames || [];
    const argTexts = argNames.map((_, i) => inputs[`arg_${i}`]?.text ?? 'None');
    if (node.data?.isMethod) {
      const targetObj = inputs.target?.text ?? 'self';
      text = `${targetObj}.${funcName}(${argTexts.join(', ')})`;
    } else {
      text = `${funcName}(${argTexts.join(', ')})`;
    }
  } else if (node.type === 'instantiate') {
    const className = node.data?.className || 'Object';
    const argNames = node.data?.argumentNames || [];
    const argTexts = argNames.map((_, i) => inputs[`arg_${i}`]?.text ?? 'None');
    if (target === 'gdscript') {
      text = `${className}.new(${argTexts.join(', ')})`;
    } else {
      text = `${className}(${argTexts.join(', ')})`;
    }
  } else if (node.type === 'codeNode') {
    text = `(${node.data?.code || 'None'})`;
  } else if (node.type === 'list') {
    const count = Number.isSafeInteger(node.data?.itemCount) ? node.data.itemCount : 0;
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(inputs[`item_${i}`]?.text ?? 'None');
    }
    text = `[${items.join(', ')}]`;
  } else if (node.type === 'array') {
    const count = Number.isSafeInteger(node.data?.itemCount) ? node.data.itemCount : 0;
    const elemType = node.data?.elementType ?? 'int';
    const items = [];
    for (let i = 0; i < count; i++) {
      const itemVal = inputs[`item_${i}`];
      const itemText = itemVal ? ((elemType === 'float' && itemVal.type === 'int') ? `float(${itemVal.text})` : itemVal.text) : 'None';
      items.push(itemText);
    }
    text = `[${items.join(', ')}]`;
  } else if (node.type === 'dict') {
    const entries = Array.isArray(node.data?.entries) ? node.data.entries : [];
    if (entries.length === 0) {
      text = '{}';
    } else {
      const pairs = entries.map((entry) => `${stringLiteral(entry.key, target, location)}: ${inputs[entry.id]?.text ?? 'None'}`);
      text = `{${pairs.join(', ')}}`;
    }
  } else if (node.type === 'getItem') {
    const container = inputs.container?.text ?? 'None';
    const key = inputs.key?.text ?? 'None';
    text = `${container}[${key}]`;
  } else if (node.type === 'length') {
    text = `len(${inputs.value?.text ?? '[]'})`;
  } else if (node.type === 'contains') {
    text = `(${inputs.item?.text ?? 'None'} in ${inputs.container?.text ?? '[]'})`;
  } else if (node.type === 'convert') {
    const to = node.data?.toType;
    const fn = to === 'float' ? 'float' : to === 'string' ? 'str' : 'int';
    const defVal = to === 'float' ? '0.0' : to === 'string' ? '""' : '0';
    text = `${fn}(${inputs.value?.text ?? defVal})`;
  } else if (node.type === 'input') {
    const prompt = node.data?.prompt;
    if (target === 'python') {
      text = prompt ? `input(${stringLiteral(prompt, 'python', location)})` : 'input()';
    } else {
      text = `_gcn_input(${stringLiteral(prompt || '', 'gdscript', location)})`;
    }
  } else if (node.type === 'formatText') {
    const parsed = parseTemplate(node.data?.template ?? 'Value: {x}');
    const { parts, names } = parsed;
    const style = node.data?.style ?? 'fstring';

    if (names.length === 0) {
      const fullText = parts.map((p) => p.text ?? '').join('');
      text = stringLiteral(fullText, target, location);
    } else if (style === 'concat') {
      const pieces = [];
      for (const p of parts) {
        if (p.text !== undefined) {
          if (p.text !== '') {
            pieces.push(stringLiteral(p.text, target, location));
          }
        } else if (p.name !== undefined) {
          const val = inputs[`{${p.name}}`];
          const valText = val?.text ?? 'None';
          if (val?.type === 'string') {
            pieces.push(valText);
          } else {
            pieces.push(`str(${valText})`);
          }
        }
      }
      if (pieces.length === 0) text = '""';
      else if (pieces.length === 1) text = pieces[0];
      else text = `(${pieces.join(' + ')})`;
    } else if (target === 'gdscript') {
      // ponytail: GDScript .format() also replaces a literal {0} in the text
      let gdTemplate = '';
      for (const p of parts) {
        if (p.text !== undefined) {
          gdTemplate += p.text;
        } else if (p.name !== undefined) {
          gdTemplate += `{${names.indexOf(p.name)}}`;
        }
      }
      const gdLit = stringLiteral(gdTemplate, 'gdscript', location);
      const gdArgs = names.map((n) => inputs[`{${n}}`]?.text ?? 'None');
      text = `${gdLit}.format([${gdArgs.join(', ')}])`;
    } else {
      // Python: fstring or format
      const fstringForbidden = /["'\\{}#\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;
      const hasRepeats = parts.filter((p) => p.name !== undefined).length > names.length;
      const hasFallback = names.some((n) => {
        const inp = inputs[`{${n}}`]?.text ?? '';
        return fstringForbidden.test(inp);
      });
      const useFormat = style === 'format' || (style === 'fstring' && hasFallback);

      if (useFormat) {
        let pyTemplate = '';
        for (const p of parts) {
          if (p.text !== undefined) {
            pyTemplate += p.text.replace(/\{/g, '{{').replace(/\}/g, '}}');
          } else if (p.name !== undefined) {
            pyTemplate += hasRepeats ? `{${names.indexOf(p.name)}}` : '{}';
          }
        }
        const pyLit = stringLiteral(pyTemplate, 'python', location);
        const argNames = hasRepeats ? names : parts.filter((p) => p.name !== undefined).map((p) => p.name);
        const pyArgs = argNames.map((n) => inputs[`{${n}}`]?.text ?? 'None');
        text = `${pyLit}.format(${pyArgs.join(', ')})`;
      } else {
        // Python fstring
        let pyBody = '';
        for (const p of parts) {
          if (p.text !== undefined) {
            const braceEscaped = p.text.replace(/\{/g, '{{').replace(/\}/g, '}}');
            if (!braceEscaped.isWellFormed()) {
              throw new GenerationError('invalid-string-literal', 'String contains a lone surrogate.', location);
            }
            const escaped = braceEscaped.replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, (char) =>
              escapes[char] ?? (char < 'Ā' ? `\\x${hex(char, 2)}` : `\\u${hex(char, 4)}`)
            );
            pyBody += escaped;
          } else if (p.name !== undefined) {
            pyBody += `{${inputs[`{${p.name}}`]?.text ?? 'None'}}`;
          }
        }
        text = `f"${pyBody}"`;
      }
    }
  } else {
    text = 'None';
  }

  const depth = 1 + Math.max(-1, ...Object.values(inputs).filter(Boolean).map((item) => item.depth));
  if (depth > MAX_EXPRESSION_DEPTH) throw new GenerationError('expression-too-deep', `Expression nesting exceeds ${MAX_EXPRESSION_DEPTH} levels.`, location);
  if (text.length > MAX_EXPRESSION_CHARS) throw new GenerationError('expression-too-large', `Expression exceeds ${MAX_EXPRESSION_CHARS} characters.`, location);
  return { text, type, depth };
}

function expression(id, context) {
  if (!id) return { text: 'None', type: 'any', depth: 0 };
  const { cache, nodes, values } = context;
  const stack = [id];
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (cache.has(current)) { stack.pop(); continue; }
    const sources = values.get(current) || new Map();
    const pending = [...sources.values()].filter((source) => !cache.has(source));
    if (pending.length) { stack.push(...pending); continue; }
    stack.pop();
    const node = nodes.get(current);
    if (context.lenient && context.errorNodeIds?.has(current)) {
      throw new GenerationError('preview-error-node', context.nodeMessages?.get(current) || 'Node has an error.', { nodeId: current });
    }
    if (!node) {
      cache.set(current, { text: 'None', type: 'any', depth: 0 });
    } else {
      cache.set(current, render(node, sources, context));
    }
  }
  return cache.get(id);
}

function generateGraphStatements(graph, baseDepth, context, scopePath = [], isClass = false) {
  const { target, sourceMap, emitLine } = context;
  const python = target === 'python';
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const variables = new Map(graph.variables.map((v) => [v.id, v]));
  const exits = new Map(graph.nodes.map((n) => [n.id, new Map()]));
  const values = new Map(graph.nodes.map((n) => [n.id, new Map()]));

  for (const edge of graph.edges) {
    if (context.lenient && context.errorEdgeIds?.has(edge.id)) continue;
    const srcNode = nodes.get(edge.source);
    if (!srcNode) continue;
    const sourcePort = getNodePorts(srcNode, [...variables.values()]).find((p) => p.id === edge.sourceHandle);
    if (!sourcePort) continue;
    if (sourcePort.kind === 'exec') {
      exits.get(edge.source).set(edge.sourceHandle, edge.target);
    } else {
      if (!values.has(edge.target)) values.set(edge.target, new Map());
      values.get(edge.target).set(edge.targetHandle, edge.source);
    }
  }

  // Merge enclosing variables with local variables for expression evaluation
  const localContext = {
    ...context,
    nodes,
    values,
    variables: new Map([...context.variables, ...variables]),
    cache: new Map()
  };

  // Emit variable declarations (for child scopes like function/class bodies; root variables are emitted in step 2)
  if (scopePath.length > 0) {
    for (const variable of graph.variables) {
      if (context.lenient && context.errorVariableIds.has(variable.id)) {
        emitLine(baseDepth, `# ⚠ skipped variable ${variable.name}: ${context.variableMessages.get(variable.id) || 'Variable has an error.'}`, null, scopePath);
        context.skippedNodeIds.add(variable.id);
        continue;
      }
      context.emitComment({ id: `variable:${variable.id}`, data: variable }, baseDepth, scopePath);
      const value = literal(variable.type, variable.initialValue, target, {});
      const line = python
        ? (isClass ? `${variable.name} = ${value}` : `${variable.name} = ${value}`)
        : `var ${variable.name}: ${typeName(variable.type, 'gdscript') || 'Variant'} = ${value}`;
      emitLine(baseDepth, line, null, scopePath);
    }
  }

  // Work stack for statement execution
  const work = [];
  const schedule = (...items) => work.push(...items.filter(Boolean).reverse());
  const chain = (id, depth) => id && { id, depth };
  const block = (id, depth) => chain(id, depth + 1) ?? { line: 'pass', depth: depth + 1, nodeId: null };

  const startNode = graph.nodes.find((n) => n.type === 'start');
  if (startNode) {
    schedule(chain(exits.get(startNode.id)?.get('next'), baseDepth));
  }

  let iterators = 0;
  let statementsEmitted = 0;

  while (work.length) {
    const item = work.pop();
    if (item.line) {
      emitLine(item.depth, item.line, item.nodeId, scopePath);
      statementsEmitted++;
      continue;
    }
    const { id, depth } = item;
    const node = nodes.get(id);
    if (!node) continue;
    const exit = (handle) => exits.get(id)?.get(handle);
    const inputVal = (handle) => expression(values.get(id)?.get(handle), localContext);
    const lineStart = context.lines.length;
    const mapStart = context.sourceMap.length;
    context.commentDepth = depth;
    context.commentScope = scopePath;
    context.emitComment?.(node, depth, scopePath);
    if (context.lenient && context.errorNodeIds?.has(id)) {
      context.lines.splice(lineStart);
      context.sourceMap.splice(mapStart);
      if (!['functionDef', 'classDef'].includes(node.type)) {
        context.emitLine(depth, `# ⚠ skipped ${context.nodeLabels?.get(id) || node.type}: ${context.nodeMessages?.get(id) || 'Node has an error.'}`, id, scopePath);
        context.skippedNodeIds.add(id);
      }
      schedule(chain(exit('next'), depth));
      continue;
    }

    try {
    if (node.type === 'setVariable') {
      const variable = localContext.variables.get(node.data?.variableId);
      const varName = variable ? variable.name : (node.data?.variableId || 'v');
      const val = inputVal('value');
      const cast = variable && variable.type === 'float' && val.type === 'int' ? `float(${val.text})` : val.text;
      emitLine(depth, `${varName} = ${cast}`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'print') {
      const count = Number.isSafeInteger(node.data?.argCount) ? node.data.argCount : 1;
      const args = [];
      if (count >= 1) args.push(inputVal('value').text);
      for (let i = 1; i < count; i++) {
        args.push(inputVal(`value_${i}`).text);
      }
      if (python) {
        emitLine(depth, `print(${args.join(', ')})`, id, scopePath);
      } else {
        if (count >= 2) {
          emitLine(depth, `prints(${args.join(', ')})`, id, scopePath);
        } else {
          emitLine(depth, `print(${args.join(', ')})`, id, scopePath);
        }
      }
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'setItem') {
      const container = inputVal('container').text;
      const key = inputVal('key').text;
      const val = inputVal('value').text;
      emitLine(depth, `${container}[${key}] = ${val}`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'append') {
      const list = inputVal('list').text;
      const val = inputVal('value').text;
      emitLine(depth, `${list}.append(${val})`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'if') {
      emitLine(depth, `if ${inputVal('condition').text}:`, id, scopePath);
      statementsEmitted++;
      schedule(
        block(exit('then'), depth),
        exit('else') && { line: 'else:', depth, nodeId: id },
        exit('else') && chain(exit('else'), depth + 1),
        chain(exit('next'), depth)
      );
    } else if (node.type === 'while') {
      emitLine(depth, `while ${inputVal('condition').text}:`, id, scopePath);
      statementsEmitted++;
      schedule(block(exit('body'), depth), chain(exit('next'), depth));
    } else if (node.type === 'forRange') {
      const iterator = `_gcn_i${iterators++}`;
      emitLine(depth, `for ${iterator} in range(${inputVal('start').text}, ${inputVal('stop').text}, ${inputVal('step').text}):`, id, scopePath);
      const variable = localContext.variables.get(node.data?.variableId);
      const varName = variable ? variable.name : (node.data?.variableId || 'v');
      emitLine(depth + 1, `${varName} = ${iterator}`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('body'), depth + 1), chain(exit('next'), depth));
    } else if (node.type === 'forEach') {
      const iterator = `_gcn_i${iterators++}`;
      emitLine(depth, `for ${iterator} in ${inputVal('items').text}:`, id, scopePath);
      const variable = localContext.variables.get(node.data?.variableId);
      const varName = variable ? variable.name : (node.data?.variableId || 'v');
      emitLine(depth + 1, `${varName} = ${iterator}`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('body'), depth + 1), chain(exit('next'), depth));
    } else if (node.type === 'return') {
      if (node.data?.hasValue !== false) {
        emitLine(depth, `return ${inputVal('value').text}`, id, scopePath);
      } else {
        emitLine(depth, 'return', id, scopePath);
      }
      statementsEmitted++;
      // return ends control flow for this branch
    } else if (node.type === 'break') {
      emitLine(depth, 'break', id, scopePath);
      statementsEmitted++;
      // break ends control flow for this branch
    } else if (node.type === 'continue') {
      emitLine(depth, 'continue', id, scopePath);
      statementsEmitted++;
      // continue ends control flow for this branch
    } else if (node.type === 'functionCall') {
      const targetNode = node.data?.targetId ? context.definitions?.get(node.data.targetId) : null;
      const funcName = targetNode?.data?.name || node.data?.name || 'call';
      const argNames = node.data?.argumentNames || [];
      const argTexts = argNames.map((_, i) => inputVal(`arg_${i}`).text);
      if (node.data?.isMethod) {
        const targetObj = inputVal('target').text;
        emitLine(depth, `${targetObj}.${funcName}(${argTexts.join(', ')})`, id, scopePath);
      } else {
        emitLine(depth, `${funcName}(${argTexts.join(', ')})`, id, scopePath);
      }
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'setMember') {
      const targetObj = inputVal('object').text;
      const member = node.data?.memberName || 'member';
      const val = inputVal('value').text;
      emitLine(depth, `${targetObj}.${member} = ${val}`, id, scopePath);
      statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (node.type === 'codeNode') {
      const codeLines = (node.data?.code || 'pass').split('\n');
      for (const cl of codeLines) emitLine(depth, cl, id, scopePath);
      if (codeLines.some((line) => line.trim() && !line.trim().startsWith('#'))) statementsEmitted++;
      schedule(chain(exit('next'), depth));
    } else if (['functionDef', 'classDef', 'import'].includes(node.type)) {
      // Definitions in execution chain
      schedule(chain(exit('next'), depth));
    }
    } catch (error) {
      if (!context.lenient || !(error instanceof GenerationError)) throw error;
      context.lines.splice(lineStart);
      context.sourceMap.splice(mapStart);
      context.emitLine(depth, `# ⚠ skipped ${context.nodeLabels?.get(id) || node.type}: ${context.nodeMessages?.get(id) || error.message}`, id, scopePath);
      context.skippedNodeIds.add(id);
      schedule(chain(exit('next'), depth));
    }
  }

  return statementsEmitted;
}

function generateFunction(node, baseDepth, context, scopePath = [], isClassMethod = false) {
  const { target, emitLine, emptyLine } = context;
  const python = target === 'python';
  const name = node.data?.name || 'func';
  const rawParams = node.data?.parameters || [];
  const returnType = node.data?.returnType;

  // In Python class methods, ensure 'self' is the first parameter
  let paramsList = [...rawParams];
  if (python && isClassMethod) {
    if (!paramsList.some((p) => p.name === 'self')) {
      paramsList = [{ name: 'self' }, ...paramsList];
    }
  }

  const formattedParams = paramsList.map((p) => {
    let s = p.name;
    if (p.type && p.type !== 'any') {
      s += `: ${typeName(p.type, target)}`;
    }
    if (p.defaultValue !== undefined && p.defaultValue !== null && p.defaultValue !== '') {
      s += ` = ${p.defaultValue}`;
    }
    return s;
  }).join(', ');

  context.emitComment(node, baseDepth, scopePath);
  // Decorators
  for (const dec of node.data?.decorators || []) {
    emitLine(baseDepth, dec.startsWith('@') ? dec : `@${dec}`, node.id, scopePath);
  }

  let sig;
  if (python) {
    const retType = typeName(returnType, 'python');
    const ret = returnType && returnType !== 'any' && returnType !== 'void' && retType ? ` -> ${retType}` : '';
    const asyncKw = node.data?.isAsync ? 'async ' : '';
    sig = `${asyncKw}def ${name}(${formattedParams})${ret}:`;
  } else {
    const retType = typeName(returnType, 'gdscript');
    const ret = returnType && returnType !== 'any' && returnType !== 'void' && retType ? ` -> ${retType}` : '';
    sig = `func ${name}(${formattedParams})${ret}:`;
  }

  emitLine(baseDepth, sig, node.id, scopePath);

  const childScope = [...scopePath, node.id];
  let count = 0;

  if (python && node.data?.graph) {
    const rootVars = context.rootVariablesList || [];
    const assignedIds = new Set();
    for (const n of node.data.graph.nodes || []) {
      if ((n.type === 'setVariable' || LOOP_VARIABLE_NODE_TYPES.includes(n.type)) && n.data?.variableId) {
        assignedIds.add(n.data.variableId);
      }
    }
    const paramNames = new Set((paramsList || []).map((p) => p.name));
    const localVarNames = new Set((node.data.graph.variables || []).map((v) => v.name));

    const globalNames = [];
    for (const v of rootVars) {
      if (assignedIds.has(v.id) && !paramNames.has(v.name) && !localVarNames.has(v.name)) {
        globalNames.push(v.name);
      }
    }
    if (globalNames.length > 0) {
      emitLine(baseDepth + 1, `global ${globalNames.join(', ')}`, node.id, childScope);
      count++;
    }
  }

  if (node.data?.graph) {
    count += generateGraphStatements(node.data.graph, baseDepth + 1, context, childScope, false);
  }
  if (count === 0 && (!node.data?.graph || node.data.graph.variables.length === 0)) {
    emitLine(baseDepth + 1, 'pass', node.id, childScope);
  }
  emptyLine();
}

function generateClass(node, baseDepth, context, scopePath = []) {
  const { target, emitLine, emptyLine } = context;
  const python = target === 'python';
  const name = node.data?.name || 'MyClass';
  const baseClass = node.data?.baseClass;

  context.emitComment(node, baseDepth, scopePath);
  for (const dec of node.data?.decorators || []) {
    emitLine(baseDepth, dec.startsWith('@') ? dec : `@${dec}`, node.id, scopePath);
  }

  if (python) {
    const inherit = baseClass ? `(${baseClass})` : '';
    emitLine(baseDepth, `class ${name}${inherit}:`, node.id, scopePath);
  } else {
    const inherit = baseClass ? ` extends ${baseClass}` : '';
    emitLine(baseDepth, `class ${name}${inherit}:`, node.id, scopePath);
  }

  const childScope = [...scopePath, node.id];
  const graph = node.data?.graph;
  let itemsEmitted = 0;

  if (graph) {
    // Generate class-level variables
    for (const variable of graph.variables || []) {
      const value = literal(variable.type, variable.initialValue, target, {});
      const line = (!python && variable.declaration)
        ? variable.declaration
        : python ? `${variable.name} = ${value}`
        : `var ${variable.name}: ${typeName(variable.type, 'gdscript') || 'Variant'} = ${value}`;
      emitLine(baseDepth + 1, line, null, childScope);
      itemsEmitted++;
    }

    // Generate methods inside class
    for (const childNode of graph.nodes || []) {
      if (childNode.type === 'functionDef') {
        generateFunction(childNode, baseDepth + 1, context, childScope, true);
        itemsEmitted++;
      }
    }

    if (!python && scopeUsesInput(graph)) {
      emitLine(baseDepth + 1, 'static func _gcn_input(prompt: String = "") -> String:', null, childScope);
      emitLine(baseDepth + 2, 'printraw(prompt)', null, childScope);
      emitLine(baseDepth + 2, 'return OS.read_string_from_stdin().trim_suffix("\\n").trim_suffix("\\r")', null, childScope);
      emptyLine();
      itemsEmitted++;
    }

    // Statements from start inside class (if any)
    const stmtCount = generateGraphStatements(graph, baseDepth + 1, context, childScope, true);
    itemsEmitted += stmtCount;
  }

  if (itemsEmitted === 0) {
    emitLine(baseDepth + 1, 'pass', node.id, childScope);
  }
  emptyLine();
}

function scopeUsesInput(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return false;
  for (const node of graph.nodes) {
    if (node.type === 'input') return true;
    if (node.type === 'functionDef' && node.data?.graph) {
      if (scopeUsesInput(node.data.graph)) return true;
    }
  }
  return false;
}

function hasExecutableStatements(graph) {
  const startNode = graph.nodes.find((n) => n.type === 'start');
  if (!startNode) return false;

  const exits = new Map(graph.nodes.map((n) => [n.id, new Map()]));
  for (const edge of graph.edges) {
    if (!exits.has(edge.source)) exits.set(edge.source, new Map());
    exits.get(edge.source).set(edge.sourceHandle, edge.target);
  }

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const visited = new Set();
  const queue = [exits.get(startNode.id)?.get('next')];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);

    const node = nodes.get(currentId);
    if (!node) continue;

    if (!['functionDef', 'classDef', 'import'].includes(node.type)) {
      return true;
    }

    const nodeExits = exits.get(currentId);
    if (nodeExits) {
      for (const nextId of nodeExits.values()) {
        queue.push(nextId);
      }
    }
  }

  return false;
}

function generate(doc, target, options = {}) {
  // If v1, migrate first
  const workingDoc = doc.version === 1 ? migrateV1ToV2({ ...doc, target }) : doc;
  const python = target === 'python';
  const sourceMap = [];
  const lines = [];

  const emitLine = (depth, text, nodeId = null, scopePath = []) => {
    if (depth > MAX_BLOCK_DEPTH) throw new GenerationError('block-too-deep', `Blocks are nested deeper than ${MAX_BLOCK_DEPTH} levels.`);
    const indent = '    '.repeat(depth);
    lines.push(indent + text);
    sourceMap.push({
      line: lines.length,
      nodeId,
      scopePath: [...scopePath]
    });
  };

  const emptyLine = () => {
    lines.push('');
  };

  const definitions = new Map();
  const collectDefinitions = (graph) => {
    for (const node of graph.nodes || []) {
      if (node.type === 'functionDef' || node.type === 'classDef') definitions.set(node.id, node);
      if (node.data?.graph) collectDefinitions(node.data.graph);
    }
  };
  collectDefinitions(workingDoc);

  const rootVariables = new Map((workingDoc.variables || []).map((v) => [v.id, v]));
  const context = {
    target,
    sourceMap,
    lines,
    lenient: options.lenient === true,
    errorNodeIds: options.errorNodeIds || new Set(),
    errorEdgeIds: options.errorEdgeIds || new Set(),
    skippedNodeIds: options.skippedNodeIds || new Set(),
    nodeMessages: options.nodeMessages || new Map(),
    nodeLabels: options.nodeLabels || new Map(),
    errorVariableIds: options.errorVariableIds || new Set(),
    variableMessages: options.variableMessages || new Map(),
    commentSeen: new Set(),
    emitLine,
    emptyLine,
    variables: rootVariables,
    rootVariablesList: workingDoc.variables || [],
    definitions
  };
  context.emitComment = (node, depth, scopePath = []) => {
    const comment = typeof node?.data?.comment === 'string' ? node.data.comment.replace(/\r/g, '').trim() : '';
    if (!comment || context.commentSeen.has(node.id)) return;
    context.commentSeen.add(node.id);
    for (const line of comment.split('\n')) emitLine(depth, line ? `# ${line}` : '#', node.id, scopePath);
  };

  // If this is a migrated v1 document:
  if (workingDoc.isMigratedV1) {
    if (python) {
      const mainFunc = workingDoc.nodes.find((n) => n.type === 'functionDef' && n.data?.name === 'main');
      emitLine(0, 'def main():', mainFunc?.id);
      if (mainFunc?.data?.graph) {
        const count = generateGraphStatements(mainFunc.data.graph, 1, context, [mainFunc.id]);
        if (count === 0 && mainFunc.data.graph.variables.length === 0) {
          emitLine(1, 'pass', mainFunc.id, [mainFunc.id]);
        }
      } else {
        emitLine(1, 'pass', mainFunc?.id);
      }
      emptyLine();
      emptyLine();
      emitLine(0, 'if __name__ == "__main__":');
      emitLine(1, 'main()');
      return { code: lines.join('\n') + '\n', sourceMap };
    } else {
      // GDScript migrated v1
      const readyFunc = workingDoc.nodes.find((n) => n.type === 'functionDef' && n.data?.name === '_ready');
      emitLine(0, 'extends Node');
      emptyLine();
      if (scopeUsesInput(workingDoc)) {
        emitLine(0, 'static func _gcn_input(prompt: String = "") -> String:');
        emitLine(1, 'printraw(prompt)');
        emitLine(1, 'return OS.read_string_from_stdin().trim_suffix("\\n").trim_suffix("\\r")');
        emptyLine();
      }
      emitLine(0, 'func _ready():', readyFunc?.id);
      if (readyFunc?.data?.graph) {
        const count = generateGraphStatements(readyFunc.data.graph, 1, context, [readyFunc.id]);
        if (count === 0 && readyFunc.data.graph.variables.length === 0) {
          emitLine(1, 'pass', readyFunc.id, [readyFunc.id]);
        }
      } else {
        emitLine(1, 'pass', readyFunc?.id);
      }
      return { code: lines.join('\n') + '\n', sourceMap };
    }
  }

  // --- General v2 module generation ---
  // 1. Imports
  const hasGdExtends = !python && workingDoc.nodes.some((n) => n.type === 'import' && n.data?.importType === 'gd_extends');
  if (!python && !hasGdExtends) {
    emitLine(0, 'extends Node');
    emptyLine();
  }

  let importsEmitted = 0;
  for (const node of workingDoc.nodes) {
    if (node.type === 'import') {
      const d = node.data || {};
      context.emitComment(node, 0, []);
      if (python) {
        if (d.importType === 'from') {
          const dots = '.'.repeat(d.level || 0);
          const fromMod = d.module ? `${dots}${d.module}` : dots;
          const names = (d.names || []).map((n) => n.alias ? `${n.name} as ${n.alias}` : n.name).join(', ');
          emitLine(0, `from ${fromMod} import ${names || '*'}`, node.id);
          importsEmitted++;
        } else {
          const mod = d.module || '';
          const alias = d.names?.[0]?.alias;
          emitLine(0, alias ? `import ${mod} as ${alias}` : `import ${mod}`, node.id);
          importsEmitted++;
        }
      } else {
        // GDScript
        if (d.importType === 'gd_extends') {
          emitLine(0, `extends ${d.module || 'Node'}`, node.id);
          importsEmitted++;
        } else if (d.importType === 'gd_class_name') {
          emitLine(0, `class_name ${d.module || 'MyClass'}`, node.id);
          importsEmitted++;
        } else if (d.importType === 'gd_preload') {
          const varName = d.names?.[0]?.name || 'PreloadResource';
          emitLine(0, `const ${varName} = preload("${d.module || ''}")`, node.id);
          importsEmitted++;
        } else if (d.importType === 'gd_load') {
          const varName = d.names?.[0]?.name || 'LoadedResource';
          emitLine(0, `var ${varName} = load("${d.module || ''}")`, node.id);
          importsEmitted++;
        }
      }
    }
  }

  // Separate imports from definitions if any imports were emitted
  if (importsEmitted > 0) emptyLine();

  // 2. Module Variables
  if (!python) {
    for (const variable of workingDoc.variables) {
      if (NODE_MEMBERS.has(variable.name)) {
        throw new GenerationError('gdscript-member-conflict', `Variable "${variable.name}" clashes with Node.${variable.name} in GDScript; rename it.`);
      }
    }
  }

  for (const variable of workingDoc.variables) {
    if (context.lenient && context.errorVariableIds.has(variable.id)) {
      emitLine(0, `# ⚠ skipped variable ${variable.name}: ${context.variableMessages.get(variable.id) || 'Variable has an error.'}`);
      context.skippedNodeIds.add(variable.id);
      continue;
    }
    context.emitComment({ id: `variable:${variable.id}`, data: variable }, 0, []);
    const value = literal(variable.type, variable.initialValue, target, {});
    const line = (!python && variable.declaration)
      ? variable.declaration
      : python ? `${variable.name} = ${value}`
      : `var ${variable.name}: ${typeName(variable.type, 'gdscript') || 'Variant'} = ${value}`;
    emitLine(0, line);
  }

  if (!python && workingDoc.variables.length > 0) {
    emptyLine();
  }

  // 3. Classes
  for (const node of workingDoc.nodes) {
    if (node.type === 'classDef') {
      if (context.lenient && context.errorNodeIds.has(node.id)) { context.emitComment(node, 0, []); emitLine(0, `# ⚠ skipped ${context.nodeLabels.get(node.id) || `Class ${node.data?.name || 'Class'}`}: ${context.nodeMessages.get(node.id) || 'Class has an error.'}`, node.id); context.skippedNodeIds.add(node.id); }
      else generateClass(node, 0, context, []);
    }
  }

  // 4. Functions
  for (const node of workingDoc.nodes) {
    if (node.type === 'functionDef') {
      if (context.lenient && context.errorNodeIds.has(node.id)) { context.emitComment(node, 0, []); emitLine(0, `# ⚠ skipped ${context.nodeLabels.get(node.id) || `Function ${node.data?.name || 'func'}`}: ${context.nodeMessages.get(node.id) || 'Function has an error.'}`, node.id); context.skippedNodeIds.add(node.id); }
      else generateFunction(node, 0, context, [], false);
    }
  }

  if (!python && scopeUsesInput(workingDoc)) {
    emitLine(0, 'static func _gcn_input(prompt: String = "") -> String:');
    emitLine(1, 'printraw(prompt)');
    emitLine(1, 'return OS.read_string_from_stdin().trim_suffix("\\n").trim_suffix("\\r")');
    emptyLine();
  }

  // 5. Root statements from Start node
  const startNode = workingDoc.nodes.find((n) => n.type === 'start');
  if (python) {
    if (startNode) {
      if (startNode.data?.mainGuard === true) {
        context.emitComment(startNode, 0, []);
        emitLine(0, 'if __name__ == "__main__":', startNode.id);
        const count = generateGraphStatements(workingDoc, 1, context, []);
        if (count === 0) {
          emitLine(1, 'pass');
        }
      } else {
        context.emitComment(startNode, 0, []);
        generateGraphStatements(workingDoc, 0, context, []);
      }
    }

    if (lines.length === 0) {
      emitLine(0, 'pass');
    }
  } else {
    // GDScript
    const userReadyFunc = workingDoc.nodes.find((n) => n.type === 'functionDef' && n.data?.name === '_ready');
    const startHasStatements = hasExecutableStatements(workingDoc);

    if (startHasStatements && userReadyFunc) {
      throw new GenerationError('gdscript-ready-conflict', 'Start statements become _ready() in GDScript; rename this function or move its body under Start.', { nodeId: userReadyFunc.id });
    }

    if (!userReadyFunc) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        emptyLine();
      }
      context.emitComment(startNode, 0, []);
      emitLine(0, 'func _ready():', startNode?.id);
      const count = startNode ? generateGraphStatements(workingDoc, 1, context, []) : 0;
      if (count === 0) {
        emitLine(1, 'pass');
      }
    }
  }

  // Ensure trailing newline
  let resultText = lines.join('\n');
  if (!resultText.endsWith('\n')) resultText += '\n';

  return { code: resultText, sourceMap };
}

/** Generates Python or GDScript from a valid graph. `target` overrides document.target for this call only. */
export function generateGeometryPreview(document, target = document?.target) {
  const diagnostics = validateGeometryDocument(document);
  const structural = diagnostics.some((item) => item.severity === 'error' && !item.nodeId && !item.edgeId && !item.variableId);
  if (target !== 'python' && target !== 'gdscript') diagnostics.push({ severity: 'error', code: 'unsupported-target', message: 'Target must be python or gdscript.' });
  if (structural || diagnostics.some((item) => item.code === 'unsupported-target')) return { code: '', diagnostics, sourceMap: [], skippedNodeIds: [] };
  const errorNodeIds = new Set(diagnostics.filter((item) => item.severity === 'error' && item.nodeId).map((item) => item.nodeId));
  const errorEdgeIds = new Set(diagnostics.filter((item) => item.severity === 'error' && item.edgeId).map((item) => item.edgeId));
  const errorVariableIds = new Set(diagnostics.filter((item) => item.severity === 'error' && item.variableId).map((item) => item.variableId));
  const nodeMessages = new Map();
  const variableMessages = new Map();
  for (const item of diagnostics) {
    if (item.severity === 'error' && item.nodeId && !nodeMessages.has(item.nodeId)) nodeMessages.set(item.nodeId, item.message);
    if (item.severity === 'error' && item.variableId && !variableMessages.has(item.variableId)) variableMessages.set(item.variableId, item.message);
  }
  const nodeLabels = new Map();
  const variables = new Map((document.variables || []).map((v) => [v.id, v]));
  const visitLabels = (graph) => {
    for (const node of graph?.nodes || []) {
      if (node.type === 'print') nodeLabels.set(node.id, 'Print');
      else if (node.type === 'functionDef') nodeLabels.set(node.id, `Function ${node.data?.name || 'func'}`);
      else if (node.type === 'classDef') nodeLabels.set(node.id, `Class ${node.data?.name || 'Class'}`);
      else if (node.type === 'setVariable') nodeLabels.set(node.id, `Set ${variables.get(node.data?.variableId)?.name || 'variable'}`);
      else nodeLabels.set(node.id, node.type);
      if (node.data?.graph) visitLabels(node.data.graph);
    }
  };
  visitLabels(document);
  for (const graph of [document]) {
    const markVariableNodes = (g) => {
      for (const node of g?.nodes || []) {
        if (node.data?.variableId && errorVariableIds.has(node.data.variableId)) {
          errorNodeIds.add(node.id);
          const variable = variables.get(node.data.variableId);
          if (variable) nodeMessages.set(node.id, `uses invalid variable "${variable.name}"`);
        }
        if (node.data?.graph) markVariableNodes(node.data.graph);
      }
    };
    markVariableNodes(graph);
  }
  const skippedNodeIds = new Set();
  try {
    const result = generate(document, target, { lenient: true, errorNodeIds, errorEdgeIds, skippedNodeIds, nodeMessages, nodeLabels, errorVariableIds, variableMessages });
    return { code: result.code || '', diagnostics, sourceMap: result.sourceMap, skippedNodeIds: [...skippedNodeIds] };
  } catch (error) {
    return { code: '', diagnostics: [...diagnostics, { severity: 'error', code: 'preview-generation', message: error.message }], sourceMap: [], skippedNodeIds: [...skippedNodeIds] };
  }
}

export function generateGeometryCode(document, target = document?.target) {
  const diagnostics = validateGeometryDocument(document);
  if (target !== 'python' && target !== 'gdscript') {
    diagnostics.push({ severity: 'error', code: 'unsupported-target', message: 'Target must be python or gdscript.' });
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { code: null, diagnostics, sourceMap: [] };
  try {
    const result = generate(document, target);
    return { code: result.code, diagnostics, sourceMap: result.sourceMap };
  } catch (error) {
    if (error instanceof GenerationError) return { code: null, diagnostics: [...diagnostics, error.diagnostic], sourceMap: [] };
    if (error instanceof RangeError) {
      return { code: null, diagnostics: [...diagnostics, { severity: 'error', code: 'generation-limit', message: 'Graph is too large or deep to generate.' }], sourceMap: [] };
    }
    throw error;
  }
}
