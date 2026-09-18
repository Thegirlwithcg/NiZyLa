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

## Run

```bash
npm install
npm run dev
```

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
