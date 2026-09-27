const posix = (value) => {
  const input = String(value || '').replace(/\\/g, '/');
  const absolute = input.startsWith('/');
  const drive = input.match(/^([A-Za-z]:)(\/.*)?$/);
  const prefix = drive ? drive[1] : '';
  const body = drive ? (drive[2] || '/') : input;
  const out = [];
  for (const part of body.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!absolute && !drive) out.push(part); }
    else out.push(part);
  }
  return `${prefix}${absolute || drive ? '/' : ''}${out.join('/')}` || (absolute ? '/' : '.');
};
const isDrivePath = value => /^[A-Za-z]:\//.test(value);
const keyPath = value => { const normalized = posix(value); return isDrivePath(normalized) ? normalized.toLowerCase() : normalized; };
const pathEqual = (a,b) => keyPath(a) === keyPath(b);
const inside = (path,root) => pathEqual(path,root) || (isDrivePath(path)||isDrivePath(root) ? path.toLowerCase().startsWith(root.toLowerCase().replace(/\/$/,'')+'/') : path.startsWith(root.replace(/\/$/,'')+'/'));
const pythonKeywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
export function gcnModuleName(importerRelDir = '', path = '') {
  const normalized = posix(`${importerRelDir}/${path}`);
  const relative = normalized.replace(/^\.\//, '');
  if (relative === '..' || relative.startsWith('../')) return { error: `Import path escapes the project root: ${path}.` };
  const withoutExtension = relative.endsWith('.gcn') ? relative.slice(0, -4) : relative;
  const segments = withoutExtension.split('/').filter(Boolean);
  for (const segment of segments) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment) || pythonKeywords.has(segment)) {
      return { error: `Rename '${segment}' to a valid Python name.` };
    }
  }
  return { module: segments.join('.') };
}
export function gcnImportDiagnostics(doc, target, options = {}) {
  if (target !== 'python') return [];
  const importerRelDir = options.importerRelDir || '';
  return (doc?.nodes || []).filter(node => node.type === 'import' && node.data?.importType === 'gcn').flatMap(node => {
    const result = gcnModuleName(importerRelDir, node.data?.path || '');
    return result.error ? [{ severity: 'error', code: 'gcn-import-invalid-module', message: result.error, nodeId: node.id }] : [];
  });
}
export function extractGcnExports(doc) {
  const functions = [], classes = [];
  for (const n of doc?.nodes || []) {
    if (n.type === 'functionDef') functions.push({ name:n.data?.name, params:(n.data?.parameters || []).map(p=>p.name), isStatic:n.data?.isStatic === true });
    if (n.type === 'classDef') {
      const ctor = (n.data?.graph?.nodes || []).find(x => x.type === 'functionDef' && ['__init__','_init'].includes(x.data?.name));
      classes.push({ name:n.data?.name, initParams:(ctor?.data?.parameters || []).map(p=>p.name).filter(x=>x !== 'self') });
    }
  }
  return { target:doc?.target, functions, classes };
}
export async function resolveGcnImportClosure({entryPath, entryDoc, projectRoot, readDoc}) {
  const files=[], diagnostics=[];
  const root=posix(projectRoot), entry=posix(entryPath), rootKey=keyPath(root), entryKey=keyPath(entry);
  const diagnostic=(code,message,file,nodeId)=>diagnostics.push({code,message,file,nodeId});
  if(!inside(entryKey,rootKey)) { diagnostic('gcn-import-outside-project',`Entry file is outside project root: ${entryPath}.`,entryPath,null); return {files,diagnostics}; }
  const entryRel=entryKey.slice(rootKey.replace(/\/$/,'').length+1);
  const states=new Map([[entryKey,'visiting']]), stack=[{key:entryKey,readPath:entryPath,relPath:entryRel,doc:entryDoc,via:null}], emitted=new Set();
  const toReadPath=abs => /\\/.test(projectRoot) ? abs.replace(/\//g,'\\') : abs;
  while(stack.length) {
    const current=stack[stack.length-1];
    const imports=(current.doc?.nodes||[]).filter(n=>n.type==='import'&&n.data?.importType==='gcn');
    if(current.index===undefined) current.index=0;
    if(current.index>=imports.length) { states.set(current.key,'done'); stack.pop(); continue; }
    const node=imports[current.index++], dir=current.relPath.includes('/')?current.relPath.slice(0,current.relPath.lastIndexOf('/')+1):'';
    const raw=String(node.data?.path||'');
    const nextRel=posix(dir+raw);
    const file=current.relPath;
    if(nextRel===current.relPath) { diagnostic('gcn-import-self','A file cannot import itself.',file,node.id); continue; }
    if(nextRel==='..'||nextRel.startsWith('../')||nextRel.startsWith('/')) { diagnostic('gcn-import-outside-project',`Import escapes project root: ${nextRel}.`,file,node.id); continue; }
    const abs=posix(root+'/'+nextRel), key=keyPath(abs);
    if(states.get(key)==='visiting') {
      const start=stack.findIndex(item=>item.key===key);
      const chain=[...stack.slice(start).map(item=>item.relPath),nextRel];
      diagnostic('gcn-import-cycle',`Import cycle: ${chain.join(' → ')}`,file,node.id); continue;
    }
    if(states.get(key)==='done') continue;
    const readPath=toReadPath(abs);
    let doc=null; try { doc=await readDoc(readPath); } catch {}
    if(!doc) { diagnostic('gcn-import-not-found',`Could not read ${nextRel}.`,file,node.id); continue; }
    if(doc.target!==entryDoc.target) { diagnostic('gcn-import-target-mismatch',`Target mismatch in ${nextRel}.`,file,node.id); continue; }
    states.set(key,'visiting');
    const item={key,readPath,absPath:readPath,relPath:nextRel,doc};
    if(!emitted.has(key)) { files.push(item); emitted.add(key); }
    stack.push({...item,index:0});
  }
  return {files,diagnostics};
}
