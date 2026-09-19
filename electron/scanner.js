import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', '.svelte-kit', '.vite', 'coverage']);

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.svelte', '.vue',
  '.py',
  '.gd',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.inl',
  '.cs'
]);

const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  '.json', '.md', '.css', '.scss', '.html', '.rs', '.go', '.java', '.txt', '.yml', '.yaml'
]);

const IGNORED_WORDS = new Set([
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default',
  'return', 'goto', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'delete', 'typeof',
  'sizeof', 'instanceof', 'class', 'struct', 'interface', 'enum', 'function', 'def', 'func',
  'var', 'let', 'const', 'val', 'int', 'float', 'double', 'bool', 'char', 'string', 'void',
  'auto', 'static', 'extern', 'public', 'private', 'protected', 'internal', 'abstract',
  'virtual', 'override', 'async', 'await', 'import', 'export', 'from', 'as', 'in', 'is',
  'not', 'and', 'or', 'pass', 'yield', 'lambda', 'null', 'true', 'false', 'none', 'self',
  'this', 'super', 'extends', 'implements', 'using', 'namespace', 'package', 'type',
  'nullptr', 'NULL', 'None', 'True', 'False', 'undefined', 'NaN',
  'i', 'j', 'k', 'x', 'y', 'z', 'w', 'h', 'e', 'err', 't', 'fs', 'path', 'os', 'sys',
  'std', 'console', 'print', 'printf', 'cout', 'cin', 'endl', 'main', 'id', 'obj', 'item', 'key'
]);

function toPascalCase(str) {
  return str
    .replace(/[_-]+(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^\w/, (c) => c.toUpperCase());
}

export async function scanProject(rootPath) {
  const root = path.resolve(rootPath);
  const tree = await readDirectory(root, root);
  const flatFiles = [];
  flattenFiles(tree, flatFiles);

  const nodes = [];
  const edges = [];

  function walkNode(entry) {
    nodes.push({
      id: entry.path,
      label: entry.name,
      type: entry.type,
      path: entry.path,
      relativePath: entry.relativePath
    });

    if (entry.children) {
      for (const child of entry.children) {
        edges.push({
          id: `${entry.path}->${child.path}`,
          source: entry.path,
          target: child.path,
          type: 'contains'
        });
        walkNode(child);
      }
    }
  }

  walkNode(tree);

  const pathByRelativeNoExt = new Map();
  const pathByRelative = new Map();
  for (const file of flatFiles) {
    pathByRelative.set(normalize(file.relativePath), file.path);
    pathByRelativeNoExt.set(stripExtension(normalize(file.relativePath)), file.path);
  }

  const fileDataMap = new Map();

  for (const file of flatFiles) {
    const ext = path.extname(file.path).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    let content = '';
    try {
      content = await fs.readFile(file.path, 'utf8');
    } catch {
      continue;
    }

    if (CODE_EXTENSIONS.has(ext)) {
      const { symbols, rawImports, clean } = extractSymbols(content, ext);

      for (const symbol of symbols) {
        const symbolId = `${file.path}#${symbol.kind}:${symbol.name}:${symbol.line}`;
        nodes.push({
          id: symbolId,
          label: symbol.name,
          type: 'symbol',
          kind: symbol.kind,
          path: file.path,
          relativePath: `${file.relativePath}#${symbol.name}`,
          line: symbol.line
        });
        edges.push({
          id: `${file.path}->${symbolId}:defines`,
          source: file.path,
          target: symbolId,
          type: 'defines'
        });
      }

      // Collect word tokens and called functions
      const wordTokens = new Set(clean.match(/[A-Za-z_]\w*/g) || []);
      const calledFuncs = new Set();
      const callRegex = /\b([A-Za-z_]\w*)\s*\(/g;
      let callMatch;
      while ((callMatch = callRegex.exec(clean))) {
        calledFuncs.add(callMatch[1]);
      }

      fileDataMap.set(file.path, {
        file,
        ext,
        content,
        clean,
        symbols,
        classes: new Set(symbols.filter((s) => s.kind === 'class').map((s) => s.name)),
        functions: new Set(symbols.filter((s) => s.kind === 'function').map((s) => s.name)),
        variables: new Set(symbols.filter((s) => s.kind === 'variable').map((s) => s.name)),
        wordTokens,
        calledFuncs,
        rawImports
      });
    }

    if (ext === '.md') {
      for (const linkPath of extractMarkdownLinks(content)) {
        const target = resolveProjectReference(file.relativePath, linkPath, pathByRelative, pathByRelativeNoExt, flatFiles);
        if (target) {
          edges.push({
            id: `${file.path}->${target}:links`,
            source: file.path,
            target,
            type: 'links'
          });
        }
      }
    }
  }

  // Cross-file relationship resolution
  const codeFiles = [...fileDataMap.values()];

  // Track global variable usage across all files
  const globalVarFiles = new Map(); // varName -> Set of filePaths
  for (const { file, variables } of codeFiles) {
    for (const v of variables) {
      if (!globalVarFiles.has(v)) globalVarFiles.set(v, new Set());
      globalVarFiles.get(v).add(file.path);
    }
  }

  // Pairwise relationships between code files
  const pairEdges = new Map(); // `${src}->${tgt}` -> { classes: Set, functions: Set, variables: Set, importedClasses: Set, imports: boolean }

  function getPair(src, tgt) {
    const key = `${src}->${tgt}`;
    if (!pairEdges.has(key)) {
      pairEdges.set(key, {
        source: src,
        target: tgt,
        classes: new Set(),
        functions: new Set(),
        variables: new Set(),
        importedClasses: new Set(),
        imports: false
      });
    }
    return pairEdges.get(key);
  }

  // 1. Raw imports / includes resolution
  for (const { file, rawImports } of codeFiles) {
    for (const raw of rawImports) {
      const targetPath = resolveProjectReference(file.relativePath, raw, pathByRelative, pathByRelativeNoExt, flatFiles);
      if (targetPath && targetPath !== file.path) {
        const pair = getPair(file.path, targetPath);
        pair.imports = true;

        const targetData = fileDataMap.get(targetPath);
        if (targetData) {
          if (targetData.classes.size > 0) {
            for (const cls of targetData.classes) {
              pair.importedClasses.add(cls);
            }
          } else {
            const base = stripExtension(path.basename(targetData.file.path));
            const pascal = toPascalCase(base);
            pair.importedClasses.add(pascal);
          }
        }
      }
    }
  }

  // 2. Class and Function relationships (File A defines, File B uses/calls)
  for (const fileA of codeFiles) {
    for (const fileB of codeFiles) {
      if (fileA.file.path === fileB.file.path) continue;

      // Classes defined in A used in B
      for (const cls of fileA.classes) {
        if (!fileB.classes.has(cls) && fileB.wordTokens.has(cls)) {
          getPair(fileA.file.path, fileB.file.path).classes.add(cls);
        }
      }

      // Functions defined in A called in B
      for (const fn of fileA.functions) {
        if (!fileB.functions.has(fn) && (fileB.calledFuncs.has(fn) || fileB.rawImports.includes(fn))) {
          getPair(fileA.file.path, fileB.file.path).functions.add(fn);
        }
      }

      // Variables defined in A used in B
      for (const vr of fileA.variables) {
        if (!fileB.variables.has(vr) && fileB.wordTokens.has(vr)) {
          getPair(fileA.file.path, fileB.file.path).variables.add(vr);
        }
      }
    }
  }

  // 3. Shared Global Variables (files that both use the same global variable)
  for (const [varName, definingFiles] of globalVarFiles.entries()) {
    // Find files that reference this global variable even if they didn't define it
    for (const f of codeFiles) {
      if (f.wordTokens.has(varName)) {
        definingFiles.add(f.file.path);
      }
    }
    if (definingFiles.size > 1) {
      const fileList = [...definingFiles];
      for (let i = 0; i < fileList.length; i++) {
        for (let j = i + 1; j < fileList.length; j++) {
          getPair(fileList[i], fileList[j]).variables.add(varName);
        }
      }
    }
  }

  // Emit consolidated edges with proper types and labels
  for (const pair of pairEdges.values()) {
    const { source, target, classes, functions, variables, imports, importedClasses = new Set() } = pair;

    // Class edge (Blue)
    if (classes.size > 0) {
      const list = [...classes];
      const label = list.slice(0, 3).join(', ') + (list.length > 3 ? ` (+${list.length - 3})` : '');
      edges.push({
        id: `${source}->${target}:class`,
        source,
        target,
        type: 'class',
        label,
        symbolKind: 'class',
        symbols: list
      });
    }

    // Function edge (Green)
    if (functions.size > 0) {
      const list = [...functions];
      const label = list.slice(0, 3).map((f) => `${f}()`).join(', ') + (list.length > 3 ? ` (+${list.length - 3})` : '');
      edges.push({
        id: `${source}->${target}:function`,
        source,
        target,
        type: 'function',
        label,
        symbolKind: 'function',
        symbols: list
      });
    }

    // Variable edge (Red)
    if (variables.size > 0) {
      const list = [...variables];
      const label = list.slice(0, 3).join(', ') + (list.length > 3 ? ` (+${list.length - 3})` : '');
      edges.push({
        id: `${source}->${target}:variable`,
        source,
        target,
        type: 'variable',
        label,
        symbolKind: 'variable',
        symbols: list
      });
    }

    // Import edge (Purple) with Class / symbol name
    if (imports && classes.size === 0 && functions.size === 0 && variables.size === 0) {
      const targetData = fileDataMap.get(target);
      const classList = [...importedClasses];

      let importLabel = '';
      if (classList.length > 0) {
        importLabel = `Import: ${classList.slice(0, 2).join(', ')}${classList.length > 2 ? ` (+${classList.length - 2})` : ''}`;
      } else if (targetData?.functions?.size > 0) {
        const fns = [...targetData.functions].slice(0, 2);
        importLabel = `Import: ${fns.map((f) => `${f}()`).join(', ')}`;
      } else {
        const targetFileName = path.basename(target);
        importLabel = `Import: ${targetFileName}`;
      }

      edges.push({
        id: `${source}->${target}:imports`,
        source,
        target,
        type: 'imports',
        label: importLabel,
        symbolKind: 'class',
        symbols: classList
      });
    }
  }

  return { rootPath: root, tree, graph: { nodes, edges } };
}

async function readDirectory(currentPath, rootPath) {
  const stat = await fs.stat(currentPath);
  const name = path.basename(currentPath);
  const relativePath = normalize(path.relative(rootPath, currentPath)) || name;

  if (!stat.isDirectory()) {
    return { name, path: currentPath, relativePath, type: 'file' };
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;

    const entryPath = path.join(currentPath, entry.name);
    children.push(await readDirectory(entryPath, rootPath));
  }

  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name, path: currentPath, relativePath, type: 'folder', children };
}

function flattenFiles(entry, files) {
  if (entry.type === 'file') files.push(entry);
  for (const child of entry.children || []) flattenFiles(child, files);
}

function stripCommentsAndStrings(content, ext) {
  if (ext === '.py' || ext === '.gd') {
    return content
      .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, ' ')
      .replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, ' ')
      .replace(/#.*$/gm, ' ');
  }
  if (ext === '.svelte' || ext === '.vue') {
    content = content.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<template[\s\S]*?<\/template>/g, ' ');
  }
  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, ' ');
}

function extractSymbols(content, ext) {
  const symbols = [];
  const rawImports = [];
  const clean = stripCommentsAndStrings(content, ext);

  if (ext === '.py') {
    // Python imports
    const pyImportRegex = /^[ \t]*(?:from\s+([.\w]+)\s+import\s+([^#\n]+)|import\s+([^#\n]+))/gm;
    let m;
    while ((m = pyImportRegex.exec(content))) {
      if (m[1]) {
        rawImports.push(m[1].trim());
        const importedItems = m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
        for (const item of importedItems) rawImports.push(item);
      } else if (m[3]) {
        for (const item of m[3].split(',')) {
          const mod = item.trim().split(/\s+as\s+/)[0].trim();
          if (mod) rawImports.push(mod);
        }
      }
    }

    // Python classes
    const classRegex = /^[ \t]*class\s+([A-Za-z_]\w*)/gm;
    while ((m = classRegex.exec(clean))) {
      symbols.push({ kind: 'class', name: m[1], line: lineAt(content, m.index) });
    }

    // Python functions
    const funcRegex = /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
    while ((m = funcRegex.exec(clean))) {
      if (!m[1].startsWith('__')) {
        symbols.push({ kind: 'function', name: m[1], line: lineAt(content, m.index) });
      }
    }

    // Python global variables (top-level assignments)
    const varRegex = /^([A-Za-z_]\w*)\s*(?::\s*[^=]+)?\s*=(?!=)/gm;
    while ((m = varRegex.exec(clean))) {
      const name = m[1];
      if (!name.startsWith('__') && !IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }

    // Python global statements
    const globalStmtRegex = /^[ \t]*global\s+([A-Za-z_][\w,\s]*)/gm;
    while ((m = globalStmtRegex.exec(clean))) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        if (!IGNORED_WORDS.has(name) && name.length >= 2) {
          symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
        }
      }
    }
  } else if (ext === '.gd') {
    // GDScript preloads & extends
    const preloadRegex = /(?:preload|load)\s*\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = preloadRegex.exec(content))) {
      rawImports.push(m[1]);
    }
    const extendsRegex = /extends\s+["']([^"']+)["']/g;
    while ((m = extendsRegex.exec(content))) {
      rawImports.push(m[1]);
    }
    const extendsNamed = /extends\s+([A-Za-z_]\w*)/g;
    while ((m = extendsNamed.exec(clean))) {
      rawImports.push(m[1]);
    }

    // GDScript class_name & inner class
    const classNameRegex = /^[ \t]*class_name\s+([A-Za-z_]\w*)/gm;
    while ((m = classNameRegex.exec(clean))) {
      symbols.push({ kind: 'class', name: m[1], line: lineAt(content, m.index) });
    }
    const innerClassRegex = /^[ \t]*class\s+([A-Za-z_]\w*)\s*:/gm;
    while ((m = innerClassRegex.exec(clean))) {
      symbols.push({ kind: 'class', name: m[1], line: lineAt(content, m.index) });
    }

    // GDScript funcs
    const funcRegex = /^[ \t]*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/gm;
    while ((m = funcRegex.exec(clean))) {
      symbols.push({ kind: 'function', name: m[1], line: lineAt(content, m.index) });
    }

    // GDScript variables and constants
    const varRegex = /^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*(?:static\s+)?var\s+([A-Za-z_]\w*)/gm;
    while ((m = varRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
    const constRegex = /^[ \t]*const\s+([A-Za-z_]\w*)/gm;
    while ((m = constRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
  } else if (['.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.inl'].includes(ext)) {
    // C++ includes
    const incRegex = /#include\s*["<]([^">]+)[">]/g;
    let m;
    while ((m = incRegex.exec(content))) {
      rawImports.push(m[1]);
    }

    // C++ classes and structs
    const classRegex = /(?:class|struct)\s+(?:[A-Z_]+_API\s+)?([A-Za-z_]\w*)(?:\s+final)?(?:\s*:[^{;]*)?\s*\{/g;
    while ((m = classRegex.exec(clean))) {
      symbols.push({ kind: 'class', name: m[1], line: lineAt(content, m.index) });
    }

    // C++ functions
    const funcRegex = /^[ \t]*(?:(?:inline|static|virtual|explicit|constexpr|friend)\s+)*[\w:*&<>]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const)?\s*(?:noexcept)?\s*(?:override)?\s*[{;]/gm;
    while ((m = funcRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'function', name, line: lineAt(content, m.index) });
      }
    }

    // C++ global variables (extern, static, const, macros)
    const externRegex = /extern\s+[\w:*&<>]+\s+([A-Za-z_]\w*)\s*;/g;
    while ((m = externRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
    const macroConstRegex = /#define\s+([A-Z_][\w]*)\s+[^\n]+/g;
    while ((m = macroConstRegex.exec(content))) {
      const name = m[1];
      if (!name.endsWith('_H') && !name.endsWith('_HPP') && !IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
    const constGlobalRegex = /^[ \t]*(?:static\s+|constexpr\s+)?(?:const\s+)?[\w:*&<>]+\s+([A-Z_][\w]*)\s*=[^;]+;/gm;
    while ((m = constGlobalRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
  } else if (ext === '.cs') {
    // C# usings
    const usingRegex = /using\s+(?:static\s+)?([\w.]+);/g;
    let m;
    while ((m = usingRegex.exec(clean))) {
      rawImports.push(m[1]);
    }

    // C# classes, structs, interfaces
    const classRegex = /(?:class|struct|interface|record|enum)\s+([A-Za-z_]\w*)/g;
    while ((m = classRegex.exec(clean))) {
      symbols.push({ kind: 'class', name: m[1], line: lineAt(content, m.index) });
    }

    // C# methods
    const methodRegex = /(?:public|private|protected|internal|static|async|virtual|override|abstract|\s)+[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:where[^{;]+)?(?:\{|=>|;)/g;
    while ((m = methodRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'function', name, line: lineAt(content, m.index) });
      }
    }

    // C# static / const variables
    const staticVarRegex = /(?:public|private|protected|internal|\s)*(?:static\s+(?:readonly\s+)?|const\s+)[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*(?:=|;)/g;
    while ((m = staticVarRegex.exec(clean))) {
      const name = m[1];
      if (!IGNORED_WORDS.has(name) && name.length >= 2) {
        symbols.push({ kind: 'variable', name, line: lineAt(content, m.index) });
      }
    }
  } else {
    // JavaScript / TypeScript / Svelte / Vue
    for (const imp of extractImports(content)) rawImports.push(imp);

    const patterns = [
      { kind: 'class', regex: /(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g },
      { kind: 'function', regex: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g },
      { kind: 'function', regex: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g },
      { kind: 'function', regex: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g },
      { kind: 'variable', regex: /(?:export\s+)?(?:const|let|var)\s+([A-Z_][\w$]*)\s*=/g }
    ];

    for (const { kind, regex } of patterns) {
      let match;
      while ((match = regex.exec(clean))) {
        const name = match[1];
        if (!IGNORED_WORDS.has(name) && name.length >= 2) {
          symbols.push({ kind, name, line: lineAt(content, match.index) });
        }
      }
    }
  }

  return { symbols: symbols.slice(0, 300), rawImports, clean };
}

function extractImports(content) {
  const imports = new Set();
  const patterns = [
    /import\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g,
    /export\s+[^'\"]+?\s+from\s+['\"]([^'\"]+)['\"]/g,
    /require\(['\"]([^'\"]+)['\"]\)/g,
    /import\(['\"]([^'\"]+)['\"]\)/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) imports.add(match[1]);
  }

  return [...imports].filter((value) => value.startsWith('.') || value.startsWith('/'));
}

function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function extractMarkdownLinks(content) {
  const links = new Set();
  const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
  const wikiLink = /\[\[([^\]]+)\]\]/g;

  let match;
  while ((match = markdownLink.exec(content))) links.add(match[1].split('#')[0]);
  while ((match = wikiLink.exec(content))) links.add(match[1].split('|')[0].split('#')[0]);

  return [...links].filter(Boolean);
}

function resolveProjectReference(fromRelativePath, reference, pathByRelative, pathByRelativeNoExt, allFiles = []) {
  if (!reference || reference.startsWith('http')) return null;

  let cleaned = reference.trim();
  if (cleaned.startsWith('res://')) {
    cleaned = cleaned.replace(/^res:\/\//, '');
  }

  const fromDir = path.dirname(fromRelativePath);
  const candidate = normalize(cleaned.startsWith('/') ? cleaned.slice(1) : path.join(fromDir, cleaned));
  const candidateNoExt = stripExtension(candidate);

  const directPossibilities = [
    candidate,
    candidateNoExt,
    `${candidate}.py`,
    `${candidate}.gd`,
    `${candidate}.cpp`,
    `${candidate}.c`,
    `${candidate}.h`,
    `${candidate}.hpp`,
    `${candidate}.cs`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.svelte`,
    `${candidate}.md`,
    `${candidate}/index.js`,
    `${candidate}/index.ts`,
    `${candidate}/__init__.py`
  ].map(normalize);

  for (const item of directPossibilities) {
    if (pathByRelative.has(item)) return pathByRelative.get(item);
    if (pathByRelativeNoExt.has(item)) return pathByRelativeNoExt.get(item);
  }

  // Check matching basename across all project files (e.g. #include "header.h" or Python module)
  const baseName = path.basename(cleaned);
  const baseNameNoExt = stripExtension(baseName);
  for (const file of allFiles) {
    const rel = normalize(file.relativePath);
    if (path.basename(rel) === baseName || stripExtension(path.basename(rel)) === baseNameNoExt) {
      return file.path;
    }
  }

  return null;
}

function stripExtension(filePath) {
  return filePath.replace(/\.[^/.]+$/, '');
}

function normalize(value) {
  return value.replaceAll(path.sep, '/');
}

export async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

export async function readFileDataUrl(filePath) {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mime = ext === 'pdf' ? 'application/pdf' : ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function writeTextFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true };
}
