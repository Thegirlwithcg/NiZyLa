import fs from 'node:fs';
import path from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import { createGeometryDocument, createChildGraph } from './geometry.js';
import { inferExpressionType } from './expression-type.js';
import { layoutGraph } from './geometry-layout.js';

const uuid = () => globalThis.crypto.randomUUID();

let parserInstance = null;

export async function getGdscriptParser(wasmDir = null) {
  if (parserInstance) return parserInstance;

  // Resolve wasm files
  let dir = wasmDir;
  if (!dir) {
    // Try current dir resource/wasm or relative to import.meta.url
    const candidate1 = path.resolve('resource/wasm');
    const candidate2 = path.resolve(process.resourcesPath || '', 'resource/wasm');
    dir = fs.existsSync(path.join(candidate1, 'tree-sitter.wasm')) ? candidate1 : candidate2;
  }

  const treeSitterWasmPath = path.join(dir, 'tree-sitter.wasm');
  const gdscriptWasmPath = path.join(dir, 'tree-sitter-gdscript.wasm');

  await Parser.init({
    locateFile: () => treeSitterWasmPath
  });

  const gdWasmBinary = fs.readFileSync(gdscriptWasmPath);
  const GD = await Language.load(gdWasmBinary);
  const parser = new Parser();
  parser.setLanguage(GD);
  parserInstance = parser;
  return parserInstance;
}

export async function convertGdscriptToGcn(source, sourceFile = null, wasmDir = null, options = {}) {
  const foldLiteralInitializers = options.foldLiteralInitializers !== false;
  if (typeof source !== 'string') {
    return { document: null, error: 'Source must be a string.', unattachedComments: 0 };
  }

  let parser;
  try {
    parser = await getGdscriptParser(wasmDir);
  } catch (err) {
    return { document: null, error: `Failed to initialize GDScript tree-sitter parser: ${err.message}`, unattachedComments: 0 };
  }

  const tree = parser.parse(source);
  const root = tree.rootNode;

  // Check for syntax errors in tree
  function findError(node) {
    if (node.isError || node.type === 'ERROR') return node;
    for (let i = 0; i < node.namedChildCount; i++) {
      const err = findError(node.namedChild(i));
      if (err) return err;
    }
    return null;
  }

  const errNode = findError(root);
  if (errNode) {
    const start = errNode.startPosition;
    return {
      document: null,
      error: `SyntaxError in GDScript at line ${start.row + 1}, col ${start.column}: unexpected syntax near "${source.slice(errNode.startIndex, errNode.endIndex)}"`,
      unattachedComments: 0
    };
  }

  const doc = createGeometryDocument('gdscript', 2);
  if (sourceFile) doc.sourceFile = sourceFile;
  doc.nodes = [{ id: 'start', type: 'start', position: { x: 50, y: 150 }, data: {} }];
  doc.edges = [];
  doc.variables = [];

  const X_STEP = 280;

  function getBinaryOp(node) {
    if (node?.type !== 'binary_operator') return null;
    const opChild = node.children.find((c) => !c.isNamed);
    return opChild ? opChild.type : null;
  }

  function flattenGdscriptAdd(node) {
    if (node && node.type === 'binary_operator') {
      const op = getBinaryOp(node);
      if (op === '+') {
        const left = node.childForFieldName('left') || node.namedChild(0);
        const right = node.childForFieldName('right') || node.namedChild(1);
        return [...flattenGdscriptAdd(left), ...flattenGdscriptAdd(right)];
      }
    }
    return [node];
  }

  function allocateGdscriptPlaceholder(subExpr, placeholders, distinctPlaceholders, anonCounterRef) {
    const isIdent = subExpr?.type === 'identifier';
    const idName = isIdent ? source.slice(subExpr.startIndex, subExpr.endIndex).trim() : null;
    const baseName = idName || `v${anonCounterRef.value++}`;

    let chosenName = baseName;
    const existing = placeholders.get(baseName);
    if (existing) {
      if (isIdent && existing.isIdent && existing.idName === idName) {
        return { chosenName: baseName, isNew: false };
      }
      let suffix = 2;
      while (placeholders.has(`${baseName}_${suffix}`)) {
        suffix++;
      }
      chosenName = `${baseName}_${suffix}`;
      placeholders.set(chosenName, { isIdent, idName: isIdent ? idName : undefined, node: subExpr });
      distinctPlaceholders.push({ placeholderName: chosenName, node: subExpr });
      return { chosenName, isNew: true };
    }

    placeholders.set(chosenName, { isIdent, idName: isIdent ? idName : undefined, node: subExpr });
    distinctPlaceholders.push({ placeholderName: chosenName, node: subExpr });
    return { chosenName, isNew: true };
  }

  function buildExpression(node, graph, posX, posY) {
    if (!node) return null;
    const text = source.slice(node.startIndex, node.endIndex).trim();

    if (node.type === 'integer') {
      const litNode = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: 'int', value: parseInt(text, 10) || 0 }
      };
      graph.nodes.push(litNode);
      return { node: litNode, outputHandle: 'value' };
    }

    if (node.type === 'float') {
      const litNode = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: 'float', value: parseFloat(text) || 0 }
      };
      graph.nodes.push(litNode);
      return { node: litNode, outputHandle: 'value' };
    }

    if (node.type === 'string') {
      // Strip outer quotes
      const unquoted = text.replace(/^["']|["']$/g, '');
      const litNode = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: 'string', value: unquoted }
      };
      graph.nodes.push(litNode);
      return { node: litNode, outputHandle: 'value' };
    }

    if (node.type === 'true' || node.type === 'false') {
      const litNode = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: 'bool', value: node.type === 'true' }
      };
      graph.nodes.push(litNode);
      return { node: litNode, outputHandle: 'value' };
    }

    if (node.type === 'identifier') {
      const member = doc.variables.find((v) => v.name === text && v.declaration);
      if (member) {
        const symNode = { id: `sym_${uuid().slice(0, 8)}`, type: 'symbolRef', position: { x: posX, y: posY }, data: { symbol: text } };
        graph.nodes.push(symNode);
        return { node: symNode, outputHandle: 'value' };
      }
      const isVar = (graph.variables || []).some((v) => v.name === text);
      if (isVar) {
        const v = graph.variables.find((v) => v.name === text);
        const getVarNode = {
          id: `get_${uuid().slice(0, 8)}`,
          type: 'getVariable',
          position: { x: posX, y: posY },
          data: { variableId: v.id }
        };
        graph.nodes.push(getVarNode);
        return { node: getVarNode, outputHandle: 'value' };
      }
      if (graph._currentParams?.has(text)) {
        const pId = graph._currentParams.get(text);
        const paramNode = {
          id: `param_${uuid().slice(0, 8)}`,
          type: 'parameter',
          position: { x: posX, y: posY },
          data: { parameterId: pId, name: text, paramType: 'any' }
        };
        graph.nodes.push(paramNode);
        return { node: paramNode, outputHandle: 'value' };
      }
      const enclosingVar = graph !== doc ? (doc.variables || []).find((v) => v.name === text) : null;
      if (enclosingVar) {
        const getVarNode = {
          id: `get_${uuid().slice(0, 8)}`,
          type: 'getVariable',
          position: { x: posX, y: posY },
          data: { variableId: enclosingVar.id }
        };
        graph.nodes.push(getVarNode);
        return { node: getVarNode, outputHandle: 'value' };
      }
      const symNode = {
        id: `sym_${uuid().slice(0, 8)}`,
        type: 'symbolRef',
        position: { x: posX, y: posY },
        data: { symbol: text }
      };
      graph.nodes.push(symNode);
      return { node: symNode, outputHandle: 'value' };
    }

    if (node.type === 'binary_operator') {
      const op = getBinaryOp(node) || (source.slice(node.startIndex, node.endIndex).match(/([+\-*/%]|==|!=|<=|>=|<|>|and|or)/)?.[1] ?? '+');

      if (op === '+') {
        const leaves = flattenGdscriptAdd(node);
        const hasStrLit = leaves.some((l) => l?.type === 'string');
        if (hasStrLit) {
          let template = '';
          const placeholders = new Map();
          const distinctPlaceholders = [];
          const anonRef = { value: 0 };

          for (const leaf of leaves) {
            if (leaf?.type === 'string') {
              const raw = source.slice(leaf.startIndex, leaf.endIndex).trim();
              const unquoted = raw.replace(/^("""|'''|"|')|("""|'''|"|')$/g, '');
              template += unquoted.replace(/\{/g, '{{').replace(/\}/g, '}}');
            } else {
              let subExpr = leaf;
              if (leaf?.type === 'call') {
                const fnNode = leaf.namedChild(0);
                const fnName = fnNode ? source.slice(fnNode.startIndex, fnNode.endIndex).trim() : '';
                const argsNode = leaf.namedChild(1);
                if (fnName === 'str' && argsNode && argsNode.namedChildCount === 1) {
                  subExpr = argsNode.namedChild(0);
                }
              }
              const { chosenName } = allocateGdscriptPlaceholder(subExpr, placeholders, distinctPlaceholders, anonRef);
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

          distinctPlaceholders.forEach(({ placeholderName, node: subNode }, index) => {
            const subRes = buildExpression(subNode, graph, posX - 180, posY + (index * 40));
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

      if (['+', '-', '*', '/'].includes(op)) {
        const bNode = {
          id: `bin_${uuid().slice(0, 8)}`,
          type: 'binary',
          position: { x: posX, y: posY },
          data: { operator: op }
        };
        graph.nodes.push(bNode);
        const left = buildExpression(node.namedChild(0), graph, posX - 180, posY - 40);
        if (left) {
          graph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: left.node.id, sourceHandle: left.outputHandle, target: bNode.id, targetHandle: 'a' });
        }
        const right = buildExpression(node.namedChild(1), graph, posX - 180, posY + 40);
        if (right) {
          graph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: right.node.id, sourceHandle: right.outputHandle, target: bNode.id, targetHandle: 'b' });
        }
        return { node: bNode, outputHandle: 'value' };
      }

      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
        const cNode = {
          id: `cmp_${uuid().slice(0, 8)}`,
          type: 'compare',
          position: { x: posX, y: posY },
          data: { operator: op }
        };
        graph.nodes.push(cNode);
        const left = buildExpression(node.namedChild(0), graph, posX - 180, posY - 40);
        if (left) {
          graph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: left.node.id, sourceHandle: left.outputHandle, target: cNode.id, targetHandle: 'a' });
        }
        const right = buildExpression(node.namedChild(1), graph, posX - 180, posY + 40);
        if (right) {
          graph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: right.node.id, sourceHandle: right.outputHandle, target: cNode.id, targetHandle: 'b' });
        }
        return { node: cNode, outputHandle: 'value' };
      }
    }

    if (node.type === 'call') {
      const funcNode = node.namedChild(0);
      const funcName = funcNode ? source.slice(funcNode.startIndex, funcNode.endIndex).trim() : 'call';
      const argsNode = node.namedChild(1);
      const argsList = [];
      if (argsNode && argsNode.namedChildCount > 0) {
        for (let i = 0; i < argsNode.namedChildCount; i++) {
          argsList.push(argsNode.namedChild(i));
        }
      }
      // Named arguments and variadic/spread arguments cannot be represented safely by generic ports.
      if (argsList.some((arg) => /^(\.\.\.)|=/.test(source.slice(arg.startIndex, arg.endIndex).trim()))) {
        const codeNode = { id: `expr_${uuid().slice(0, 8)}`, type: 'codeNode', position: { x: posX, y: posY }, data: { codeKind: 'expression', code: text, language: 'gdscript' } };
        graph.nodes.push(codeNode);
        return { node: codeNode, outputHandle: 'value' };
      }
      const argNames = argsList.map((_, i) => `arg_${i}`);
      const callNode = {
        id: `call_${uuid().slice(0, 8)}`,
        type: 'functionCall',
        position: { x: posX, y: posY },
        data: { name: funcName, argumentNames: argNames, isMethod: funcName.includes('.') }
      };
      graph.nodes.push(callNode);

      argsList.forEach((arg, i) => {
        const argRes = buildExpression(arg, graph, posX - 180, posY + (i + 1) * 40);
        if (argRes) {
          graph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: argRes.node.id,
            sourceHandle: argRes.outputHandle,
            target: callNode.id,
            targetHandle: argNames[i]
          });
        }
      });
      return { node: callNode, outputHandle: 'value' };
    }

    // Fallback expression Code Node
    const codeNode = {
      id: `expr_${uuid().slice(0, 8)}`,
      type: 'codeNode',
      position: { x: posX, y: posY },
      data: {
        codeKind: 'expression',
        code: text,
        language: 'gdscript',
        sourceLocation: { startLine: node.startPosition.row + 1, startCol: node.startPosition.column, endLine: node.endPosition.row + 1, endCol: node.endPosition.column }
      }
    };
    graph.nodes.push(codeNode);
    return { node: codeNode, outputHandle: 'value' };
  }

  const INT_REGEX = /^-?\d+$/;
  const FLOAT_REGEX = /^-?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/;
  const BOOL_REGEX = /^(true|false)$/;
  const STRING_REGEX = /^"[^"\\]*"$/;

  function defaultInitialValue(type) {
    switch (type) {
      case 'int': return 0;
      case 'float': return 0.0;
      case 'string': return '';
      case 'bool': return false;
      case 'list': return [];
      case 'dict': return {};
      default: return 0;
    }
  }

  function mapDeclaredType(typeStr) {
    if (!typeStr) return null;
    switch (typeStr) {
      case 'int': return 'int';
      case 'float': return 'float';
      case 'String':
      case 'string': return 'string';
      case 'bool': return 'bool';
      case 'Array':
      case 'list': return 'list';
      case 'Dictionary':
      case 'dict': return 'dict';
      default: return 'int'; // today's fallback for other declared types
    }
  }

  function parseRootVarInitializer(mappedType, raw) {
    const nonLiteral = (type, declaration) => ({ type, initialValue: defaultInitialValue(type), isLiteral: false, declaration });
    if (!raw) {
      const type = mappedType || 'int';
      return nonLiteral(type, null);
    }

    if (!mappedType) {
      // Untyped: infer from literal
      if (INT_REGEX.test(raw)) {
        return { type: 'int', initialValue: parseInt(raw, 10), isLiteral: true };
      }
      if (FLOAT_REGEX.test(raw)) {
        return { type: 'float', initialValue: parseFloat(raw), isLiteral: true };
      }
      if (BOOL_REGEX.test(raw)) {
        return { type: 'bool', initialValue: raw === 'true', isLiteral: true };
      }
      if (STRING_REGEX.test(raw)) {
        return { type: 'string', initialValue: raw.slice(1, -1), isLiteral: true };
      }
      if (raw === '[]') {
        return { type: 'list', initialValue: [], isLiteral: true };
      }
      if (raw === '{}') {
        return { type: 'dict', initialValue: {}, isLiteral: true };
      }
      const inferred = inferExpressionType(raw);
      return nonLiteral(inferred || mappedType || 'int', raw);
    }

    // Declared type: literal kind must fit the variable type (int literal into float is OK)
    if (mappedType === 'int') {
      if (INT_REGEX.test(raw)) return { type: 'int', initialValue: parseInt(raw, 10), isLiteral: true };
      return nonLiteral('int', raw);
    }
    if (mappedType === 'float') {
      if (FLOAT_REGEX.test(raw) || INT_REGEX.test(raw)) {
        return { type: 'float', initialValue: parseFloat(raw), isLiteral: true };
      }
      return nonLiteral('float', raw);
    }
    if (mappedType === 'string') {
      if (STRING_REGEX.test(raw)) return { type: 'string', initialValue: raw.slice(1, -1), isLiteral: true };
      return nonLiteral('string', raw);
    }
    if (mappedType === 'bool') {
      if (BOOL_REGEX.test(raw)) return { type: 'bool', initialValue: raw === 'true', isLiteral: true };
      return nonLiteral('bool', raw);
    }
    if (mappedType === 'list') {
      if (raw === '[]') return { type: 'list', initialValue: [], isLiteral: true };
      return nonLiteral('list', raw);
    }
    if (mappedType === 'dict') {
      if (raw === '{}') return { type: 'dict', initialValue: {}, isLiteral: true };
      return nonLiteral('dict', raw);
    }

    const inferred = inferExpressionType(raw);
    return nonLiteral(inferred || mappedType || 'int', raw);
  }

  const topLevelChildren = [];
  for (let i = 0; i < root.namedChildCount; i++) {
    topLevelChildren.push(root.namedChild(i));
  }

  const hasRootReady = topLevelChildren.some((child) => {
    if (child?.type !== 'function_definition') return false;
    const nameNode = child.childForFieldName('name') || child.namedChild(0);
    const fnName = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : '';
    return fnName === '_ready';
  });

  const rootVarInits = [];
  for (const node of topLevelChildren) {
    if (node?.type === 'variable_statement') {
      const nameNode = node.childForFieldName('name') || node.namedChild(0);
      const varName = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : 'v';
      const typeNode = node.childForFieldName('type');
      const valNode = node.childForFieldName('value');
      const rawType = typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex).trim() : null;
      const mappedDeclared = mapDeclaredType(rawType);
      const rawVal = valNode ? source.slice(valNode.startIndex, valNode.endIndex).trim() : null;

      const { type: varType, initialValue, isLiteral, declaration } = parseRootVarInitializer(mappedDeclared, rawVal);
      const declarationLine = !isLiteral ? source.slice(node.startIndex, node.endIndex).trim() : null;

      let v = doc.variables.find((v) => v.name === varName);
      if (!v) {
        v = { id: `v_${uuid().slice(0, 8)}`, name: varName, type: varType, initialValue, ...(declarationLine ? { declaration: declarationLine } : {}) };
        doc.variables.push(v);
      }

      if (valNode && !isLiteral) {
        rootVarInits.push({ variable: v, valNode, node });
      }
    }
  }

  let readyInjected = false;
  const sourceLines = source.split(/\r?\n/);
  const commentLines = new Map();
  const consumedComments = new Set();
  const commentAt = (line) => {
    const text = sourceLines[line - 1] || '';
    let quote = null; let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\\\') { escaped = true; continue; }
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#') return { text: text.slice(i + 1).trim(), full: text.slice(0, i).trim() === '' };
    }
    return null;
  };
  sourceLines.forEach((_, i) => { const c = commentAt(i + 1); if (c) commentLines.set(i + 1, c); });
  const commentCache = new WeakMap();
  function commentForNode(node) {
    if (commentCache.has(node)) return commentCache.get(node);
    const start = node.startPosition.row + 1; const found = [];
    for (let line = start - 1; line >= 1; line--) {
      const c = commentLines.get(line);
      if (!c?.full || consumedComments.has(line)) break;
      found.unshift(c.text); consumedComments.add(line);
    }
    const inline = commentLines.get(start);
    if (inline && !inline.full && !consumedComments.has(start)) { found.push(inline.text); consumedComments.add(start); }
    const value = found.length ? found.join('\n').slice(0, 2000) : undefined;
    commentCache.set(node, value); return value;
  }
  function markCodeComments(node) {
    for (let line = node.startPosition.row + 1; line <= node.endPosition.row + 1; line++) if (commentLines.has(line)) consumedComments.add(line);
  }
  function statementNode(graph, node, sourceNode) {
    const comment = commentForNode(sourceNode);
    if (comment !== undefined && !(node.type === 'setVariable' && sourceNode.type === 'variable_statement')) node.data = { ...(node.data || {}), comment };
    if (node.type === 'codeNode') markCodeComments(sourceNode);
    graph.nodes.push(node); return node;
  }

  function convertCstStatements(nodesList, targetGraph, startX = 200, startY = 150, initialPrevId = 'start', initialPrevHandle = 'next') {
    const isRoot = targetGraph === doc;
    let prevId = initialPrevId;
    let prevHandle = initialPrevHandle;
    let curX = startX;
    let curY = startY;

    for (const node of nodesList) {
      if (!node) continue;
      const type = node.type;
      const text = source.slice(node.startIndex, node.endIndex).trim();

      // Tree-sitter exposes comments as named children; attachment consumes them by line.
      if (type === 'comment') continue;
      if (type === 'pass_statement') continue;

      if (type === 'extends_statement') {
        const baseTypeNode = node.namedChild(0);
        const baseName = baseTypeNode ? source.slice(baseTypeNode.startIndex, baseTypeNode.endIndex).trim() : 'Node';
        const extNode = {
          id: `ext_${uuid().slice(0, 8)}`,
          type: 'import',
          position: { x: curX, y: curY },
          data: { importType: 'gd_extends', module: baseName, names: [] }
        };
        statementNode(targetGraph, extNode, node);
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: extNode.id, targetHandle: 'in' });
        prevId = extNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (type === 'class_name_statement') {
        const nameNode = node.namedChild(0);
        const className = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : 'MyClass';
        const clsNameNode = {
          id: `clsname_${uuid().slice(0, 8)}`,
          type: 'import',
          position: { x: curX, y: curY },
          data: { importType: 'gd_class_name', module: className, names: [] }
        };
        statementNode(targetGraph, clsNameNode, node);
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: clsNameNode.id, targetHandle: 'in' });
        prevId = clsNameNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (type === 'variable_statement') {
        const variableComment = commentForNode(node);
        if (isRoot) {
          const declaredNode = node.childForFieldName('name') || node.namedChild(0);
          const declaredName = declaredNode ? source.slice(declaredNode.startIndex, declaredNode.endIndex).trim() : '';
          const declared = doc.variables.find((v) => v.name === declaredName);
          if (declared && variableComment !== undefined) declared.comment = variableComment;
          // Module variables are class members; never lower their initializers into Start.
          continue;
        }

        // Inside function bodies (function-body vars unchanged)
        const nameNode = node.childForFieldName('name') || node.namedChild(0);
        const varName = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : 'v';
        const typeNode = node.childForFieldName('type');
        const varType = typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex).trim() : 'int';
        const valNode = node.childForFieldName('value');

        let v = targetGraph.variables.find((v) => v.name === varName);
        if (!v) {
          const mappedType = ['int', 'float', 'string', 'bool'].includes(varType) ? varType : 'int';
          let initialValue = mappedType === 'string' ? '' : mappedType === 'bool' ? false : 0;
          v = { id: `v_${uuid().slice(0, 8)}`, name: varName, type: mappedType, initialValue };
          targetGraph.variables.push(v);
        }
        if (variableComment !== undefined) v.comment = variableComment;

        if (valNode) {
          const setNode = {
            id: `set_${uuid().slice(0, 8)}`,
            type: 'setVariable',
            position: { x: curX, y: curY },
            data: { variableId: v.id }
          };
          statementNode(targetGraph, setNode, node);
          targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: setNode.id, targetHandle: 'in' });
          const valRes = buildExpression(valNode, targetGraph, curX - 180, curY + 40);
          if (valRes) {
            targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: setNode.id, targetHandle: 'value' });
          }
          prevId = setNode.id;
          prevHandle = 'next';
          curX += X_STEP;
        }
        continue;
      }

      if (type === 'function_definition') {
        const nameNode = node.childForFieldName('name') || node.namedChild(0);
        const fnName = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex).trim() : 'func';
        const child = createChildGraph();
        child._currentParams = new Map();

        const paramsNode = node.childForFieldName('parameters');
        const params = [];
        if (paramsNode) {
          for (let i = 0; i < paramsNode.namedChildCount; i++) {
            const pNode = paramsNode.namedChild(i);
            const pNameNode = pNode.childForFieldName('name') || pNode;
            let pName = source.slice(pNameNode.startIndex, pNameNode.endIndex).trim();
            let pType = 'any';
            let pDefault = null;
            if (pName.includes('=')) {
              const eqParts = pName.split('=');
              pDefault = eqParts[1].trim();
              pName = eqParts[0].trim();
            }
            if (pName.includes(':')) {
              const colParts = pName.split(':');
              pName = colParts[0].trim();
              pType = colParts[1].trim() || 'any';
            }
            const pid = `p_${uuid().slice(0, 8)}`;
            child._currentParams.set(pName, pid);
            params.push({ id: pid, name: pName, type: pType, defaultValue: pDefault });
          }
        }

        const bodyNode = node.childForFieldName('body');
        const bodyChildren = [];
        if (bodyNode) {
          for (let i = 0; i < bodyNode.namedChildCount; i++) {
            bodyChildren.push(bodyNode.namedChild(i));
          }
        }

        let childPrevId = 'start';
        let childPrevHandle = 'next';
        let childCurX = 200;
        let childCurY = 150;

        if (false && isRoot && fnName === '_ready' && !readyInjected && rootVarInits.length > 0) {
          readyInjected = true;
          for (const init of rootVarInits) {
            const setNode = {
              id: `set_${uuid().slice(0, 8)}`,
              type: 'setVariable',
              position: { x: childCurX, y: childCurY },
              data: { variableId: init.variable.id }
            };
            child.nodes.push(setNode);
            child.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: childPrevId, sourceHandle: childPrevHandle, target: setNode.id, targetHandle: 'in' });
            const valRes = buildExpression(init.valNode, child, childCurX - 180, childCurY + 40);
            if (valRes) {
              child.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: setNode.id, targetHandle: 'value' });
            }
            childPrevId = setNode.id;
            childPrevHandle = 'next';
            childCurX += X_STEP;
          }
        }

        convertCstStatements(bodyChildren, child, childCurX, childCurY, childPrevId, childPrevHandle);
        delete child._currentParams;

        const fnNode = {
          id: `fn_${uuid().slice(0, 8)}`,
          type: 'functionDef',
          position: { x: curX, y: curY },
          data: {
            name: fnName,
            parameters: params,
            returnType: 'any',
            graph: child,
            ...(commentForNode(node) ? { comment: commentForNode(node) } : {})
          }
        };
        statementNode(targetGraph, fnNode, node);
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: fnNode.id, targetHandle: 'in' });
        prevId = fnNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (type === 'expression_statement') {
        const exprChild = node.namedChild(0);
        if (exprChild && exprChild.type === 'call') {
          const fnChild = exprChild.namedChild(0);
          const fnName = fnChild ? source.slice(fnChild.startIndex, fnChild.endIndex).trim() : '';
          const argsNode = exprChild.namedChild(1);
          const argsList = [];
          if (argsNode && argsNode.namedChildCount > 0) {
            for (let i = 0; i < argsNode.namedChildCount; i++) {
              argsList.push(argsNode.namedChild(i));
            }
          }

          if (fnName === 'print') {
            if (argsList.length < 2) {
              const pNode = { id: `print_${uuid().slice(0, 8)}`, type: 'print', position: { x: curX, y: curY }, data: { argCount: argsList.length } };
              statementNode(targetGraph, pNode, node);
              targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: pNode.id, targetHandle: 'in' });

              if (argsList.length === 1) {
                const valRes = buildExpression(argsList[0], targetGraph, curX - 180, curY + 40);
                if (valRes) {
                  targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: pNode.id, targetHandle: 'value' });
                }
              }
              prevId = pNode.id;
              prevHandle = 'next';
              curX += X_STEP;
              continue;
            } else {
              // 2+ args: codeNode statement (Godot print joins without spaces; the node emits prints)
              const cNode = {
                id: `code_${uuid().slice(0, 8)}`,
                type: 'codeNode',
                position: { x: curX, y: curY },
                data: {
                  codeKind: 'statement',
                  code: text,
                  language: 'gdscript',
                  sourceLocation: { startLine: node.startPosition.row + 1, startCol: node.startPosition.column, endLine: node.endPosition.row + 1, endCol: node.endPosition.column }
                }
              };
              statementNode(targetGraph, cNode, node);
              if (prevId) {
                targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: cNode.id, targetHandle: 'in' });
              }
              prevId = cNode.id;
              prevHandle = 'next';
              curX += X_STEP;
              continue;
            }
          }

          if (fnName === 'prints') {
            const count = argsList.length;
            const pNode = { id: `print_${uuid().slice(0, 8)}`, type: 'print', position: { x: curX, y: curY }, data: { argCount: count } };
            statementNode(targetGraph, pNode, node);
            targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: pNode.id, targetHandle: 'in' });

            for (let i = 0; i < count; i++) {
              const handle = i === 0 ? 'value' : `value_${i}`;
              const valRes = buildExpression(argsList[i], targetGraph, curX - 180, curY + (i * 40));
              if (valRes) {
                targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: pNode.id, targetHandle: handle });
              }
            }
            prevId = pNode.id;
            prevHandle = 'next';
            curX += X_STEP;
            continue;
          }

          // General call statement
          const callRes = buildExpression(exprChild, targetGraph, curX, curY);
          if (callRes) {
            const comment = commentForNode(node);
            if (comment !== undefined) callRes.node.data = { ...(callRes.node.data || {}), comment };
            targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: callRes.node.id, targetHandle: 'in' });
            prevId = callRes.node.id;
            prevHandle = 'next';
            curX += X_STEP;
            continue;
          }
        }
      }

      if (type === 'return_statement') {
        const valNode = node.namedChild(0);
        const retNode = { id: `ret_${uuid().slice(0, 8)}`, type: 'return', position: { x: curX, y: curY }, data: { hasValue: Boolean(valNode), ...(commentForNode(node) ? { comment: commentForNode(node) } : {}) } };
        statementNode(targetGraph, retNode, node);
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: retNode.id, targetHandle: 'in' });
        if (valNode) {
          const valRes = buildExpression(valNode, targetGraph, curX - 180, curY + 40);
          if (valRes) {
            targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: retNode.id, targetHandle: 'value' });
          }
        }
        prevId = null;
        break;
      }

      // Default fallback: CodeNode
      const cNode = {
        id: `code_${uuid().slice(0, 8)}`,
        type: 'codeNode',
        position: { x: curX, y: curY },
        data: {
          codeKind: 'statement',
          code: text,
          language: 'gdscript',
          sourceLocation: { startLine: node.startPosition.row + 1, startCol: node.startPosition.column, endLine: node.endPosition.row + 1, endCol: node.endPosition.column }
        }
      };
      statementNode(targetGraph, cNode, node);
      if (prevId) {
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: cNode.id, targetHandle: 'in' });
      }
      prevId = cNode.id;
      prevHandle = 'next';
      curX += X_STEP;
    }
  }

  convertCstStatements(topLevelChildren, doc, 200, 150);

  layoutGraph(doc);
  const unattachedComments = [...commentLines.keys()].filter((line) => !consumedComments.has(line)).length;
  return { document: doc, error: null, unattachedComments };
}
