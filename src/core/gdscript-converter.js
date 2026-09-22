import fs from 'node:fs';
import path from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import { createGeometryDocument, createChildGraph } from './geometry.js';

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

export async function convertGdscriptToGcn(source, sourceFile = null, wasmDir = null) {
  if (typeof source !== 'string') {
    return { document: null, error: 'Source must be a string.' };
  }

  let parser;
  try {
    parser = await getGdscriptParser(wasmDir);
  } catch (err) {
    return { document: null, error: `Failed to initialize GDScript tree-sitter parser: ${err.message}` };
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
      error: `SyntaxError in GDScript at line ${start.row + 1}, col ${start.column}: unexpected syntax near "${source.slice(errNode.startIndex, errNode.endIndex)}"`
    };
  }

  const doc = createGeometryDocument('gdscript', 2);
  if (sourceFile) doc.sourceFile = sourceFile;
  doc.nodes = [{ id: 'start', type: 'start', position: { x: 50, y: 150 }, data: {} }];
  doc.edges = [];
  doc.variables = [];

  const X_STEP = 280;

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
      const opNodeText = source.slice(node.startIndex, node.endIndex);
      const match = opNodeText.match(/([+\-*/%]|==|!=|<=|>=|<|>|and|or)/);
      const op = match ? match[1] : '+';

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
    if (!raw) {
      const type = mappedType || 'int';
      return { type, initialValue: defaultInitialValue(type), isLiteral: false };
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
      return { type: 'int', initialValue: 0, isLiteral: false };
    }

    // Declared type: literal kind must fit the variable type (int literal into float is OK)
    if (mappedType === 'int') {
      if (INT_REGEX.test(raw)) return { type: 'int', initialValue: parseInt(raw, 10), isLiteral: true };
      return { type: 'int', initialValue: 0, isLiteral: false };
    }
    if (mappedType === 'float') {
      if (FLOAT_REGEX.test(raw) || INT_REGEX.test(raw)) {
        return { type: 'float', initialValue: parseFloat(raw), isLiteral: true };
      }
      return { type: 'float', initialValue: 0.0, isLiteral: false };
    }
    if (mappedType === 'string') {
      if (STRING_REGEX.test(raw)) return { type: 'string', initialValue: raw.slice(1, -1), isLiteral: true };
      return { type: 'string', initialValue: '', isLiteral: false };
    }
    if (mappedType === 'bool') {
      if (BOOL_REGEX.test(raw)) return { type: 'bool', initialValue: raw === 'true', isLiteral: true };
      return { type: 'bool', initialValue: false, isLiteral: false };
    }
    if (mappedType === 'list') {
      if (raw === '[]') return { type: 'list', initialValue: [], isLiteral: true };
      return { type: 'list', initialValue: [], isLiteral: false };
    }
    if (mappedType === 'dict') {
      if (raw === '{}') return { type: 'dict', initialValue: {}, isLiteral: true };
      return { type: 'dict', initialValue: {}, isLiteral: false };
    }

    return { type: 'int', initialValue: 0, isLiteral: false };
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

      const { type: varType, initialValue, isLiteral } = parseRootVarInitializer(mappedDeclared, rawVal);

      let v = doc.variables.find((v) => v.name === varName);
      if (!v) {
        v = { id: `v_${uuid().slice(0, 8)}`, name: varName, type: varType, initialValue };
        doc.variables.push(v);
      }

      if (valNode && !isLiteral) {
        rootVarInits.push({ variable: v, valNode, node });
      }
    }
  }

  let readyInjected = false;

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
        targetGraph.nodes.push(extNode);
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
        targetGraph.nodes.push(clsNameNode);
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: clsNameNode.id, targetHandle: 'in' });
        prevId = clsNameNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (type === 'variable_statement') {
        if (isRoot) {
          if (!hasRootReady) {
            const init = rootVarInits.find((item) => item.node === node);
            if (init) {
              const setNode = {
                id: `set_${uuid().slice(0, 8)}`,
                type: 'setVariable',
                position: { x: curX, y: curY },
                data: { variableId: init.variable.id }
              };
              targetGraph.nodes.push(setNode);
              targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: setNode.id, targetHandle: 'in' });
              const valRes = buildExpression(init.valNode, targetGraph, curX - 180, curY + 40);
              if (valRes) {
                targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: setNode.id, targetHandle: 'value' });
              }
              prevId = setNode.id;
              prevHandle = 'next';
              curX += X_STEP;
            }
          }
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

        if (valNode) {
          const setNode = {
            id: `set_${uuid().slice(0, 8)}`,
            type: 'setVariable',
            position: { x: curX, y: curY },
            data: { variableId: v.id }
          };
          targetGraph.nodes.push(setNode);
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
            const pName = source.slice(pNameNode.startIndex, pNameNode.endIndex).trim();
            const pid = `p_${uuid().slice(0, 8)}`;
            child._currentParams.set(pName, pid);
            params.push({ id: pid, name: pName, type: 'any', defaultValue: null });
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

        if (isRoot && fnName === '_ready' && !readyInjected && rootVarInits.length > 0) {
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
            graph: child
          }
        };
        targetGraph.nodes.push(fnNode);
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
          if (fnName === 'print') {
            const argsNode = exprChild.namedChild(1);
            const pNode = { id: `print_${uuid().slice(0, 8)}`, type: 'print', position: { x: curX, y: curY }, data: {} };
            targetGraph.nodes.push(pNode);
            targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: pNode.id, targetHandle: 'in' });

            if (argsNode && argsNode.namedChildCount > 0) {
              const valRes = buildExpression(argsNode.namedChild(0), targetGraph, curX - 180, curY + 40);
              if (valRes) {
                targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: valRes.node.id, sourceHandle: valRes.outputHandle, target: pNode.id, targetHandle: 'value' });
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
        const retNode = { id: `ret_${uuid().slice(0, 8)}`, type: 'return', position: { x: curX, y: curY }, data: { hasValue: Boolean(valNode) } };
        targetGraph.nodes.push(retNode);
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
      targetGraph.nodes.push(cNode);
      if (prevId) {
        targetGraph.edges.push({ id: `e_${uuid().slice(0, 8)}`, source: prevId, sourceHandle: prevHandle, target: cNode.id, targetHandle: 'in' });
      }
      prevId = cNode.id;
      prevHandle = 'next';
      curX += X_STEP;
    }
  }

  convertCstStatements(topLevelChildren, doc, 200, 150);

  return { document: doc, error: null };
}
