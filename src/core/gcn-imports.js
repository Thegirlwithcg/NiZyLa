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
export function sameFilePath(a, b) {
  if (!a || !b) return false;
  const left = posix(a);
  const right = posix(b);
  return keyPath(left) === keyPath(right);
}
const inside = (path,root) => pathEqual(path,root) || (isDrivePath(path)||isDrivePath(root) ? path.toLowerCase().startsWith(root.toLowerCase().replace(/\/$/,'')+'/') : path.startsWith(root.replace(/\/$/,'')+'/'));
const pythonKeywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const reservedNames = new Set(`False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type _ breakpoint class_name const enum extends func namespace preload self signal static super trait var void when abstract export onready setget tool remote master puppet remotesync mastersync puppetsync sync true false null PI TAU INF NAN main print prints range float int bool str String StringName NodePath RID Object Callable Signal Dictionary Array Variant Vector2 Vector2i Rect2 Rect2i Vector3 Vector3i Transform2D Vector4 Vector4i Plane Quaternion AABB Basis Transform3D Projection Color len input posmod fposmod floori floor printraw OS`.split(/\s+/));
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
const basename = value => posix(value).split('/').filter(Boolean).pop() || '';
export function gcnAliasFor(fileName, takenNames = new Set()) {
  const stem = basename(fileName).replace(/\.gcn$/i, '');
  let alias = stem.replace(/[^A-Za-z0-9_]/g, '_');
  if (!alias) alias = 'module';
  if (/^[0-9]/.test(alias)) alias = `_${alias}`;
  if (reservedNames.has(alias)) alias = `${alias}_mod`;
  let candidate = alias;
  let index = 2;
  while (takenNames.has(candidate)) candidate = `${alias}_${index++}`;
  return candidate;
}
const relativePosix = (from, to) => {
  const fromPath = posix(from);
  const toPath = posix(to);
  const a = (fromPath === '.' ? '' : fromPath).split('/').filter(Boolean);
  const b = (toPath === '.' ? '' : toPath).split('/').filter(Boolean);
  const insensitive = isDrivePath(fromPath) || isDrivePath(toPath);
  let common = 0;
  while (common < a.length && common < b.length && (insensitive ? a[common].toLowerCase() === b[common].toLowerCase() : a[common] === b[common])) common++;
  return [...a.slice(common).map(() => '..'), ...b.slice(common)].join('/') || '';
};
export function importerRelDirFor(projectRoot, filePath) {
  if (!projectRoot || !filePath) return '';
  const root = posix(projectRoot);
  const file = posix(filePath);
  if (!inside(keyPath(file), keyPath(root))) return '';
  const relative = relativePosix(root, file);
  const slash = relative.lastIndexOf('/');
  return slash < 0 ? '' : relative.slice(0, slash);
}
export function resolveGcnImportPath(filePath, importPath) {
  if (!filePath || !importPath) return '';
  const normalized = posix(filePath);
  const slash = normalized.lastIndexOf('/');
  return posix(`${slash < 0 ? '' : normalized.slice(0, slash)}/${importPath}`);
}
const dropName = value => basename(value) || String(value || '');
export function planGcnDrop({ importerPath, projectRoot, target, droppedPaths = [], docTargets = new Map(), existingImports = [], takenNames = new Set() }) {
  const adds = [], selectNodeIds = [], toasts = [], invalid = [];
  const taken = new Set(takenNames || []);
  const imported = new Map();
  const normalizedMap = new Map();
  for (const item of existingImports || []) normalizedMap.set(posix(item.path || ''), item.nodeId);
  const validPaths = [];
  for (const dropped of droppedPaths) {
    if (!/\.gcn$/i.test(String(dropped || ''))) invalid.push(dropName(dropped));
    else validPaths.push(dropped);
  }
  if (!importerPath) {
    if (validPaths.length > 0) toasts.push('Save this graph first');
    if (invalid.length > 0) toasts.push(`Only .gcn files can be imported: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ', …' : ''}`);
    return { adds, selectNodeIds, toasts };
  }
  const importer = posix(importerPath);
  const root = projectRoot ? posix(projectRoot) : null;
  if (root && !inside(keyPath(importer), keyPath(root))) return { adds, selectNodeIds, toasts: ['Save this graph inside the open project folder'] };
  const importerRel = root ? relativePosix(root, importer) : '';
  const importerRelDir = importerRel.includes('/') ? importerRel.slice(0, importerRel.lastIndexOf('/')) : '';
  for (const dropped of validPaths) {
    const file = posix(dropped);
    const name = dropName(file);
    if (!root || !inside(keyPath(file), keyPath(root))) { toasts.push(`File must be inside the open project folder: ${name}`); continue; }
    if (pathEqual(file, importer)) { toasts.push('A file cannot import itself'); continue; }
    const relPath = relativePosix(root, file);
    const docTarget = docTargets.has(dropped) ? docTargets.get(dropped) : docTargets.get(file);
    if (docTarget === null || docTarget === undefined) { toasts.push(`Cannot read ${name}`); continue; }
    if (docTarget !== target) { toasts.push(`Target mismatch: ${name} is ${docTarget}`); continue; }
    const importPath = relativePosix(importerRelDir, relPath);
    if (target === 'python') {
      const module = gcnModuleName(importerRelDir, importPath);
      if (module.error) { toasts.push(module.error); continue; }
    }
    const normalized = posix(importPath);
    const existingNodeId = normalizedMap.get(normalized);
    if (existingNodeId !== undefined) { selectNodeIds.push(existingNodeId); continue; }
    if (imported.has(normalized)) continue;
    const alias = gcnAliasFor(name, taken);
    taken.add(alias);
    imported.set(normalized, true);
    adds.push({ path: normalized, alias });
  }
  if (invalid.length > 0) toasts.push(`Only .gcn files can be imported: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ', …' : ''}`);
  return { adds, selectNodeIds, toasts };
}
export function exportEntries(exports, target) {
  if (!exports) return [];
  const rows = [];
  for (const item of exports.functions || []) {
    const params = item.params || [];
    const disabled = target === 'gdscript' && item.isStatic !== true;
    rows.push({ kind: 'function', name: item.name, params, label: `ƒ ${item.name}(${params.join(', ')})`, disabled, title: disabled ? 'Mark as Static in the source file to call it from GDScript' : '' });
  }
  for (const item of exports.classes || []) {
    const initParams = item.initParams || [];
    rows.push({ kind: 'class', name: item.name, initParams, label: `◻ ${item.name}(${initParams.join(', ')})`, disabled: false, title: '' });
  }
  return rows;
}
export function gcnImportDiagnostics(doc, target, options = {}) {
  const diagnostics = [];
  const imports = new Map((doc?.nodes || []).filter(node => node.type === 'import' && node.data?.importType === 'gcn').map(node => [node.id, node]));
  for (const node of imports.values()) {
    if (target === 'python') {
      const result = gcnModuleName(options.importerRelDir || '', node.data?.path || '');
      if (result.error) diagnostics.push({ severity: 'error', code: 'gcn-import-invalid-module', message: result.error, nodeId: node.id });
    }
    if (options.gcnExports?.has?.(node.data?.path)) {
      const exports = options.gcnExports.get(node.data.path);
      if (exports === null) diagnostics.push({ severity: 'error', code: 'gcn-import-not-found', message: `Cannot read ${node.data.path}.`, nodeId: node.id });
    }
  }
  const walk = (graph) => {
    for (const node of graph?.nodes || []) {
      if ((node.type === 'functionCall' || node.type === 'instantiate') && imports.has(node.data?.importNodeId) && options.gcnExports?.has?.(imports.get(node.data.importNodeId).data?.path)) {
        const imported = imports.get(node.data.importNodeId);
        const exports = options.gcnExports.get(imported.data.path);
        if (exports) {
          const alias = imported.data?.alias || 'module';
          if (node.type === 'functionCall') {
            const name = node.data?.name || 'call';
            const fn = (exports.functions || []).find(item => item.name === name);
            if (!fn) diagnostics.push({ severity: 'error', code: 'gcn-import-missing-symbol', message: `${alias} has no function ${name}.`, nodeId: node.id });
            else {
              const expected = (fn.params || []).length;
              const actual = (node.data?.argumentNames || []).length;
              if (expected !== actual) diagnostics.push({ severity: 'warning', code: 'gcn-import-arg-count', message: `${name} expects ${expected} arguments, got ${actual}.`, nodeId: node.id });
              if (target === 'gdscript' && fn.isStatic !== true) diagnostics.push({ severity: 'error', code: 'gcn-import-gd-nonstatic', message: `Mark ${name} as Static in ${imported.data.path} to call it from another GDScript file.`, nodeId: node.id });
            }
          } else {
            const name = node.data?.className || 'Object';
            const cls = (exports.classes || []).find(item => item.name === name);
            if (!cls) diagnostics.push({ severity: 'error', code: 'gcn-import-missing-symbol', message: `${alias} has no class ${name}.`, nodeId: node.id });
            else {
              const expected = (cls.initParams || []).length;
              const actual = (node.data?.argumentNames || []).length;
              if (expected !== actual) diagnostics.push({ severity: 'warning', code: 'gcn-import-arg-count', message: `${name} expects ${expected} arguments, got ${actual}.`, nodeId: node.id });
            }
          }
        }
      }
      if (node.data?.graph) walk(node.data.graph);
    }
  };
  walk(doc);
  return diagnostics;
}
const dirnamePosix = value => { const normalized = posix(value); const index = normalized.lastIndexOf('/'); return index < 0 ? '' : normalized.slice(0, index); };
const relativeToRoot = (root, file) => { const rootPath = posix(root); const filePath = posix(file); const prefix = rootPath.replace(/\/$/, '') + '/'; return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath; };
const codegenErrors = (result) => (result?.diagnostics || []).filter(item => item.severity === 'error').map(item => item.message);
export function planExportTargets(folder, files, { resolve, relative, isAbsolute }) {
  return files.map(({ outPath, code }) => {
    const target = resolve(folder, ...String(outPath).split('/'));
    const relFromFolder = relative(folder, target);
    if (isAbsolute(relFromFolder) || relFromFolder === '..' || relFromFolder.startsWith(`..${String.fromCharCode(92)}`) || relFromFolder.startsWith('../')) {
      throw new Error(`Export path escapes the selected folder: ${outPath}`);
    }
    return { target, code, relFromFolder };
  });
}
export async function buildGcnBuildPlan({ entryPath, entryDoc, projectRoot, readDoc, target, generate }) {
  const hasImports = (entryDoc?.nodes || []).some(node => node.type === 'import' && node.data?.importType === 'gcn');
  if (hasImports && (!projectRoot || !entryPath)) return { ok: false, error: 'Save this graph inside an open project folder to use .gcn imports.' };
  const entryRelPath = projectRoot && entryPath ? relativeToRoot(projectRoot, entryPath) : posix(entryPath || '');
  const importerRelDir = projectRoot ? dirnamePosix(entryRelPath) : '';
  const closure = hasImports
    ? await resolveGcnImportClosure({ entryPath, entryDoc, projectRoot, readDoc, })
    : { files: [], diagnostics: [] };
  const problems = closure.diagnostics.map(item => `${item.file}: ${item.message}`);
  const entryResult = generate(entryDoc, target, { importerRelDir });
  for (const message of codegenErrors(entryResult)) problems.push(`${entryRelPath}: ${message}`);
  const deps = [];
  const extension = target === 'gdscript' ? '.gd' : '.py';
  const entryName = projectRoot ? entryRelPath : (posix(entryPath || '').split('/').pop() || 'main.gcn');
  const entryOutPath = entryName.replace(/\.gcn$/, extension);
  for (const file of closure.files) {
    const depImporterRelDir = dirnamePosix(file.relPath);
    const result = generate(file.doc, target, { importerRelDir: depImporterRelDir });
    for (const message of codegenErrors(result)) problems.push(`${file.relPath}: ${message}`);
    if (result?.code !== null && result?.code !== undefined) deps.push({ relPath: file.relPath, outPath: file.relPath.replace(/\.gcn$/, extension), code: result.code });
  }
  if (problems.length > 0) return { ok: false, error: problems.join('\n') };
  return { ok: true, importerRelDir, entryCode: entryResult.code, entryOutPath, deps };
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
