import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryDocument } from '../src/core/geometry.js';
import { generateFragmentCode } from '../src/core/geometry-codegen.js';

const n = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (source, sourceHandle, target, targetHandle) => ({ id: `${source}-${target}-${sourceHandle}`, source, sourceHandle, target, targetHandle });
const doc = (target, nodes, edges = [], variables = []) => ({ ...createGeometryDocument(target), nodes: [n('start', 'start'), ...nodes], edges, variables });

for (const target of ['python', 'gdscript']) {
  test(`${target} fragment emits a selected statement chain without module wrapper`, () => {
    const d = doc(target, [n('s1', 'setVariable', { variableId: 'x' }), n('p', 'print', { argCount: 1 }), n('s2', 'setVariable', { variableId: 'x' }), n('v1', 'literal', { valueType: 'int', value: 1 }), n('v2', 'literal', { valueType: 'int', value: 2 }), n('v3', 'literal', { valueType: 'int', value: 3 })], [e('s1', 'next', 'p', 'in'), e('p', 'next', 's2', 'in'), e('v1', 'value', 's1', 'value'), e('v2', 'value', 'p', 'value'), e('v3', 'value', 's2', 'value')], [{ id: 'x', name: 'x', type: 'int', initialValue: 0 }]);
    const r = generateFragmentCode(d, { nodeIds: ['s1', 'p', 's2', 'v1', 'v2', 'v3'], entryId: 's1' }, target);
    assert.deepEqual(r, { ok: true, code: ['x = 1', 'print(2)', 'x = 3'].join('\n') });
    assert.doesNotMatch(r.code, /^(import|def main|extends|.*_gcn_input)/m);
  });

  test(`${target} fragment emits nested if/else bodies`, () => {
    const d = doc(target, [n('if', 'if'), n('cond', 'literal', { valueType: 'bool', value: true }), n('a', 'print'), n('b', 'print'), n('one', 'literal', { valueType: 'int', value: 1 }), n('two', 'literal', { valueType: 'int', value: 2 })], [e('if', 'then', 'a', 'in'), e('if', 'else', 'b', 'in'), e('cond', 'value', 'if', 'condition'), e('one', 'value', 'a', 'value'), e('two', 'value', 'b', 'value')]);
    const r = generateFragmentCode(d, { nodeIds: ['if', 'a', 'b', 'cond', 'one', 'two'], entryId: 'if' }, target);
    assert.equal(r.ok, true);
    assert.match(r.code, target === 'python' ? /if True:/ : /if true:/);
    assert.match(r.code, /    print\(1\)/);
    assert.match(r.code, /else:/);
    assert.doesNotMatch(r.code, /^(import|def main|extends|.*_gcn_input)/m);
  });

  test(`${target} fragment resolves definitions and scoped variables from the real document`, () => {
    const fn = n('fn', 'functionDef', { name: 'helper', parameters: [], graph: { nodes: [n('fs', 'start')], edges: [], variables: [{ id: 'local', name: 'local_value', type: 'int', initialValue: 0 }] } });
    const call = n('call', 'functionCall', { targetId: 'fn', name: 'helper', argumentNames: [] });
    let d = doc(target, [fn, call], [e('call', 'next', 'out', 'in')], [{ id: 'rootv', name: 'root_value', type: 'int', initialValue: 0 }]);
    d.nodes.push(n('out', 'print'));
    d.edges.push(e('rootvnode', 'value', 'out', 'value'));
    d.nodes.push(n('rootvnode', 'getVariable', { variableId: 'rootv' }));
    const callCode = generateFragmentCode(d, { nodeIds: ['call'], entryId: 'call' }, target);
    assert.equal(callCode.code, 'helper()');

    const innerNodes = [n('get', 'getVariable', { variableId: 'local' }), n('print', 'print')];
    fn.data.graph.nodes.push(...innerNodes);
    fn.data.graph.edges.push(e('fs', 'next', 'print', 'in'), e('get', 'value', 'print', 'value'));
    d = { ...d, nodes: [n('start', 'start'), fn], variables: [{ id: 'rootv', name: 'root_value', type: 'int', initialValue: 0 }] };
    const localCode = generateFragmentCode(d, { scopePath: ['fn'], nodeIds: ['print', 'get'], entryId: 'print' }, target);
    assert.equal(localCode.code, 'print(local_value)');
    const rootValue = n('rootget', 'getVariable', { variableId: 'rootv' });
    fn.data.graph.nodes.push(rootValue);
    const rootExpr = generateFragmentCode(d, { scopePath: ['fn'], nodeIds: ['rootget'], valueId: 'rootget' }, target);
    assert.equal(rootExpr.code, 'root_value');
  });

  test(`${target} fragment value mode emits composed expression`, () => {
    const nodes = [n('a', 'literal', { valueType: 'int', value: 3 }), n('b', 'literal', { valueType: 'int', value: 1 }), n('add', 'binary', { operator: '+' }), n('two', 'literal', { valueType: 'int', value: 2 }), n('mul', 'binary', { operator: '*' })];
    const d = doc(target, nodes, [e('a', 'value', 'add', 'a'), e('b', 'value', 'add', 'b'), e('add', 'value', 'mul', 'a'), e('two', 'value', 'mul', 'b')]);
    const r = generateFragmentCode(d, { nodeIds: nodes.map((x) => x.id), valueId: 'mul' }, target);
    assert.deepEqual(r, { ok: true, code: '((3 + 1) * 2)' });
  });
}
