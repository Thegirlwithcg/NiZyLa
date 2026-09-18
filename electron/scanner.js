import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', '.svelte-kit', '.vite', 'coverage']);
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.svelte', '.vue']);
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.svelte', '.vue', '.json', '.md', '.css', '.scss', '.html', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.txt', '.yml', '.yaml'
]);

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
      for (const symbol of extractCodeSymbols(content, ext)) {
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

      for (const importPath of extractImports(content)) {
        const target = resolveProjectReference(file.relativePath, importPath, pathByRelative, pathByRelativeNoExt);
        if (target) {
          edges.push({
            id: `${file.path}->${target}:imports`,
            source: file.path,
            target,
            type: 'imports'
          });
        }
      }
    }

    if (ext === '.md') {
      for (const linkPath of extractMarkdownLinks(content)) {
        const target = resolveProjectReference(file.relativePath, linkPath, pathByRelative, pathByRelativeNoExt);
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

function extractCodeSymbols(content, ext) {
  const symbols = [];
  const patterns = [
    { kind: 'class', regex: /(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'function', regex: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g },
    { kind: 'function', regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g },
    { kind: 'function', regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g }
  ];

  if (ext === '.svelte' || ext === '.vue') {
    content = content.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<template[\s\S]*?<\/template>/g, '');
  }

  for (const { kind, regex } of patterns) {
    let match;
    while ((match = regex.exec(content))) {
      symbols.push({ kind, name: match[1], line: lineAt(content, match.index) });
    }
  }

  return symbols.slice(0, 200);
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

function resolveProjectReference(fromRelativePath, reference, pathByRelative, pathByRelativeNoExt) {
  if (!reference || reference.startsWith('http')) return null;

  const fromDir = path.dirname(fromRelativePath);
  const candidate = normalize(reference.startsWith('/') ? reference.slice(1) : path.join(fromDir, reference));
  const candidateNoExt = stripExtension(candidate);

  const possibilities = [
    candidate,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.svelte`,
    `${candidate}.md`,
    `${candidate}/index.js`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/index.svelte`
  ].map(normalize);

  for (const item of possibilities) {
    if (pathByRelative.has(item)) return pathByRelative.get(item);
  }

  if (pathByRelativeNoExt.has(candidateNoExt)) return pathByRelativeNoExt.get(candidateNoExt);
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
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function writeTextFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true };
}
