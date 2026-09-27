import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeDefinitions, validateGeometryDocument, createGeometryDocument, serializeGeometryDocument, parseGeometryDocument } from '../src/core/geometry.js';
import { extractGcnExports, gcnModuleName, planGcnDrop, resolveGcnImportClosure } from '../src/core/gcn-imports.js';
const gcn = (path='a.gcn', alias='a') => ({id:`i-${alias}`,type:'import',position:{x:0,y:0},data:{importType:'gcn',path,alias}});
const diagCodes = doc => validateGeometryDocument(doc).filter(d=>d.code.startsWith('gcn-'));
const docWith = (...nodes) => { const d=createGeometryDocument('python'); d.nodes.push(...nodes); return d; };
const ref = (id, extra={}) => ({id,type:'functionCall',position:{x:1,y:1},data:{targetId:'',importNodeId:id,name:'f',argumentNames:[],...extra}});
const func = (id='f', graph=null, more={}) => ({id,type:'functionDef',position:{x:1,y:1},data:{name:'f',parameters:[],returnType:'any',isStatic:false,graph,...more}});

test('module names strip every Geometry Code extension', () => {
  for (const extension of ['.gcpy', '.gcgd', '.gcn']) assert.deepEqual(gcnModuleName('', `lib/shape${extension}`), { module: 'lib.shape' });
});

test('gcpy to python drop is accepted and gcgd to python is refused by extension', () => {
  const args = { importerPath: '/project/main.gcpy', projectRoot: '/project', target: 'python', droppedPaths: ['/project/lib/a.gcpy', '/project/lib/b.gcgd'], docTargets: new Map([['/project/lib/a.gcpy', 'python']]) };
  const result = planGcnDrop(args);
  assert.deepEqual(result.adds.map((item) => item.path), ['lib/a.gcpy']);
  assert.ok(result.toasts.some((toast) => toast.includes('b.gcgd')));
});

test('gcn import and cross-file references have schema defaults', () => {
  assert.equal(nodeDefinitions.import.defaults.importType, 'module');
  assert.equal(nodeDefinitions.functionDef.defaults.isStatic, false);
  assert.equal(nodeDefinitions.functionCall.defaults.importNodeId, '');
});

test('single backslash import path is rejected', () => { const d=docWith(gcn('lib\\\\a.gcn')); assert.ok(diagCodes(d).some(x=>x.code==='gcn-import-invalid-path')); });
test('absolute POSIX import path is rejected', () => { assert.ok(diagCodes(docWith(gcn('/abs.gcn'))).some(x=>x.code==='gcn-import-invalid-path')); });
test('drive-letter import path is rejected', () => { assert.ok(diagCodes(docWith(gcn('D:/x.gcn'))).some(x=>x.code==='gcn-import-invalid-path')); });
test('non-GCN extension import path is rejected', () => { assert.ok(diagCodes(docWith(gcn('a.txt'))).some(x=>x.code==='gcn-import-invalid-path')); });
test('empty import path is rejected', () => { assert.ok(diagCodes(docWith(gcn(''))).some(x=>x.code==='gcn-import-invalid-path')); });
test('parent-relative GCN import path is accepted', () => { assert.equal(diagCodes(docWith(gcn('../util.gcn'))).length,0); });
test('nested GCN import is rejected', () => { const d=docWith(func('f',{nodes:[{id:'s',type:'start',position:{x:0,y:0},data:{}},gcn() ],edges:[],variables:[],viewport:{x:0,y:0,zoom:1}})); assert.ok(diagCodes(d).some(x=>x.code==='gcn-import-not-root')); });
test('duplicate GCN import aliases are rejected', () => { assert.ok(diagCodes(docWith(gcn('a.gcn','x'),gcn('b.gcn','x'))).some(x=>x.code==='gcn-import-invalid-alias')); });
test('GCN import alias colliding with a variable is rejected', () => { const d=docWith(gcn('a.gcn','x')); d.variables.push({id:'v',name:'x',type:'int',initialValue:0}); assert.ok(diagCodes(d).some(x=>x.code==='gcn-import-invalid-alias')); });
test('GCN import alias colliding with a root function is rejected', () => { assert.ok(diagCodes(docWith(gcn('a.gcn','f'),func())).some(x=>x.code==='gcn-import-invalid-alias')); });
test('reserved GCN import alias is rejected', () => { assert.ok(diagCodes(docWith(gcn('a.gcn','print'))).some(x=>x.code==='gcn-import-invalid-alias')); });
test('root call with unknown GCN import id is rejected', () => { assert.ok(diagCodes(docWith(ref('missing'))).some(x=>x.code==='gcn-import-missing-node')); });
test('nested call with known root GCN import id is accepted', () => { const imp=gcn(); const child={nodes:[{id:'s',type:'start',position:{x:0,y:0},data:{}},ref(imp.id)],edges:[],variables:[],viewport:{x:0,y:0,zoom:1}}; assert.equal(diagCodes(docWith(imp,func('f',child))).length,0); });
test('nested call with unknown GCN import id is rejected', () => { const child={nodes:[{id:'s',type:'start',position:{x:0,y:0},data:{}},ref('missing')],edges:[],variables:[],viewport:{x:0,y:0,zoom:1}}; assert.ok(diagCodes(docWith(func('f',child))).some(x=>x.code==='gcn-import-missing-node')); });
test('call with both target and import ids is rejected with exclusivity message', () => { const d=docWith(gcn(),ref('i-a',{targetId:'local'})); const x=diagCodes(d).find(x=>x.code==='gcn-import-missing-node'); assert.match(x.message,/Use either targetId or importNodeId, not both\./); });
test('GCN metadata round-trips through serialization', () => { const d=docWith(gcn('lib/a.gcn','shapes'),func('fn',null,{isStatic:true}),ref('i-shapes')); const parsed=parseGeometryDocument(serializeGeometryDocument(d)).document; assert.equal(parsed.nodes.find(n=>n.id==='fn').data.isStatic,true); assert.equal(parsed.nodes.find(n=>n.type==='functionCall').data.importNodeId,'i-shapes'); assert.equal(parsed.nodes.find(n=>n.type==='import').data.path,'lib/a.gcn'); assert.equal(parsed.nodes.find(n=>n.type==='import').data.alias,'shapes'); });
test('legacy nodes without GCN fields produce no GCN diagnostics', () => { const d=docWith({id:'oldimp',type:'import',position:{x:0,y:0},data:{importType:'module'}},{id:'oldcall',type:'functionCall',position:{x:0,y:0},data:{targetId:'',name:'f',argumentNames:[]}}); assert.equal(diagCodes(d).length,0); });

const importDoc = (...paths) => ({format:'nizyla-gcn',version:2,target:'python',nodes:paths.map((p,i)=>gcn(p,`a${i}`)),edges:[],variables:[],viewport:{x:0,y:0,zoom:1}});
const closure = async (root, entry, mapping) => resolveGcnImportClosure({entryPath:entry,entryDoc:mapping[entry],projectRoot:root,readDoc:async p=>Object.entries(mapping).find(([key])=>key.replace(/\\/g,'/')===p.replace(/\\/g,'/'))?.[1] ?? null});
const BS = String.fromCharCode(92);
const win = (...parts) => parts.join(BS);
const winRoot=win('D:', 'p');
test('Windows path helper produces single-backslash paths', () => { assert.equal(win('D:', 'p').length, 4); });
test('clean diamond closure on Windows uses DFS order and has no diagnostics', async () => { const a=win('D:','p','a.gcn'),b=win('D:','p','b.gcn'),c=win('D:','p','c.gcn'),d=win('D:','p','d.gcn'); const r=await closure(winRoot,a,{[a]:importDoc('b.gcn','c.gcn'),[b]:importDoc('d.gcn'),[c]:importDoc('d.gcn'),[d]:importDoc()}); assert.deepEqual(r.files.map(x=>x.relPath),['b.gcn','d.gcn','c.gcn']); assert.deepEqual(r.diagnostics,[]); });
test('clean diamond closure on POSIX has the same DFS order and no diagnostics', async () => { const root='/home/u/p',a=root+'/a.gcn',b=root+'/b.gcn',c=root+'/c.gcn',d=root+'/d.gcn'; const r=await closure(root,a,{[a]:importDoc('b.gcn','c.gcn'),[b]:importDoc('d.gcn'),[c]:importDoc('d.gcn'),[d]:importDoc()}); assert.deepEqual(r.files.map(x=>x.relPath),['b.gcn','d.gcn','c.gcn']); assert.deepEqual(r.diagnostics,[]); });
test('case-insensitive Windows entry is inside the project root', async () => { const entry=win('d:','p','a.gcn'); const r=await closure(win('D:','P'),entry,{[entry]:importDoc()}); assert.deepEqual(r.diagnostics,[]); });
test('extractGcnExports returns function params and static metadata plus both constructor forms', () => { const d=importDoc(); d.nodes=[func('f',null,{name:'area',parameters:[{name:'r'}],isStatic:true}),{id:'c1',type:'classDef',position:{x:0,y:0},data:{name:'Circle',graph:{nodes:[func('i1',null,{name:'__init__',parameters:[{name:'self'},{name:'r'}]}),func('i2',null,{name:'_init',parameters:[{name:'r'}]})]}}}]; const e=extractGcnExports(d); assert.deepEqual(e.functions,[{name:'area',params:['r'],isStatic:true}]); assert.deepEqual(e.classes,[{name:'Circle',initParams:['r']}]); });
test('closure resolves transitive Windows imports and normalizes parent paths', async () => { const a=win('D:','p','a.gcn'), b=win('D:','p','b.gcn'), c=win('D:','p','lib','c.gcn'), d=win('D:','p','d.gcn'); const m={[a]:importDoc('b.gcn','lib/c.gcn'),[b]:importDoc(),[c]:importDoc('../d.gcn'),[d]:importDoc()}; const r=await closure(winRoot,a,m); assert.deepEqual(r.files.map(x=>x.relPath),['b.gcn','lib/c.gcn','d.gcn']); });
test('closure reports direct cycle with complete chain', async () => { const a=win('D:','p','a.gcn'),b=win('D:','p','b.gcn'),m={[a]:importDoc('b.gcn'),[b]:importDoc('a.gcn')}; const r=await closure(winRoot,a,m); const x=r.diagnostics.find(x=>x.code==='gcn-import-cycle'); assert.ok(x); assert.match(x.message,/a.gcn → b.gcn → a.gcn/); });
test('closure reports cycle through an already discovered diamond file', async () => { const a=win('D:','p','a.gcn'),b=win('D:','p','b.gcn'),c=win('D:','p','c.gcn'); const m={[a]:importDoc('b.gcn','b','c.gcn'),[b]:importDoc('c.gcn'),[c]:importDoc('b.gcn')}; const r=await closure(winRoot,a,m); const x=r.diagnostics.find(x=>x.code==='gcn-import-cycle'); assert.ok(x); assert.match(x.message,/b.gcn → c.gcn → b.gcn/); });
test('closure reports missing dependency', async () => { const a='D:\\\\p\\\\a.gcn',r=await closure(winRoot,a,{[a]:importDoc('missing.gcn')}); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-not-found')); });
test('closure converts readDoc exceptions into not-found diagnostics', async () => { const a=win('D:','p','a.gcn'); const r=await resolveGcnImportClosure({entryPath:a,entryDoc:importDoc('bad.gcn'),projectRoot:winRoot,readDoc:async()=>{throw Error('disk');}}); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-not-found')); });
test('closure reports target mismatch', async () => { const a=win('D:','p','a.gcn'),b=win('D:','p','b.gcn'),d=importDoc(); d.target='gdscript'; const r=await closure(winRoot,a,{[a]:importDoc('b.gcn'),[b]:d}); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-target-mismatch')); });
test('closure rejects dependencies escaping project root', async () => { const a=win('D:','p','a.gcn'); const r=await closure(winRoot,a,{[a]:importDoc('../../x.gcn')}); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-outside-project')); });
test('closure reports direct self imports', async () => { const a=win('D:','p','a.gcn'); const r=await closure(winRoot,a,{[a]:importDoc('./a.gcn')}); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-self')); });
test('closure rejects entry outside project root', async () => { const a=win('D:','outside','a.gcn'); const r=await closure(winRoot,a,{[a]:importDoc()}); assert.equal(r.files.length,0); assert.ok(r.diagnostics.some(x=>x.code==='gcn-import-outside-project')); });
test('closure preserves absolute POSIX project roots', async () => { const root='/home/u/p',a=root+'/a.gcn',b=root+'/b.gcn'; const r=await closure(root,a,{[a]:importDoc('b.gcn'),[b]:importDoc()}); assert.equal(r.files[0]?.absPath,b); });
test('closure includes a repeated dependency only once', async () => { const a=win('D:','p','a.gcn'),b=win('D:','p','b.gcn'),c=win('D:','p','c.gcn'),d=win('D:','p','d.gcn'); const r=await closure(winRoot,a,{[a]:importDoc('b.gcn','c.gcn'),[b]:importDoc('d.gcn'),[c]:importDoc('d.gcn'),[d]:importDoc()}); assert.equal(r.files.filter(x=>x.relPath==='d.gcn').length,1); assert.deepEqual(r.diagnostics,[]); });

test('gcn import validation rejects invalid alias', () => {
  const doc = createGeometryDocument('python');
  doc.nodes.push({ id: 'imp', type: 'import', position: {x:0,y:0}, data: { importType:'gcn', path:'lib/a.gcn', alias:'bad-name' } });
  assert.ok(validateGeometryDocument(doc).some(d => d.code === 'gcn-import-invalid-alias'));
});
