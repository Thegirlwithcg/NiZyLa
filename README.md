# NiZyLa

NiZyLa is an early prototype of a hybrid graph-aware programming editor.

## Goal

A code-first editor inspired by NeoVim, VS Code, and Obsidian:

- Open local project folders
- Browse files and folders
- Edit code with syntax highlighting
- Visualize project relationships as a graph
- Detect folder containment, JS/TS/Svelte imports, and Markdown links

## Stack

- Electron for desktop/local filesystem access
- Svelte + Vite for UI
- CodeMirror for code editing
- Node.js scanner for project graph generation

## Install from npm

NiZyLa is published on npm:

```bash
npm install -g nizyla
```

Launch it from your terminal:

```bash
nizyla
```

Update to the latest version:

```bash
npm install -g nizyla@latest
```

npm package: https://www.npmjs.com/package/nizyla

## Run from source

```bash
npm install
npm run dev
```

## Build desktop apps

NiZyLa is configured with Electron Builder for Windows, Linux, and macOS.
Build on the matching OS for best results:

```bash
npm run dist:linux   # Linux AppImage
npm run dist:win     # Windows NSIS installer
npm run dist:mac     # macOS DMG
```

Build artifacts are written to `release/`. GitHub Actions also builds all three platforms on push.

## Current prototype

- Multiple workspaces
- Explorer sidebar
- Create files and folders inside the active workspace
- Code editor with optional Vim mode
- Real file tabs
- Toggleable split editor panes
- Toggleable project graph panel
- Full-window graph mode
- Smooth force-style graph layout with pan, zoom, and draggable nodes
- File, folder, import, markdown-link, function, and class graph nodes/edges
- Command palette and file search
- Save file
- Rescan graph
- Command terminal panel
- User-selectable themes; default is Cream Light with JetBrains-style monospace text
- Plugin discovery scaffold via `.nizyla/plugins/*/plugin.json`
- LSP registry scaffold for future language-server integration

## Useful shortcuts

- `Ctrl/⌘P`: command palette / file search
- `Ctrl/⌘S`: save active tab
- `Ctrl/⌘G`: toggle graph
- `Ctrl/⌘\\`: toggle split editor
- `Ctrl/⌘\``: toggle terminal

## Next major features

- True pseudo-terminal support with streaming output
- Tree-sitter parsers for accurate symbols across languages
- Full LSP transport and diagnostics UI
- Plugin runtime sandbox and contribution points
- Persist workspace/session state
