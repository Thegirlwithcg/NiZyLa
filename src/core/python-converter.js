import { createGeometryDocument, createChildGraph } from './geometry.js';
import { inferExpressionType } from './expression-type.js';
import { layoutGraph } from './geometry-layout.js';

const uuid = () => globalThis.crypto.randomUUID();

export function convertPythonAstToGcn(astResult, originalSource = '', sourceFile = null, options = {}) {
  const foldLiteralInitializers = options.foldLiteralInitializers !== false;
  if (!astResult || astResult.error) {
    return {
      document: null,
      error: astResult?.message || 'Syntax error or failed to parse Python code.',
      unattachedComments: 0
    };
  }

  const doc = createGeometryDocument('python', 2);
  if (sourceFile) doc.sourceFile = sourceFile;
  doc.nodes = [{ id: 'start', type: 'start', position: { x: 50, y: 150 }, data: {} }];
  doc.edges = [];
  doc.variables = [];

  const statements = astResult.statements || [];
  let currentX = 250;
  let currentY = 150;
  const X_STEP = 280;
  const symbolDefinitions = new Map();

  function inferVariableInitializer(expr) {
    if (!expr) return { type: 'int', initialValue: 0 };
    if (expr.type === 'Constant') {
      if (expr.value_type === 'string') return { type: 'string', initialValue: String(expr.value ?? '') };
      if (expr.value_type === 'bool') return { type: 'bool', initialValue: Boolean(expr.value) };
      if (expr.value_type === 'float') return { type: 'float', initialValue: Number(expr.value) || 0 };
      if (expr.value_type === 'int') return { type: 'int', initialValue: Number.isSafeInteger(expr.value) ? expr.value : 0 };
    }
    if (expr.type === 'Call' && expr.func?.id === 'input') return { type: 'string', initialValue: '' };
    return { type: 'int', initialValue: 0 };
  }

  function ensureVariable(graph, name, valueExpr = null) {
    let v = graph.variables.find((item) => item.name === name);
    if (!v) {
      v = { id: `v_${uuid().slice(0, 8)}`, name, ...inferVariableInitializer(valueExpr) };
      graph.variables.push(v);
    }
    return v;
  }

  // Comments are attached by statement source range, never by converter branch.
  const sourceLines = String(originalSource || '').split(/\r?\n/);
  const commentLines = new Map();
  const consumedComments = new Set();
  const commentAt = (line) => {
    const text = sourceLines[line - 1] || '';
    let quote = null;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\\\') { escaped = true; continue; }
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#') {
        const prefix = text.slice(0, i);
        const full = prefix.trim() === '';
        return { text: text.slice(i + 1).trim(), full };
      }
    }
    return null;
  };
  sourceLines.forEach((_, i) => { const c = commentAt(i + 1); if (c) commentLines.set(i + 1, c); });
  function attachComment(data, stmt) {
    const loc = stmt?.loc || {};
    const start = Number(loc.startLine);
    if (!Number.isInteger(start)) return data;
    const found = [];
    for (let line = start - 1; line >= 1; line--) {
      const c = commentLines.get(line);
      if (!c?.full || consumedComments.has(line)) break;
      found.unshift(c.text); consumedComments.add(line);
    }
    const inline = commentLines.get(start);
    if (inline && !inline.full && !consumedComments.has(start)) {
      found.push(inline.text); consumedComments.add(start);
    }
    const result = { ...data };
    if (found.length) result.comment = found.join('\n').slice(0, 2000);
    else delete result.comment;
    return result;
  }
  function markCodeComments(stmt) {
    const loc = stmt?.loc || {};
    for (let line = Number(loc.startLine); line <= Number(loc.endLine); line++) {
      if (commentLines.has(line)) consumedComments.add(line);
    }
  }
  function markVerbatimSegment(segment, startLine) {
    const first = Number(startLine);
    if (!Number.isInteger(first) || !segment) return;
    const last = first + String(segment).split(/\r?\n/).length - 1;
    for (let line = first; line <= last; line++) if (commentLines.has(line)) consumedComments.add(line);
  }
  function withComment(data, stmt) { return attachComment(data, stmt); }
  function statementHasComment(stmt) {
    const start = Number(stmt?.loc?.startLine);
    if (!Number.isInteger(start)) return false;
    if (commentLines.has(start)) return true;
    for (let line = start - 1; line >= 1; line--) {
      const c = commentLines.get(line);
      if (!c?.full || consumedComments.has(line)) break;
      return true;
    }
    return false;
  }
  function statementNode(graph, node, stmt) {
    if (!Object.hasOwn(node.data || {}, 'comment')) node.data = attachComment(node.data || {}, stmt);
    if (node.type === 'codeNode') markCodeComments(stmt);
    graph.nodes.push(node);
    return node;
  }

  function resolveCallableId(name) {
    return symbolDefinitions.get(name) || '';
  }

  function findNodeById(graph, id) {
    for (const node of graph?.nodes || []) {
      if (node.id === id) return node;
      const nested = node.data?.graph && findNodeById(node.data.graph, id);
      if (nested) return nested;
    }
    return null;
  }

  // Returns ordered ports for a call, or null when preserving the source is safer.
  function callArgumentPlan(call, funcName, isMethod) {
    const keywords = call.keywords || [];
    const named = [];
    const collectNamed = (graph) => (graph?.nodes || []).forEach((n) => {
      if (n.type === 'functionDef' && n.data?.name === funcName) named.push(n);
      if (n.data?.graph) collectNamed(n.data.graph);
    });
    collectNamed(doc);
    let targetId = resolveCallableId(funcName);
    if (isMethod && named.length === 1) targetId = named[0].id;
    if (!keywords.length && !call.has_starred_args) {
      const knownTarget = isMethod && named.length === 1 ? named[0]
        : findNodeById(doc, targetId);
      const known = knownTarget?.type === 'classDef'
        ? (knownTarget.data?.graph?.nodes || []).find((n) => n.type === 'functionDef' && n.data?.name === '__init__')?.data?.parameters
        : knownTarget?.type === 'functionDef' ? knownTarget.data?.parameters : null;
      return known ? known.filter((p) => p.name !== 'self').map((p) => p.name || 'arg') : (call.args || []).map((_, i) => `arg_${i}`);
    }
    if (call.has_starred_args) return null;
    const target = findNodeById(doc, targetId);
    let params = target?.type === 'classDef'
      ? (target.data?.graph?.nodes || []).find((n) => n.type === 'functionDef' && n.data?.name === '__init__')?.data?.parameters
      : target?.type === 'functionDef' ? target.data?.parameters : null;
    if (!params) return null;
    if (target?.type === 'classDef' || isMethod) params = params.filter((p) => p.name !== 'self');
    else params = params.map((p) => p);
    const names = params.map((p) => p.name || 'arg');
    const used = new Set();
    const result = [];
    for (let i = 0; i < (call.args || []).length; i++) {
      if (i >= names.length) return null;
      used.add(names[i]); result.push(names[i]);
    }
    for (const keyword of keywords) {
      if (!keyword.name || !names.includes(keyword.name) || used.has(keyword.name)) return null;
      used.add(keyword.name); result.push(keyword.name);
    }
    // Keep argument ports in parameter order; values are reordered by the caller below.
    return names.filter((name) => used.has(name));
  }

  function callArgumentValues(call, funcName, isMethod) {
    const ports = callArgumentPlan(call, funcName, isMethod);
    if (!ports) return null;
    const values = new Map();
    (call.args || []).forEach((value, i) => values.set(ports[i], value));
    for (const keyword of call.keywords || []) values.set(keyword.name, keyword.value);
    return ports.map((name) => ({ name, value: values.get(name) }));
  }

  function flattenPythonAdd(expr) {
    if (expr?.type === 'BinOp' && expr.operator === '+') {
      return [...flattenPythonAdd(expr.left), ...flattenPythonAdd(expr.right)];
    }
    return [expr];
  }

  function allocatePlaceholder(subExpr, placeholders, distinctPlaceholders, anonCounterRef) {
    const isName = subExpr?.type === 'Name' && Boolean(subExpr.id);
    const baseName = isName ? subExpr.id : `v${anonCounterRef.value++}`;

    let chosenName = baseName;
    const existing = placeholders.get(baseName);
    if (existing) {
      if (isName && existing.isName && existing.id === subExpr.id) {
        return { chosenName: baseName, isNew: false };
      }
      let suffix = 2;
      while (placeholders.has(`${baseName}_${suffix}`)) {
        suffix++;
      }
      chosenName = `${baseName}_${suffix}`;
      placeholders.set(chosenName, { isName, id: isName ? subExpr.id : undefined, expr: subExpr });
      distinctPlaceholders.push({ placeholderName: chosenName, expr: subExpr });
      return { chosenName, isNew: true };
    }

    placeholders.set(chosenName, { isName, id: isName ? subExpr.id : undefined, expr: subExpr });
    distinctPlaceholders.push({ placeholderName: chosenName, expr: subExpr });
    return { chosenName, isNew: true };
  }

  function buildExpression(expr, graph, posX, posY) {
    if (!expr) return null;
    const t = expr.type;

    const makeCodeExpression = () => {
      markVerbatimSegment(expr.segment, expr.lineno || 1);
      const node = {
        id: `expr_${uuid().slice(0, 8)}`,
        type: 'codeNode',
        position: { x: posX, y: posY },
        data: {
          codeKind: 'expression',
          code: expr.segment || 'None',
          language: 'python',
          sourceLocation: { startLine: expr.lineno || 1, startCol: 0, endLine: expr.lineno || 1, endCol: (expr.segment || '').length }
        }
      };
      graph.nodes.push(node);
      return { node, outputHandle: 'value' };
    };

    if (t === 'JoinedStr') {
      let template = '';
      const placeholders = new Map();
      const distinctPlaceholders = [];
      const anonRef = { value: 0 };

      for (const part of (expr.parts || [])) {
        if (typeof part.text === 'string') {
          template += part.text.replace(/\{/g, '{{').replace(/\}/g, '}}');
        } else if (part.expr) {
          const { chosenName } = allocatePlaceholder(part.expr, placeholders, distinctPlaceholders, anonRef);
          template += `{${chosenName}}`;
        }
      }

      const fmtNode = {
        id: `fmt_${uuid().slice(0, 8)}`,
        type: 'formatText',
        position: { x: posX, y: posY },
        data: { style: 'fstring', template }
      };
      graph.nodes.push(fmtNode);

      distinctPlaceholders.forEach(({ placeholderName, expr: subExpr }, index) => {
        const subRes = buildExpression(subExpr, graph, posX - 180, posY + (index * 40));
        if (subRes) {
          graph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: subRes.node.id,
            sourceHandle: subRes.outputHandle,
            target: fmtNode.id,
            targetHandle: `{${placeholderName}}`
          });
        }
      });

      return { node: fmtNode, outputHandle: 'value' };
    }

    if (t === 'CodeExpression') return makeCodeExpression();

    if (t === 'Constant' && !['int', 'float', 'string', 'bool'].includes(expr.value_type)) {
      return makeCodeExpression();
    }

    if (t === 'Constant') {
      const node = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: expr.value_type, value: expr.value }
      };
      graph.nodes.push(node);
      return { node, outputHandle: 'value' };
    }

    if (t === 'Name') {
      // A Python global binds to the module variable, never to a local declaration.
      const globalVar = graph._globalNames?.has(expr.id) ? doc.variables.find((v) => v.name === expr.id) : null;
      if (globalVar) {
        const node = { id: `get_${uuid().slice(0, 8)}`, type: 'getVariable', position: { x: posX, y: posY }, data: { variableId: globalVar.id } };
        graph.nodes.push(node);
        return { node, outputHandle: 'value' };
      }
      // Check if it's a known variable in graph, or symbol
      const isVar = (graph.variables || []).some((v) => v.name === expr.id);
      if (isVar) {
        const v = graph.variables.find((v) => v.name === expr.id);
        const node = {
          id: `get_${uuid().slice(0, 8)}`,
          type: 'getVariable',
          position: { x: posX, y: posY },
          data: { variableId: v.id }
        };
        graph.nodes.push(node);
        return { node, outputHandle: 'value' };
      }
      // Check if it's a parameter in current scope
      if (graph._currentParams?.has(expr.id)) {
        const pId = graph._currentParams.get(expr.id);
        const node = {
          id: `param_${uuid().slice(0, 8)}`,
          type: 'parameter',
          position: { x: posX, y: posY },
          data: { parameterId: pId, name: expr.id, paramType: 'any' }
        };
        graph.nodes.push(node);
        return { node, outputHandle: 'value' };
      }
      // Otherwise it's a symbol reference (e.g. math, function name, etc.)
      const node = {
        id: `sym_${uuid().slice(0, 8)}`,
        type: 'symbolRef',
        position: { x: posX, y: posY },
        data: { symbol: expr.id }
      };
      graph.nodes.push(node);
      return { node, outputHandle: 'value' };
    }

    if (t === 'BinOp' && expr.operator === '+') {
      const leaves = flattenPythonAdd(expr);
      const hasStrConstant = leaves.some(
        (leaf) => leaf?.type === 'Constant' && leaf.value_type === 'string'
      );
      if (hasStrConstant) {
        let template = '';
        const placeholders = new Map();
        const distinctPlaceholders = [];
        const anonRef = { value: 0 };

        for (const leaf of leaves) {
          if (leaf?.type === 'Constant' && leaf.value_type === 'string') {
            const text = String(leaf.value ?? '');
            template += text.replace(/\{/g, '{{').replace(/\}/g, '}}');
          } else {
            let subExpr = leaf;
            if (
              leaf?.type === 'Call' &&
              leaf.func?.id === 'str' &&
              leaf.args?.length === 1 &&
              (!leaf.keywords || leaf.keywords.length === 0) &&
              !leaf.has_keywords
            ) {
              subExpr = leaf.args[0];
            }
            const { chosenName } = allocatePlaceholder(subExpr, placeholders, distinctPlaceholders, anonRef);
            template += `{${chosenName}}`;
          }
        }

        const fmtNode = {
          id: `fmt_${uuid().slice(0, 8)}`,
          type: 'formatText',
          position: { x: posX, y: posY },
          data: { style: 'concat', template }
        };
        graph.nodes.push(fmtNode);

        distinctPlaceholders.forEach(({ placeholderName, expr: subExpr }, index) => {
          const subRes = buildExpression(subExpr, graph, posX - 180, posY + (index * 40));
          if (subRes) {
            graph.edges.push({
              id: `e_${uuid().slice(0, 8)}`,
              source: subRes.node.id,
              sourceHandle: subRes.outputHandle,
              target: fmtNode.id,
              targetHandle: `{${placeholderName}}`
            });
          }
        });

        return { node: fmtNode, outputHandle: 'value' };
      }
    }

    if (t === 'BinOp' && ['+', '-', '*', '/'].includes(expr.operator)) {
      const opNode = {
        id: `bin_${uuid().slice(0, 8)}`,
        type: 'binary',
        position: { x: posX, y: posY },
        data: { operator: expr.operator }
      };
      graph.nodes.push(opNode);

      const left = buildExpression(expr.left, graph, posX - 180, posY - 40);
      if (left) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: left.node.id,
          sourceHandle: left.outputHandle,
          target: opNode.id,
          targetHandle: 'a'
        });
      }
      const right = buildExpression(expr.right, graph, posX - 180, posY + 40);
      if (right) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: right.node.id,
          sourceHandle: right.outputHandle,
          target: opNode.id,
          targetHandle: 'b'
        });
      }
      return { node: opNode, outputHandle: 'value' };
    }

    if (t === 'Compare' && expr.operators?.length === 1 && ['==', '!=', '<', '<=', '>', '>='].includes(expr.operators[0])) {
      const compNode = {
        id: `cmp_${uuid().slice(0, 8)}`,
        type: 'compare',
        position: { x: posX, y: posY },
        data: { operator: expr.operators[0] }
      };
      graph.nodes.push(compNode);
      const left = buildExpression(expr.left, graph, posX - 180, posY - 40);
      if (left) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: left.node.id,
          sourceHandle: left.outputHandle,
          target: compNode.id,
          targetHandle: 'a'
        });
      }
      const right = buildExpression(expr.comparators[0], graph, posX - 180, posY + 40);
      if (right) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: right.node.id,
          sourceHandle: right.outputHandle,
          target: compNode.id,
          targetHandle: 'b'
        });
      }
      return { node: compNode, outputHandle: 'value' };
    }

    if (t === 'BoolOp' && ['and', 'or'].includes(expr.operator) && expr.values?.length === 2) {
      const bNode = {
        id: `bool_${uuid().slice(0, 8)}`,
        type: 'boolean',
        position: { x: posX, y: posY },
        data: { operator: expr.operator }
      };
      graph.nodes.push(bNode);
      const a = buildExpression(expr.values[0], graph, posX - 180, posY - 40);
      if (a) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: a.node.id,
          sourceHandle: a.outputHandle,
          target: bNode.id,
          targetHandle: 'a'
        });
      }
      const b = buildExpression(expr.values[1], graph, posX - 180, posY + 40);
      if (b) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: b.node.id,
          sourceHandle: b.outputHandle,
          target: bNode.id,
          targetHandle: 'b'
        });
      }
      return { node: bNode, outputHandle: 'value' };
    }

    if (t === 'UnaryNot') {
      const bNode = {
        id: `not_${uuid().slice(0, 8)}`,
        type: 'boolean',
        position: { x: posX, y: posY },
        data: { operator: 'not' }
      };
      graph.nodes.push(bNode);
      const a = buildExpression(expr.operand, graph, posX - 180, posY);
      if (a) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: a.node.id,
          sourceHandle: a.outputHandle,
          target: bNode.id,
          targetHandle: 'a'
        });
      }
      return { node: bNode, outputHandle: 'value' };
    }

    if (t === 'Attribute') {
      const getMemNode = {
        id: `mem_${uuid().slice(0, 8)}`,
        type: 'getMember',
        position: { x: posX, y: posY },
        data: { memberName: expr.attr }
      };
      graph.nodes.push(getMemNode);
      const obj = buildExpression(expr.value, graph, posX - 180, posY);
      if (obj) {
        graph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: obj.node.id,
          sourceHandle: obj.outputHandle,
          target: getMemNode.id,
          targetHandle: 'object'
        });
      }
      return { node: getMemNode, outputHandle: 'value' };
    }

    if (t === 'Call') {
      const isFormatMethod =
        expr.func?.type === 'Attribute' &&
        expr.func.attr === 'format' &&
        expr.func.value?.type === 'Constant' &&
        expr.func.value.value_type === 'string' &&
        typeof expr.func.value.value === 'string' &&
        (!expr.keywords || expr.keywords.length === 0) &&
        !expr.has_keywords &&
        !expr.has_starred_args;

      if (isFormatMethod) {
        const templateStr = expr.func.value.value;
        const formatRegex = /^(?:[^{}]|\{\{|\}\}|\{\})*$/;
        if (formatRegex.test(templateStr)) {
          let braceCount = 0;
          for (let i = 0; i < templateStr.length; ) {
            if (templateStr[i] === '{') {
              if (i + 1 < templateStr.length && templateStr[i + 1] === '{') {
                i += 2;
              } else if (i + 1 < templateStr.length && templateStr[i + 1] === '}') {
                braceCount++;
                i += 2;
              } else {
                i++;
              }
            } else if (templateStr[i] === '}' && i + 1 < templateStr.length && templateStr[i + 1] === '}') {
              i += 2;
            } else {
              i++;
            }
          }

          const callArgs = expr.args || [];
          if (braceCount === callArgs.length) {
            let template = '';
            let argIndex = 0;
            const placeholders = new Map();
            const distinctPlaceholders = [];
            const anonRef = { value: 0 };

            for (let i = 0; i < templateStr.length; ) {
              if (templateStr[i] === '{') {
                if (i + 1 < templateStr.length && templateStr[i + 1] === '{') {
                  template += '{{';
                  i += 2;
                } else if (i + 1 < templateStr.length && templateStr[i + 1] === '}') {
                  const subExpr = callArgs[argIndex++];
                  const { chosenName } = allocatePlaceholder(subExpr, placeholders, distinctPlaceholders, anonRef);
                  template += `{${chosenName}}`;
                  i += 2;
                } else {
                  template += templateStr[i++];
                }
              } else if (templateStr[i] === '}' && i + 1 < templateStr.length && templateStr[i + 1] === '}') {
                template += '}}';
                i += 2;
              } else {
                template += templateStr[i++];
              }
            }

            const fmtNode = {
              id: `fmt_${uuid().slice(0, 8)}`,
              type: 'formatText',
              position: { x: posX, y: posY },
              data: { style: 'format', template }
            };
            graph.nodes.push(fmtNode);

            distinctPlaceholders.forEach(({ placeholderName, expr: subExpr }, index) => {
              const subRes = buildExpression(subExpr, graph, posX - 180, posY + (index * 40));
              if (subRes) {
                graph.edges.push({
                  id: `e_${uuid().slice(0, 8)}`,
                  source: subRes.node.id,
                  sourceHandle: subRes.outputHandle,
                  target: fmtNode.id,
                  targetHandle: `{${placeholderName}}`
                });
              }
            });

            return { node: fmtNode, outputHandle: 'value' };
          }
        }
      }

      const funcName = expr.func?.id || expr.func?.attr || expr.segment || 'call';
      const isMethod = expr.func?.type === 'Attribute';
      const callValues = callArgumentValues(expr, funcName, isMethod);
      if (!callValues) return makeCodeExpression();
      const argNames = callValues.map((arg) => arg.name);
      const callNode = {
        id: `call_${uuid().slice(0, 8)}`,
        type: 'functionCall',
        position: { x: posX, y: posY },
        data: { targetId: isMethod ? '' : resolveCallableId(funcName), name: funcName, argumentNames: argNames, isMethod }
      };
      graph.nodes.push(callNode);

      if (isMethod && expr.func?.value) {
        const targetObj = buildExpression(expr.func.value, graph, posX - 180, posY - 40);
        if (targetObj) {
          graph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: targetObj.node.id,
            sourceHandle: targetObj.outputHandle,
            target: callNode.id,
            targetHandle: 'target'
          });
        }
      }

      callValues.forEach(({ name, value }, i) => {
        const argRes = buildExpression(value, graph, posX - 180, posY + (i + 1) * 40);
        if (argRes) graph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: argRes.node.id, sourceHandle: argRes.outputHandle, target: callNode.id, targetHandle: `arg_${i}` });
      });

      return { node: callNode, outputHandle: 'value' };
    }

    // Fallback Code Node for expression
    markVerbatimSegment(expr.segment, expr.lineno || 1);
    const codeNode = {
      id: `expr_${uuid().slice(0, 8)}`,
      type: 'codeNode',
      position: { x: posX, y: posY },
      data: {
        codeKind: 'expression',
        code: expr.segment || 'None',
        language: 'python',
        sourceLocation: { startLine: expr.lineno || 1, startCol: 0, endLine: expr.lineno || 1, endCol: (expr.segment || '').length }
      }
    };
    graph.nodes.push(codeNode);
    return { node: codeNode, outputHandle: 'value' };
  }

  function convertStatements(stmts, targetGraph, startX = 200, startY = 150, entry = null) {
    let prevId = entry?.prevId ?? 'start';
    let prevHandle = entry?.prevHandle ?? 'next';
    let curX = startX;
    let curY = startY;

    for (let stmtIndex = 0; stmtIndex < stmts.length; stmtIndex++) {
      const stmt = stmts[stmtIndex];
      if (!stmt) continue;
      const k = stmt.kind;

      if (k === 'Pass') continue;

      if (k === 'Import' || k === 'ImportFrom') {
        const impNode = {
          id: `imp_${uuid().slice(0, 8)}`,
          type: 'import',
          position: { x: curX, y: curY },
          data: {
            importType: stmt.import_type || 'module',
            module: stmt.module || '',
            level: stmt.level || 0,
            names: (stmt.names || []).map((n) => ({ id: uuid(), name: n.name, alias: n.alias || '' }))
          }
        };
        statementNode(targetGraph, impNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: impNode.id,
          targetHandle: 'in'
        });
        prevId = impNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'FunctionDef') {
        const child = createChildGraph();
        child._currentParams = new Map();
        const params = (stmt.params || []).map((p) => {
          const pid = `p_${uuid().slice(0, 8)}`;
          child._currentParams.set(p.name, pid);
          return { id: pid, name: p.name, type: p.type || 'any', defaultValue: p.default };
        });

        child._globalNames = new Set((stmt.body || []).filter((s) => s?.kind === 'Global').flatMap((s) => s.names || []));
        for (const name of child._globalNames) {
          const sourceVar = doc.variables.find((v) => v.name === name);
          if (sourceVar && !child.variables.some((v) => v.name === name)) child._globalNames.add(name);
        }
        convertStatements(stmt.body || [], child, 200, 150);
        delete child._currentParams;
        delete child._globalNames;

        const fnNode = {
          id: `fn_${uuid().slice(0, 8)}`,
          type: 'functionDef',
          position: { x: curX, y: curY },
          data: withComment({
            name: stmt.name,
            parameters: params,
            returnType: stmt.return_type || 'any',
            isAsync: Boolean(stmt.is_async),
            decorators: stmt.decorators || [],
            graph: child
          }, stmt)
        };
        statementNode(targetGraph, fnNode, stmt);
        symbolDefinitions.set(stmt.name, fnNode.id);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: fnNode.id,
          targetHandle: 'in'
        });
        prevId = fnNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'ClassDef') {
        const child = createChildGraph();
        convertStatements(stmt.body || [], child, 200, 150);

        const clsNode = {
          id: `cls_${uuid().slice(0, 8)}`,
          type: 'classDef',
          position: { x: curX, y: curY },
          data: withComment({
            name: stmt.name,
            baseClass: stmt.base || '',
            decorators: stmt.decorators || [],
            graph: child
          }, stmt)
        };
        statementNode(targetGraph, clsNode, stmt);
        symbolDefinitions.set(stmt.name, clsNode.id);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: clsNode.id,
          targetHandle: 'in'
        });
        prevId = clsNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'Global' || k === 'Nonlocal') {
        const globalComment = attachComment({}, stmt).comment;
        if (globalComment) targetGraph._pendingComment = globalComment;
        if (k === 'Global') {
          for (const name of stmt.names || []) {
            if (!doc.variables.some((v) => v.name === name)) ensureVariable(doc, name, null);
            targetGraph._globalNames ||= new Set(); targetGraph._globalNames.add(name);
          }
        }
        continue;
      }

      if (k === 'AssignVar') {
        const bindingGraph = targetGraph._globalNames?.has(stmt.name) ? doc : targetGraph;
        const inferred = inferExpressionType(stmt.value);
        let v = ensureVariable(bindingGraph, stmt.name, stmt.value);
        const hasStatementComment = statementHasComment(stmt);
        if (hasStatementComment && !bindingGraph._assignedNames?.has(stmt.name)) {
          v.initialValue = v.type === 'string' ? '' : v.type === 'bool' ? false : v.type === 'list' ? [] : v.type === 'dict' ? {} : 0;
        }
        const literalInitializer = stmt.value?.type === 'Constant' || (stmt.value?.type === 'List' && !(stmt.value.elements || []).length) || (stmt.value?.type === 'Dict' && !(stmt.value.keys || []).length);
        if (foldLiteralInitializers && inferred && literalInitializer && !hasStatementComment && !bindingGraph._assignedNames?.has(stmt.name) && !bindingGraph._usedNames?.has(stmt.name)) {
          v.type = inferred;
          v.initialValue = stmt.value.value ?? (inferred === 'string' ? String(stmt.value.value ?? '') : inferred === 'bool' ? Boolean(stmt.value.value) : inferred === 'list' ? [] : inferred === 'dict' ? {} : Number(stmt.value.value ?? 0));
          bindingGraph._assignedNames ||= new Set(); bindingGraph._assignedNames.add(stmt.name);
          continue;
        }
        bindingGraph._assignedNames ||= new Set(); bindingGraph._assignedNames.add(stmt.name);
        const setNode = {
          id: `set_${uuid().slice(0, 8)}`,
          type: 'setVariable',
          position: { x: curX, y: curY },
          data: { variableId: v.id, ...(targetGraph._pendingComment ? { comment: [targetGraph._pendingComment, attachComment({}, stmt).comment].filter(Boolean).join('\n') } : {}) }
        };
        delete targetGraph._pendingComment;
        statementNode(targetGraph, setNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: setNode.id,
          targetHandle: 'in'
        });

        const val = buildExpression(stmt.value, targetGraph, curX - 180, curY + 60);
        if (val) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: val.node.id,
            sourceHandle: val.outputHandle,
            target: setNode.id,
            targetHandle: 'value'
          });
        }

        prevId = setNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'AssignMember') {
        const setMemNode = {
          id: `setmem_${uuid().slice(0, 8)}`,
          type: 'setMember',
          position: { x: curX, y: curY },
          data: { memberName: stmt.member }
        };
        statementNode(targetGraph, setMemNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: setMemNode.id,
          targetHandle: 'in'
        });

        const obj = buildExpression(stmt.object, targetGraph, curX - 180, curY - 30);
        if (obj) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: obj.node.id,
            sourceHandle: obj.outputHandle,
            target: setMemNode.id,
            targetHandle: 'object'
          });
        }
        const val = buildExpression(stmt.value, targetGraph, curX - 180, curY + 40);
        if (val) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: val.node.id,
            sourceHandle: val.outputHandle,
            target: setMemNode.id,
            targetHandle: 'value'
          });
        }

        prevId = setMemNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'Print') {
        const values = stmt.values || (stmt.value ? [stmt.value] : []);
        const count = values.length;
        const pNode = {
          id: `print_${uuid().slice(0, 8)}`,
          type: 'print',
          position: { x: curX, y: curY },
          data: withComment({ argCount: count }, stmt)
        }; 
        statementNode(targetGraph, pNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: pNode.id,
          targetHandle: 'in'
        });

        for (let i = 0; i < count; i++) {
          const handle = i === 0 ? 'value' : `value_${i}`;
          const val = buildExpression(values[i], targetGraph, curX - 180, curY + (i * 40));
          if (val) {
            targetGraph.edges.push({
              id: `e_${uuid().slice(0, 8)}`,
              source: val.node.id,
              sourceHandle: val.outputHandle,
              target: pNode.id,
              targetHandle: handle
            });
          }
        }

        prevId = pNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'CallStmt') {
        const c = stmt.call;
        const funcName = c?.func?.id || c?.func?.attr || c?.segment || 'call';
        const isMethod = c?.func?.type === 'Attribute';
        const callValues = callArgumentValues(c || {}, funcName, isMethod);
        if (!callValues) {
          const codeNode = { id: `code_${uuid().slice(0, 8)}`, type: 'codeNode', position: { x: curX, y: curY }, data: { codeKind: 'statement', code: stmt.segment || c?.segment || '', language: 'python' } };
          statementNode(targetGraph, codeNode, stmt);
          targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: codeNode.id, targetHandle: 'in' });
          prevId = codeNode.id; prevHandle = 'next'; curX += X_STEP; continue;
        }
        const argNames = callValues.map((arg) => arg.name);
        const callNode = {
          id: `call_${uuid().slice(0, 8)}`,
          type: 'functionCall',
          position: { x: curX, y: curY },
          data: withComment({ targetId: isMethod ? '' : resolveCallableId(funcName), name: funcName, argumentNames: argNames, isMethod }, stmt)
        }; 
        statementNode(targetGraph, callNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: callNode.id,
          targetHandle: 'in'
        });

        if (isMethod && c?.func?.value) {
          const targetObj = buildExpression(c.func.value, targetGraph, curX - 180, curY - 30);
          if (targetObj) {
            targetGraph.edges.push({
              id: `e_${uuid().slice(0, 8)}`,
              source: targetObj.node.id,
              sourceHandle: targetObj.outputHandle,
              target: callNode.id,
              targetHandle: 'target'
            });
          }
        }

        callValues.forEach(({ name, value }, i) => {
          const argRes = buildExpression(value, targetGraph, curX - 180, curY + (i + 1) * 40);
          if (argRes) targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: argRes.node.id, sourceHandle: argRes.outputHandle, target: callNode.id, targetHandle: `arg_${i}` });
        });

        prevId = callNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'If') {
        const isModuleLevel = targetGraph === doc;
        const isMainGuard = stmt.is_main_guard === true;
        const orelseEmpty = !stmt.orelse || stmt.orelse.length === 0;
        const priorValid = stmts.slice(0, stmtIndex).every((s) => !s || ['Import', 'ImportFrom', 'FunctionDef', 'ClassDef', 'Pass'].includes(s.kind));
        const restArePass = stmts.slice(stmtIndex + 1).every((s) => !s || s.kind === 'Pass');

        // ponytail: collapse only when nothing executable precedes the guard; otherwise literal If nodes. Widen if real files need it.
        if (isModuleLevel && isMainGuard && orelseEmpty && restArePass && priorValid) {
          const rootStart = doc.nodes.find((n) => n.id === 'start');
          if (rootStart) {
            rootStart.data = { ...rootStart.data, mainGuard: true };
          }
          convertStatements(stmt.body || [], doc, curX, curY, { prevId, prevHandle });
          continue;
        }

        const ifNode = {
          id: `if_${uuid().slice(0, 8)}`,
          type: 'if',
          position: { x: curX, y: curY },
          data: withComment({}, stmt)
        };
        statementNode(targetGraph, ifNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: ifNode.id,
          targetHandle: 'in'
        });

        const cond = buildExpression(stmt.test, targetGraph, curX - 180, curY - 40);
        if (cond) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: cond.node.id,
            sourceHandle: cond.outputHandle,
            target: ifNode.id,
            targetHandle: 'condition'
          });
        }

        // Then block
        if (stmt.body && stmt.body.length > 0) {
          convertStatements(stmt.body, targetGraph, curX + X_STEP, curY - 80, { prevId: ifNode.id, prevHandle: 'then' });
        }

        // Else block
        if (stmt.orelse && stmt.orelse.length > 0) {
          convertStatements(stmt.orelse, targetGraph, curX + X_STEP, curY + 80, { prevId: ifNode.id, prevHandle: 'else' });
        }

        prevId = ifNode.id;
        prevHandle = 'next';
        curX += X_STEP * 2;
        continue;
      }

      if (k === 'While') {
        const wNode = {
          id: `while_${uuid().slice(0, 8)}`,
          type: 'while',
          position: { x: curX, y: curY },
          data: {}
        };
        statementNode(targetGraph, wNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: wNode.id,
          targetHandle: 'in'
        });

        const cond = buildExpression(stmt.test, targetGraph, curX - 180, curY - 40);
        if (cond) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: cond.node.id,
            sourceHandle: cond.outputHandle,
            target: wNode.id,
            targetHandle: 'condition'
          });
        }

        if (stmt.body && stmt.body.length > 0) {
          convertStatements(stmt.body, targetGraph, curX + X_STEP, curY - 60, { prevId: wNode.id, prevHandle: 'body' });
        }

        prevId = wNode.id;
        prevHandle = 'next';
        curX += X_STEP * 2;
        continue;
      }

      if (k === 'ForRange') {
        let v = ensureVariable(targetGraph, stmt.variable, { type: 'Constant', value_type: 'int', value: 0 });
        const forNode = {
          id: `for_${uuid().slice(0, 8)}`,
          type: 'forRange',
          position: { x: curX, y: curY },
          data: { variableId: v.id }
        };
        statementNode(targetGraph, forNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: forNode.id,
          targetHandle: 'in'
        });

        const startRes = buildExpression(stmt.start, targetGraph, curX - 180, curY - 40);
        if (startRes) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: startRes.node.id,
            sourceHandle: startRes.outputHandle,
            target: forNode.id,
            targetHandle: 'start'
          });
        }
        const stopRes = buildExpression(stmt.stop, targetGraph, curX - 180, curY);
        if (stopRes) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: stopRes.node.id,
            sourceHandle: stopRes.outputHandle,
            target: forNode.id,
            targetHandle: 'stop'
          });
        }
        const stepRes = buildExpression(stmt.step, targetGraph, curX - 180, curY + 40);
        if (stepRes) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: stepRes.node.id,
            sourceHandle: stepRes.outputHandle,
            target: forNode.id,
            targetHandle: 'step'
          });
        }

        if (stmt.body && stmt.body.length > 0) {
          convertStatements(stmt.body, targetGraph, curX + X_STEP, curY - 60, { prevId: forNode.id, prevHandle: 'body' });
        }

        prevId = forNode.id;
        prevHandle = 'next';
        curX += X_STEP * 2;
        continue;
      }

      if (k === 'Return') {
        const retNode = {
          id: `ret_${uuid().slice(0, 8)}`,
          type: 'return',
          position: { x: curX, y: curY },
          data: { hasValue: Boolean(stmt.value) }
        };
        statementNode(targetGraph, retNode, stmt);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: retNode.id,
          targetHandle: 'in'
        });

        if (stmt.value) {
          const val = buildExpression(stmt.value, targetGraph, curX - 180, curY + 40);
          if (val) {
            targetGraph.edges.push({
              id: `e_${uuid().slice(0, 8)}`,
              source: val.node.id,
              sourceHandle: val.outputHandle,
              target: retNode.id,
              targetHandle: 'value'
            });
          }
        }

        // Return terminates branch
        prevId = null;
        break;
      }

      // Default fallback: CodeNode
      const cNode = {
        id: `code_${uuid().slice(0, 8)}`,
        type: 'codeNode',
        position: { x: curX, y: curY },
        data: {
          codeKind: stmt.codeKind || 'statement',
          code: stmt.code || stmt.segment || 'pass',
          language: 'python',
          sourceLocation: stmt.loc || null
        }
      };
      statementNode(targetGraph, cNode, stmt);
      if (prevId) {
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: cNode.id,
          targetHandle: 'in'
        });
      }
      prevId = cNode.id;
      prevHandle = 'next';
      curX += X_STEP;
    }
  }

  convertStatements(statements, doc, currentX, currentY);

  for (const graph of [doc, ...doc.nodes.map((n) => n.data?.graph).filter(Boolean)]) {
    for (const node of graph.nodes || []) {
      if (node.type === 'functionCall' && !node.data?.targetId && !node.data?.isMethod) {
        const targetId = resolveCallableId(node.data?.name || '');
        if (targetId) node.data.targetId = targetId;
      }
    }
  }

  const cleanMeta = (graph) => { delete graph._currentParams; delete graph._globalNames; delete graph._assignedNames; delete graph._usedNames; delete graph._pendingComment; for (const n of graph.nodes || []) if (n.data?.graph) cleanMeta(n.data.graph); };
  cleanMeta(doc);
  layoutGraph(doc);
  const unattachedComments = [...commentLines.keys()].filter((line) => commentLines.get(line)?.text && !consumedComments.has(line)).length;
  return { document: doc, error: null, unattachedComments };
}
