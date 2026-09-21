import { createGeometryDocument, createChildGraph } from './geometry.js';

const uuid = () => globalThis.crypto.randomUUID();

export function convertPythonAstToGcn(astResult, originalSource = '', sourceFile = null) {
  if (!astResult || astResult.error) {
    return {
      document: null,
      error: astResult?.message || 'Syntax error or failed to parse Python code.'
    };
  }

  const doc = createGeometryDocument('python', 2);
  if (sourceFile) doc.sourceFile = sourceFile;
  doc.nodes = [{ id: 'start', type: 'start', position: { x: 50, y: 150 }, data: {} }];
  doc.edges = [];
  doc.variables = [];

  const statements = astResult.statements || [];
  let prevExecNodeId = 'start';
  let prevExecHandle = 'next';
  let currentX = 250;
  let currentY = 150;
  const Y_STEP = 120;
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

  function resolveCallableId(name) {
    return symbolDefinitions.get(name) || '';
  }

  function buildExpression(expr, graph, posX, posY) {
    if (!expr) return null;
    const t = expr.type;

    if (t === 'Constant') {
      const node = {
        id: `lit_${uuid().slice(0, 8)}`,
        type: 'literal',
        position: { x: posX, y: posY },
        data: { valueType: expr.value_type === 'other' ? 'string' : expr.value_type, value: expr.value }
      };
      graph.nodes.push(node);
      return { node, outputHandle: 'value' };
    }

    if (t === 'Name') {
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
      const funcName = expr.func?.id || expr.func?.attr || expr.segment || 'call';
      const isMethod = expr.func?.type === 'Attribute';
      const argNames = (expr.args || []).map((_, i) => `arg_${i}`);
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

      (expr.args || []).forEach((arg, i) => {
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

    // Fallback Code Node for expression
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

    for (const stmt of stmts) {
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
        targetGraph.nodes.push(impNode);
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

        convertStatements(stmt.body || [], child, 200, 150);
        delete child._currentParams;

        const fnNode = {
          id: `fn_${uuid().slice(0, 8)}`,
          type: 'functionDef',
          position: { x: curX, y: curY },
          data: {
            name: stmt.name,
            parameters: params,
            returnType: stmt.return_type || 'any',
            isAsync: Boolean(stmt.is_async),
            decorators: stmt.decorators || [],
            graph: child
          }
        };
        targetGraph.nodes.push(fnNode);
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
          data: {
            name: stmt.name,
            baseClass: stmt.base || '',
            decorators: stmt.decorators || [],
            graph: child
          }
        };
        targetGraph.nodes.push(clsNode);
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

      if (k === 'AssignVar') {
        let v = ensureVariable(targetGraph, stmt.name, stmt.value);
        const setNode = {
          id: `set_${uuid().slice(0, 8)}`,
          type: 'setVariable',
          position: { x: curX, y: curY },
          data: { variableId: v.id }
        };
        targetGraph.nodes.push(setNode);
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
        targetGraph.nodes.push(setMemNode);
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
        const pNode = {
          id: `print_${uuid().slice(0, 8)}`,
          type: 'print',
          position: { x: curX, y: curY },
          data: {}
        };
        targetGraph.nodes.push(pNode);
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: prevId,
          sourceHandle: prevHandle,
          target: pNode.id,
          targetHandle: 'in'
        });

        const val = buildExpression(stmt.value, targetGraph, curX - 180, curY + 60);
        if (val) {
          targetGraph.edges.push({
            id: `e_${uuid().slice(0, 8)}`,
            source: val.node.id,
            sourceHandle: val.outputHandle,
            target: pNode.id,
            targetHandle: 'value'
          });
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
        const argNames = (c?.args || []).map((_, i) => `arg_${i}`);
        const callNode = {
          id: `call_${uuid().slice(0, 8)}`,
          type: 'functionCall',
          position: { x: curX, y: curY },
          data: { targetId: isMethod ? '' : resolveCallableId(funcName), name: funcName, argumentNames: argNames, isMethod }
        };
        targetGraph.nodes.push(callNode);
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

        (c?.args || []).forEach((arg, i) => {
          const argRes = buildExpression(arg, targetGraph, curX - 180, curY + (i + 1) * 40);
          if (argRes) {
            targetGraph.edges.push({
              id: `e_${uuid().slice(0, 8)}`,
              source: argRes.node.id,
              sourceHandle: argRes.outputHandle,
              target: callNode.id,
              targetHandle: argNames[i]
            });
          }
        });

        prevId = callNode.id;
        prevHandle = 'next';
        curX += X_STEP;
        continue;
      }

      if (k === 'If') {
        const ifNode = {
          id: `if_${uuid().slice(0, 8)}`,
          type: 'if',
          position: { x: curX, y: curY },
          data: {}
        };
        targetGraph.nodes.push(ifNode);
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
        targetGraph.nodes.push(wNode);
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
        targetGraph.nodes.push(forNode);
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
        targetGraph.nodes.push(retNode);
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
      targetGraph.nodes.push(cNode);
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

  function convertSingleStatement(stmt, targetGraph, prevId, prevHandle, posX, posY) {
    if (!stmt || stmt.kind === 'Pass') return null;
    const k = stmt.kind;

    if (k === 'AssignVar') {
      let v = targetGraph.variables.find((v) => v.name === stmt.name);
      if (!v) {
        v = { id: `v_${uuid().slice(0, 8)}`, name: stmt.name, type: 'int', initialValue: 0 };
        targetGraph.variables.push(v);
      }
      const setNode = {
        id: `set_${uuid().slice(0, 8)}`,
        type: 'setVariable',
        position: { x: posX, y: posY },
        data: { variableId: v.id }
      };
      targetGraph.nodes.push(setNode);
      targetGraph.edges.push({
        id: `e_${uuid().slice(0, 8)}`,
        source: prevId,
        sourceHandle: prevHandle,
        target: setNode.id,
        targetHandle: 'in'
      });
      const val = buildExpression(stmt.value, targetGraph, posX - 180, posY + 40);
      if (val) {
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: val.node.id,
          sourceHandle: val.outputHandle,
          target: setNode.id,
          targetHandle: 'value'
        });
      }
      return { id: setNode.id, handle: 'next' };
    }

    if (k === 'Print') {
      const pNode = {
        id: `print_${uuid().slice(0, 8)}`,
        type: 'print',
        position: { x: posX, y: posY },
        data: {}
      };
      targetGraph.nodes.push(pNode);
      targetGraph.edges.push({
        id: `e_${uuid().slice(0, 8)}`,
        source: prevId,
        sourceHandle: prevHandle,
        target: pNode.id,
        targetHandle: 'in'
      });
      const val = buildExpression(stmt.value, targetGraph, posX - 180, posY + 40);
      if (val) {
        targetGraph.edges.push({
          id: `e_${uuid().slice(0, 8)}`,
          source: val.node.id,
          sourceHandle: val.outputHandle,
          target: pNode.id,
          targetHandle: 'value'
        });
      }
      return { id: pNode.id, handle: 'next' };
    }

    if (k === 'Return') {
      const retNode = {
        id: `ret_${uuid().slice(0, 8)}`,
        type: 'return',
        position: { x: posX, y: posY },
        data: { hasValue: Boolean(stmt.value) }
      };
      targetGraph.nodes.push(retNode);
      targetGraph.edges.push({
        id: `e_${uuid().slice(0, 8)}`,
        source: prevId,
        sourceHandle: prevHandle,
        target: retNode.id,
        targetHandle: 'in'
      });
      if (stmt.value) {
        const val = buildExpression(stmt.value, targetGraph, posX - 180, posY + 40);
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
      return null;
    }

    // Fallback code node
    const cNode = {
      id: `code_${uuid().slice(0, 8)}`,
      type: 'codeNode',
      position: { x: posX, y: posY },
      data: {
        codeKind: stmt.codeKind || 'statement',
        code: stmt.code || stmt.segment || 'pass',
        language: 'python',
        sourceLocation: stmt.loc || null
      }
    };
    targetGraph.nodes.push(cNode);
    targetGraph.edges.push({
      id: `e_${uuid().slice(0, 8)}`,
      source: prevId,
      sourceHandle: prevHandle,
      target: cNode.id,
      targetHandle: 'in'
    });
    return { id: cNode.id, handle: 'next' };
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

  return { document: doc, error: null };
}
