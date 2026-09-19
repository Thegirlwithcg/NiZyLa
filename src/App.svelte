<script>
  import { onMount, tick } from 'svelte';
  import FileTree from './components/FileTree.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import GraphView from './components/GraphView.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';
  import logoUrl from '../resource/Logo NiZyLa.svg';
  import MarkdownPreview from './components/MarkdownPreview.svelte';

  let projects = [];
  let activeProjectIndex = 0;

  let nextPaneId = 2;
  let panes = [
    {
      id: 1,
      tabs: [],
      active: null,
      floating: false,
      floatRect: { x: 300, y: 90, width: 740, height: 540, maximized: false },
      zIndex: 10
    }
  ];
  let activePaneId = 1;

  let status = 'Open a project folder to begin.';
  let graphVisible = true;
  let graphFloating = false;
  let graphFloat = { x: 320, y: 90, width: 760, height: 560, maximized: false, zIndex: 12 };
  let graphFullscreen = false;

  let terminalVisible = false;
  let terminalFloating = false;
  let terminalFloat = { x: 260, y: 380, width: 800, height: 360, maximized: false, zIndex: 13 };

  let topZIndex = 20;
  let activeFloatingWindow = null;
  let floatingDrag = null;

  let vimMode = false;
  let markdownPreview = false;
  let paletteOpen = false;
  let query = '';
  let paletteInput;
  let plugins = [];
  let theme = localStorage.getItem('nizyla.theme') || 'obsidian';
  let showLineNumbers = localStorage.getItem('nizyla.lineNumbers') !== 'false';
  let createDialog = null;
  let createPath = '';
  let createParent = null;
  let createInput;
  let contextMenu = null;
  let deleteTarget = null;
  let workspaceEl;
  let layoutDrag = null;
  let layoutSize = { sidebar: 270, graph: 390, terminal: 190 };

  const api = globalThis.nizyla;
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
  $: project = projects[activeProjectIndex] ?? null;
  $: currentPane = panes.find((p) => p.id === activePaneId) ?? panes[0] ?? null;
  $: activeTab = currentPane?.tabs.find((tab) => tab.id === currentPane?.active) ?? null;
  $: activeFile = activeTab?.file ?? null;
  $: dockedPanes = panes.filter((p) => !p.floating);
  $: floatingPanes = panes.filter((p) => p.floating);
  $: files = projects.flatMap((p) => flattenFiles(p.tree).map((f) => ({ ...f, projectRoot: p.rootPath })));
  $: filteredFiles = query ? files.filter((file) => file.relativePath.toLowerCase().includes(query.toLowerCase())).slice(0, 40) : files.slice(0, 40);

  onMount(() => {
    const closeContextMenuOnOutsideClick = (event) => {
      if (contextMenu && !event.target.closest('.context-menu')) contextMenu = null;
    };
    const keydown = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); openPalette(); query = ''; }
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); saveFile(); }
      if (mod && event.key.toLowerCase() === 'g') { event.preventDefault(); graphVisible = !graphVisible; }
      if (mod && event.key.toLowerCase() === '\\') { event.preventDefault(); toggleSplit(); }
      if (mod && event.key === '`') { event.preventDefault(); terminalVisible = !terminalVisible; }
      if (event.key === 'Escape') paletteOpen = false;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('pointerdown', closeContextMenuOnOutsideClick);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('pointerdown', closeContextMenuOnOutsideClick);
    };
  });

  async function openProject() {
    if (!api) {
      status = 'Desktop APIs are unavailable in web preview. Run npm run dev for Electron.';
      return;
    }
    const result = await api.openProject();
    if (!result) return;
    projects = [...projects.filter((p) => p.rootPath !== result.rootPath), result];
    activeProjectIndex = projects.length - 1;
    status = `Opened ${result.rootPath}`;
    await refreshPlugins();
  }

  async function refreshProject() {
    if (!project || !api) return;
    const rescanned = await api.scanProject(project.rootPath);
    projects = projects.map((p, index) => index === activeProjectIndex ? rescanned : p);
    status = `Rescanned ${rescanned.rootPath}`;
    await refreshPlugins();
  }

  async function refreshPlugins() {
    if (!api) return;
    plugins = await api.listPlugins(projects.map((p) => p.rootPath));
  }

  function previewTypeFor(filePath = '') {
    const cleanPath = filePath.split('?')[0].split('#')[0].toLowerCase();
    const ext = cleanPath.includes('.') ? cleanPath.slice(cleanPath.lastIndexOf('.')) : '';
    if (imageExtensions.has(ext)) return 'image';
    if (ext === '.pdf') return 'pdf';
    return 'text';
  }

  function closeWorkspace(index) {
    const closing = projects[index];
    if (!closing) return;
    projects = projects.filter((_, itemIndex) => itemIndex !== index);
    panes = panes.map((pane) => {
      const tabs = pane.tabs.filter((tab) => !tab.file.path.startsWith(closing.rootPath));
      return { ...pane, tabs, active: tabs.some((tab) => tab.id === pane.active) ? pane.active : tabs.at(-1)?.id ?? null };
    });
    const remainingCount = projects.length;
    activeProjectIndex = remainingCount ? Math.max(0, Math.min(activeProjectIndex >= index ? activeProjectIndex - 1 : activeProjectIndex, remainingCount - 1)) : 0;
    status = `Closed ${closing.rootPath}`;
    refreshPlugins();
  }

  async function selectFile(entry, targetPaneId = activePaneId) {
    if (entry.type !== 'file' && entry.type !== 'symbol') return;
    const owningProject = projects.findIndex((p) => entry.path.startsWith(p.rootPath));
    if (owningProject >= 0) activeProjectIndex = owningProject;

    const previewType = previewTypeFor(entry.path);
    let content = '';
    try {
      content = previewType === 'text' ? await api.readFile(entry.path) : await api.readFileDataUrl(entry.path);
    } catch (error) {
      status = `Could not read ${entry.name}: ${error.message}`;
      return;
    }

    const file = { name: entry.name ?? entry.label, path: entry.path, relativePath: entry.relativePath?.split('#')[0] ?? entry.label, type: 'file', previewType };
    markdownPreview = file.name.toLowerCase().endsWith('.md');
    const id = file.path;

    const targetPane = panes.find((p) => p.id === targetPaneId) ?? panes[0];
    if (!targetPane) return;
    const paneId = targetPane.id;
    const exists = targetPane.tabs.some((tab) => tab.id === id);

    panes = panes.map((p) => p.id === paneId ? {
      ...p,
      active: id,
      tabs: exists ? p.tabs.map((tab) => tab.id === id ? { ...tab, file, content } : tab) : [...p.tabs, { id, file, content, dirty: false }]
    } : p);
    activePaneId = paneId;
    paletteOpen = false;
    status = entry.type === 'symbol' ? `${entry.relativePath} line ${entry.line}` : file.relativePath;
  }

  async function selectGraphNode(event) {
    await selectFile(event.detail);
  }

  function isSameOrDescendant(filePath, parentPath) {
    return filePath === parentPath || filePath.startsWith(`${parentPath}/`) || filePath.startsWith(`${parentPath}\\`);
  }

  async function moveEntry(event) {
    const { source, target } = event.detail;
    if (!api?.movePath || (source.type !== 'file' && source.type !== 'folder')) return;
    try {
      const result = await api.movePath(source.path, target.path);
      const targetRelativePath = target.path === project.rootPath ? '' : target.relativePath;
      panes = panes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) => {
          if (!isSameOrDescendant(tab.file.path, source.path)) return tab;
          const suffix = tab.file.path.slice(source.path.length);
          const relativeSuffix = tab.file.relativePath.slice(source.relativePath.length).replace(/^[/\\]/, '');
          const relativePath = [targetRelativePath, source.name, relativeSuffix].filter(Boolean).join('/');
          return { ...tab, id: `${result.path}${suffix}`, file: { ...tab.file, path: `${result.path}${suffix}`, relativePath } };
        }),
        active: isSameOrDescendant(pane.active ?? '', source.path) ? `${result.path}${pane.active.slice(source.path.length)}` : pane.active
      }));
      status = `Moved ${source.name} to ${target.relativePath}`;
      await refreshProject();
    } catch (error) {
      status = `Could not move ${source.name}: ${error.message}`;
    }
  }

  async function openWikiLink(target) {
    const wanted = target.trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '').toLowerCase();
    const note = files.find((file) => {
      if (file.projectRoot !== project?.rootPath || !file.name.toLowerCase().endsWith('.md')) return false;
      return file.relativePath.replace(/\.md$/i, '').toLowerCase() === wanted;
    });
    if (note) await selectFile(note);
    else status = `Note not found: ${target}`;
  }

  function updateTabContent(paneId, content) {
    panes = panes.map((p) => p.id === paneId ? {
      ...p,
      tabs: p.tabs.map((tab) => tab.id === p.active ? { ...tab, content, dirty: true } : tab)
    } : p);
  }

  function getActiveTab(pane) {
    return pane?.tabs.find((item) => item.id === pane?.active) ?? null;
  }

  function activateTab(paneId, tabId) {
    activePaneId = paneId;
    panes = panes.map((pane) => pane.id === paneId ? { ...pane, active: tabId } : pane);
  }

  function closeTab(paneId, tabId) {
    panes = panes.map((p) => {
      if (p.id !== paneId) return p;
      const nextTabs = p.tabs.filter((tab) => tab.id !== tabId);
      const nextActive = p.active === tabId ? nextTabs.at(-1)?.id ?? null : p.active;
      return { ...p, tabs: nextTabs, active: nextActive };
    });
  }

  function addPane(floating = false) {
    const newId = nextPaneId++;
    const currentActiveTab = activeTab;
    const initialTabs = currentActiveTab ? [{ ...currentActiveTab, dirty: false }] : [];
    const offset = (panes.length % 6) * 32;
    const newPane = {
      id: newId,
      tabs: initialTabs,
      active: currentActiveTab?.id ?? null,
      floating,
      floatRect: {
        x: Math.max(40, 260 + offset),
        y: Math.max(60, 90 + offset),
        width: 720,
        height: 520,
        maximized: false
      },
      zIndex: ++topZIndex
    };
    panes = [...panes, newPane];
    activePaneId = newId;
    if (floating) {
      activeFloatingWindow = `editor-${newId}`;
    }
    status = `Added editor window #${newId}${floating ? ' (floating)' : ''}`;
    return newPane;
  }

  function closePane(paneId) {
    if (panes.length <= 1) return;
    const paneToClose = panes.find((p) => p.id === paneId);
    const remaining = panes.filter((p) => p.id !== paneId);
    const targetPane = remaining.find((p) => p.id === activePaneId) || remaining[0];
    if (paneToClose && targetPane) {
      for (const tab of paneToClose.tabs) {
        if (!targetPane.tabs.some((t) => t.id === tab.id)) {
          targetPane.tabs.push(tab);
        }
      }
      if (!targetPane.active && targetPane.tabs.length) {
        targetPane.active = targetPane.tabs[0].id;
      }
    }
    panes = [...remaining];
    if (activePaneId === paneId) {
      activePaneId = targetPane?.id ?? remaining[0]?.id;
    }
    status = `Closed editor window #${paneId}`;
  }

  function togglePaneFloat(paneId) {
    panes = panes.map((pane) => {
      if (pane.id !== paneId) return pane;
      const nextFloating = !pane.floating;
      if (nextFloating) {
        topZIndex += 1;
        activeFloatingWindow = `editor-${paneId}`;
      }
      return {
        ...pane,
        floating: nextFloating,
        zIndex: nextFloating ? topZIndex : pane.zIndex
      };
    });
    activePaneId = paneId;
  }

  function dockAllEditors() {
    panes = panes.map((p) => ({ ...p, floating: false }));
  }

  function toggleSplit() {
    if (dockedPanes.length <= 1) {
      addPane(false);
    } else {
      const [first, ...rest] = dockedPanes;
      for (const p of rest) {
        closePane(p.id);
      }
    }
  }

  async function saveFile() {
    const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
    const tab = pane?.tabs.find((item) => item.id === pane?.active);
    if (!tab || !api || tab.file.previewType !== 'text') return;
    await api.writeFile(tab.file.path, tab.content);
    panes = panes.map((p) => p.id === pane.id ? { ...p, tabs: p.tabs.map((t) => t.id === tab.id ? { ...t, dirty: false } : t) } : p);
    status = `Saved ${tab.file.relativePath}`;
    await refreshProject();
  }

  async function openPalette() {
    paletteOpen = true;
    await tick();
    paletteInput?.focus();
  }

  function closePalette() { paletteOpen = false; }

  function setTheme(nextTheme) {
    theme = nextTheme;
    localStorage.setItem('nizyla.theme', nextTheme);
  }

  function toggleLineNumbers() {
    showLineNumbers = !showLineNumbers;
    localStorage.setItem('nizyla.lineNumbers', String(showLineNumbers));
  }

  function cleanRelativePath(value) {
    return value?.trim().replace(/^\/+/, '').replace(/\/+/g, '/') ?? '';
  }

  async function openCreateDialog(type, parent = project?.tree) {
    if (!project) return;
    createDialog = type;
    createParent = parent;
    createPath = '';
    await tick();
    createInput?.focus();
  }

  function openContextMenu(event) {
    contextMenu = event.detail;
  }

  function openExplorerContextMenu(event) {
    if (event.target !== event.currentTarget || !project) return;
    event.preventDefault();
    contextMenu = { entry: project.tree, x: event.clientX, y: event.clientY };
  }

  function openCreateFromContext(type) {
    const parent = contextMenu?.entry ?? project?.tree;
    contextMenu = null;
    openCreateDialog(type, parent);
  }

  function askDelete(entry) {
    contextMenu = null;
    deleteTarget = entry;
  }

  function removeTreeEntry(entry, targetPath) {
    if (!entry || entry.path === targetPath) return null;
    return { ...entry, children: entry.children?.map((child) => removeTreeEntry(child, targetPath)).filter(Boolean) };
  }

  async function deleteSelectedPath() {
    if (!deleteTarget || !api) return;
    const target = deleteTarget;
    try {
      await api.deletePath(target.path);
      projects = projects.map((workspace, index) => index === activeProjectIndex ? {
        ...workspace,
        tree: removeTreeEntry(workspace.tree, target.path),
        graph: {
          nodes: workspace.graph.nodes.filter((node) => node.path !== target.path && !node.path.startsWith(`${target.path}/`)),
          edges: workspace.graph.edges.filter((edge) => !edge.source.startsWith(target.path) && !edge.target.startsWith(target.path))
        }
      } : workspace);
      panes = panes.map((pane) => {
        const tabs = pane.tabs.filter((tab) => tab.file.path !== target.path && !tab.file.path.startsWith(`${target.path}/`));
        return { ...pane, tabs, active: tabs.some((tab) => tab.id === pane.active) ? pane.active : tabs.at(-1)?.id ?? null };
      });
      status = `Deleted ${target.relativePath}`;
      deleteTarget = null;
      api.scanProject(project.rootPath).then((rescanned) => {
        projects = projects.map((workspace, index) => index === activeProjectIndex ? rescanned : workspace);
      });
    } catch (error) {
      status = `Could not delete ${deleteTarget.name}: ${error.message}`;
    }
  }

  function closeCreateDialog() {
    createDialog = null;
    createPath = '';
    createParent = null;
  }

  function closeCreateDialogFromBackdrop(event) {
    if (event.target === event.currentTarget) closeCreateDialog();
  }

  async function submitCreateDialog() {
    if (!project || !api || !createDialog) return;
    const name = cleanRelativePath(createPath);
    if (!name) return;
    const parent = createParent ?? project.tree;
    const relativePath = parent.path === project.rootPath ? name : `${parent.relativePath}/${name}`;
    try {
      if (createDialog === 'file' || createDialog === 'note') {
        const filePath = `${parent.path}/${name}`;
        await api.createFile(filePath);
        if (createDialog === 'note') {
          const title = name.split('/').at(-1).replace(/\.md$/i, '').replace(/[-_]/g, ' ');
          await api.writeFile(filePath, `---\ntitle: ${title}\ncreated: ${new Date().toISOString().slice(0, 10)}\ntags: []\n---\n\n# ${title}\n\n`);
        }
        await refreshProject();
        await selectFile({ name: name.split('/').at(-1), path: filePath, relativePath, type: 'file' });
        status = `Created file ${relativePath}`;
      } else {
        await api.createFolder(`${parent.path}/${name}`);
        await refreshProject();
        status = `Created folder ${relativePath}`;
      }
      closeCreateDialog();
    } catch (error) {
      status = `Could not create ${createDialog}: ${error.message}`;
    }
  }

  function focusFloatingWindow(windowType, paneId = null) {
    topZIndex += 1;
    if (windowType === 'graph') {
      activeFloatingWindow = 'graph';
      graphFloat = { ...graphFloat, zIndex: topZIndex };
    } else if (windowType === 'terminal') {
      activeFloatingWindow = 'terminal';
      terminalFloat = { ...terminalFloat, zIndex: topZIndex };
    } else if (windowType === 'editor' && paneId !== null) {
      activeFloatingWindow = `editor-${paneId}`;
      activePaneId = paneId;
      panes = panes.map((p) => p.id === paneId ? { ...p, zIndex: topZIndex } : p);
    }
  }

  function toggleMaximizeFloatingWindow(windowType, paneId = null) {
    focusFloatingWindow(windowType, paneId);
    if (windowType === 'graph') {
      graphFloat = { ...graphFloat, maximized: !graphFloat.maximized };
    } else if (windowType === 'terminal') {
      terminalFloat = { ...terminalFloat, maximized: !terminalFloat.maximized };
    } else if (windowType === 'editor' && paneId !== null) {
      panes = panes.map((p) => p.id === paneId ? {
        ...p,
        floatRect: { ...p.floatRect, maximized: !p.floatRect?.maximized }
      } : p);
    }
  }

  function startFloatingMove(event, windowType, paneId = null) {
    if (event.target.closest('button, select, input, .tab-close, .tab')) return;
    event.preventDefault();
    focusFloatingWindow(windowType, paneId);

    let initialRect;
    if (windowType === 'graph') {
      if (graphFloat.maximized || graphFullscreen) return;
      initialRect = { ...graphFloat };
    } else if (windowType === 'terminal') {
      if (terminalFloat.maximized) return;
      initialRect = { ...terminalFloat };
    } else if (windowType === 'editor') {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane || pane.floatRect?.maximized) return;
      initialRect = { ...pane.floatRect };
    }
    if (!initialRect) return;

    floatingDrag = {
      action: 'move',
      windowType,
      paneId,
      startX: event.clientX,
      startY: event.clientY,
      ...initialRect
    };

    window.addEventListener('pointermove', onFloatingPointerMove);
    window.addEventListener('pointerup', stopFloatingDrag, { once: true });
  }

  function startFloatingResize(event, windowType, paneId = null) {
    event.preventDefault();
    event.stopPropagation();
    focusFloatingWindow(windowType, paneId);

    let initialRect;
    if (windowType === 'graph') {
      if (graphFloat.maximized || graphFullscreen) return;
      initialRect = { ...graphFloat };
    } else if (windowType === 'terminal') {
      if (terminalFloat.maximized) return;
      initialRect = { ...terminalFloat };
    } else if (windowType === 'editor') {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane || pane.floatRect?.maximized) return;
      initialRect = { ...pane.floatRect };
    }
    if (!initialRect) return;

    floatingDrag = {
      action: 'resize',
      windowType,
      paneId,
      startX: event.clientX,
      startY: event.clientY,
      ...initialRect
    };

    window.addEventListener('pointermove', onFloatingPointerMove);
    window.addEventListener('pointerup', stopFloatingDrag, { once: true });
  }

  function onFloatingPointerMove(event) {
    if (!floatingDrag) return;
    const dx = event.clientX - floatingDrag.startX;
    const dy = event.clientY - floatingDrag.startY;
    const minW = floatingDrag.windowType === 'terminal' ? 360 : 340;
    const minH = floatingDrag.windowType === 'terminal' ? 180 : 240;

    if (floatingDrag.action === 'move') {
      const nextX = Math.max(8, Math.min(window.innerWidth - floatingDrag.width - 8, floatingDrag.x + dx));
      const nextY = Math.max(52, Math.min(window.innerHeight - floatingDrag.height - 30, floatingDrag.y + dy));

      if (floatingDrag.windowType === 'graph') {
        graphFloat = { ...graphFloat, x: nextX, y: nextY };
      } else if (floatingDrag.windowType === 'terminal') {
        terminalFloat = { ...terminalFloat, x: nextX, y: nextY };
      } else if (floatingDrag.windowType === 'editor') {
        panes = panes.map((p) => p.id === floatingDrag.paneId ? { ...p, floatRect: { ...p.floatRect, x: nextX, y: nextY } } : p);
      }
    } else if (floatingDrag.action === 'resize') {
      const nextW = Math.max(minW, Math.min(window.innerWidth - floatingDrag.x - 8, floatingDrag.width + dx));
      const nextH = Math.max(minH, Math.min(window.innerHeight - floatingDrag.y - 30, floatingDrag.height + dy));

      if (floatingDrag.windowType === 'graph') {
        graphFloat = { ...graphFloat, width: nextW, height: nextH };
      } else if (floatingDrag.windowType === 'terminal') {
        terminalFloat = { ...terminalFloat, width: nextW, height: nextH };
      } else if (floatingDrag.windowType === 'editor') {
        panes = panes.map((p) => p.id === floatingDrag.paneId ? { ...p, floatRect: { ...p.floatRect, width: nextW, height: nextH } } : p);
      }
    }
  }

  function stopFloatingDrag() {
    floatingDrag = null;
    window.removeEventListener('pointermove', onFloatingPointerMove);
  }

  function getTerminalStyle(floating, rect) {
    if (!floating) return undefined;
    if (rect.maximized) {
      return `left: 8px; top: 58px; width: calc(100vw - 16px); height: calc(100vh - 90px); z-index: ${rect.zIndex};`;
    }
    return `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; z-index: ${rect.zIndex};`;
  }

  function getGraphStyle(floating, rect, fullscreen) {
    if (fullscreen) return undefined;
    if (!floating) return undefined;
    if (rect.maximized) {
      return `left: 8px; top: 58px; width: calc(100vw - 16px); height: calc(100vh - 90px); z-index: ${rect.zIndex};`;
    }
    return `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; z-index: ${rect.zIndex};`;
  }

  function getFloatingPaneStyle(pane) {
    const rect = pane.floatRect;
    if (rect?.maximized) {
      return `left: 8px; top: 58px; width: calc(100vw - 16px); height: calc(100vh - 90px); z-index: ${pane.zIndex};`;
    }
    return `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; z-index: ${pane.zIndex};`;
  }

  function getEditorsGridStyle(count) {
    if (count <= 1) return 'grid-template-columns: 1fr;';
    if (count === 2) return 'grid-template-columns: 1fr 1fr;';
    if (count === 3) return 'grid-template-columns: 1fr 1fr 1fr;';
    return 'grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr);';
  }

  function startLayoutResize(event, type) {
    event.preventDefault();
    layoutDrag = { type, startX: event.clientX, startY: event.clientY, ...layoutSize };
    window.addEventListener('pointermove', moveLayoutResize);
    window.addEventListener('pointerup', stopLayoutResize, { once: true });
  }

  function moveLayoutResize(event) {
    if (!layoutDrag) return;
    const dx = event.clientX - layoutDrag.startX;
    const dy = event.clientY - layoutDrag.startY;
    const workspaceWidth = workspaceEl?.clientWidth ?? window.innerWidth;
    if (layoutDrag.type === 'sidebar') {
      layoutSize = { ...layoutSize, sidebar: Math.max(180, Math.min(workspaceWidth - layoutSize.graph - 380, layoutDrag.sidebar + dx)) };
    } else if (layoutDrag.type === 'graph') {
      layoutSize = { ...layoutSize, graph: Math.max(280, Math.min(workspaceWidth - layoutSize.sidebar - 360, layoutDrag.graph - dx)) };
    } else {
      layoutSize = { ...layoutSize, terminal: Math.max(120, Math.min(window.innerHeight - 180, layoutDrag.terminal - dy)) };
    }
  }

  function stopLayoutResize() {
    layoutDrag = null;
    window.removeEventListener('pointermove', moveLayoutResize);
  }

  function flattenFiles(entry) {
    if (!entry) return [];
    const result = [];
    if (entry.type === 'file') result.push(entry);
    for (const child of entry.children || []) result.push(...flattenFiles(child));
    return result;
  }
</script>

<div class="app-shell theme-{theme}" class:graph-hidden={!graphVisible} class:terminal-open={terminalVisible && !terminalFloating} class:graph-fullscreen={graphFullscreen} class:graph-floating={graphFloating} style="--sidebar-width: {layoutSize.sidebar}px; --graph-width: {layoutSize.graph}px; --terminal-height: {layoutSize.terminal}px">
  <header class="topbar">
    <div class="brand">
      <img class="logo" src={logoUrl} alt="NiZyLa logo" />
      <div>
        <strong>NiZyLa</strong>
        <span>{projects.length} workspace{projects.length === 1 ? '' : 's'} · {plugins.length} plugin{plugins.length === 1 ? '' : 's'} · local code completion</span>
      </div>
    </div>
    <div class="actions">
      <button on:click={openProject}>Open Folder</button>
      <button on:click={refreshProject} disabled={!project}>Refresh</button>
      <button on:click={openPalette}>Command / Search</button>
      <select value={theme} on:change={(event) => setTheme(event.currentTarget.value)} aria-label="Theme">
        <option value="obsidian">Obsidian Dark</option>
        <option value="cream">Cream Light</option>
      </select>
      <button on:click={() => addPane(false)} title="Add a new editor window">+ Editor</button>
      <button on:click={() => addPane(true)} title="Add a floating editor window">+ Float Editor</button>
      <button on:click={toggleSplit} class:active={dockedPanes.length > 1}>Split {dockedPanes.length > 1 ? `(${dockedPanes.length})` : ''}</button>
      <button on:click={() => (terminalVisible = !terminalVisible)} class:active={terminalVisible}>Terminal{terminalVisible && terminalFloating ? ' (Float)' : ''}</button>
      <button on:click={toggleLineNumbers} class:active={!showLineNumbers}>Lines {showLineNumbers ? 'On' : 'Off'}</button>
      <button on:click={() => (vimMode = !vimMode)} class:active={vimMode}>Vim {vimMode ? 'On' : 'Off'}</button>
      {#if activeFile?.name?.toLowerCase().endsWith('.md')}
        <button on:click={() => (markdownPreview = !markdownPreview)} class:active={markdownPreview}>Markdown {markdownPreview ? 'Preview' : 'Edit'}</button>
      {/if}
      <button on:click={() => (graphVisible = !graphVisible)}>Graph {graphVisible ? (graphFloating ? '(Float)' : 'Hide') : 'Show'}</button>
      <button class="primary" on:click={saveFile} disabled={!activeTab || !activeTab.dirty}>Save</button>
    </div>
  </header>

  <main class="workspace" bind:this={workspaceEl}>
    <aside class="sidebar panel">
      <div class="panel-title">Workspaces</div>
      {#if projects.length}
        <div class="workspace-tabs">
          {#each projects as item, index}
            <div class="workspace-tab" class:active={index === activeProjectIndex}>
              <button class="workspace-select" on:click={() => (activeProjectIndex = index)}>{item.tree.name}</button>
              <button class="workspace-close" aria-label="Close workspace" on:click={() => closeWorkspace(index)}>×</button>
            </div>
          {/each}
        </div>
        <div class="panel-title small explorer-title">
          <span>Explorer</span>
        </div>
        <div class="explorer-tree" role="presentation" on:contextmenu={openExplorerContextMenu}>
          <FileTree entry={project.tree} {activeFile} on:select={(event) => selectFile(event.detail)} on:context={openContextMenu} on:move={moveEntry} />
        </div>
      {:else}
        <div class="empty">No folder open.</div>
      {/if}
    </aside>
    {#if !graphFullscreen}
      <div class="pane-resizer sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" on:pointerdown={(event) => startLayoutResize(event, 'sidebar')}></div>
    {/if}

    <section class="editors" style={getEditorsGridStyle(dockedPanes.length)}>
      {#if dockedPanes.length}
        {#each dockedPanes as pane (pane.id)}
          <div
            class="editor-area panel"
            class:focused={activePaneId === pane.id}
            on:click={() => (activePaneId = pane.id)}
            role="presentation"
          >
            <div class="tabbar">
              <div class="tabs-scroll">
                {#if pane.tabs.length}
                  {#each pane.tabs as tab (tab.id)}
                    <div class="tab tab-wrap" class:active={tab.id === pane.active}>
                      <button on:click|stopPropagation={() => activateTab(pane.id, tab.id)}>{tab.file.name}{tab.dirty ? ' •' : ''}</button>
                      <button class="tab-close" aria-label="Close tab" on:click|stopPropagation={() => closeTab(pane.id, tab.id)}>×</button>
                    </div>
                  {/each}
                {:else}
                  <div class="tab muted">No file selected</div>
                {/if}
              </div>
              <div class="editor-pane-controls">
                <button class="pane-btn" title="Add editor window" on:click|stopPropagation={() => addPane(false)}>+</button>
                <button class="pane-btn" title="Float this editor window" on:click|stopPropagation={() => togglePaneFloat(pane.id)}>Float</button>
                {#if panes.length > 1}
                  <button class="pane-btn pane-close" title="Close editor window" on:click|stopPropagation={() => closePane(pane.id)}>×</button>
                {/if}
              </div>
            </div>
            {#if getActiveTab(pane)?.file?.previewType === 'image'}
              <div class="image-preview">
                <img src={getActiveTab(pane).content} alt={getActiveTab(pane).file.relativePath} />
                <div>{getActiveTab(pane).file.relativePath}</div>
              </div>
            {:else if getActiveTab(pane)?.file?.previewType === 'pdf'}
              <iframe class="pdf-preview" src={getActiveTab(pane).content} title={`PDF preview: ${getActiveTab(pane).file.relativePath}`}></iframe>
            {:else if getActiveTab(pane)?.file?.name?.toLowerCase().endsWith('.md') && markdownPreview}
              <MarkdownPreview content={getActiveTab(pane).content} title={getActiveTab(pane).file.name.replace(/\.md$/i, '')} on:wiki={(event) => openWikiLink(event.detail)} />
            {:else}
              <CodeEditor file={getActiveTab(pane)?.file} content={getActiveTab(pane)?.content ?? ''} {vimMode} {showLineNumbers} on:change={(event) => updateTabContent(pane.id, event.detail)} />
            {/if}
          </div>
        {/each}
      {:else}
        <div class="empty-editors panel">
          <div class="empty-title">All editor windows are floating</div>
          <div class="empty-actions">
            <button on:click={() => addPane(false)}>+ Add Docked Editor</button>
            <button on:click={dockAllEditors}>Dock All Editors</button>
          </div>
        </div>
      {/if}
    </section>

    {#if graphVisible}
      {#if !graphFloating && !graphFullscreen}
        <div class="pane-resizer graph-resizer" role="separator" aria-label="Resize graph panel" aria-orientation="vertical" on:pointerdown={(event) => startLayoutResize(event, 'graph')}></div>
      {/if}
      <aside
        class="graph-panel panel"
        class:floating-window={graphFloating}
        class:graph-floating={graphFloating}
        class:focused={activeFloatingWindow === 'graph'}
        style={getGraphStyle(graphFloating, graphFloat, graphFullscreen)}
        on:pointerdown={() => graphFloating && focusFloatingWindow('graph')}
      >
        <div class="panel-title graph-title window-title" role="toolbar" tabindex="-1" aria-label="Project graph controls" on:pointerdown={(e) => graphFloating && startFloatingMove(e, 'graph')}>
          <span>Project Graph</span>
          <div class="window-actions">
            <button on:click={() => (graphFloating = !graphFloating)}>{graphFloating ? 'Dock' : 'Float'}</button>
            <button on:click={() => toggleMaximizeFloatingWindow('graph')}>
              {graphFloat.maximized || graphFullscreen ? 'Restore' : 'Full'}
            </button>
            <button aria-label="Close graph" on:click={() => (graphVisible = false)}>×</button>
          </div>
        </div>
        {#if project}
          <GraphView graph={project.graph} activePath={activeFile?.path} fullscreen={graphFullscreen || graphFloat.maximized} on:node={selectGraphNode} on:move={moveEntry} />
        {:else}
          <div class="empty">Graph appears after opening a project.</div>
        {/if}
        {#if graphFloating && !graphFloat.maximized}
          <button class="float-resize" aria-label="Resize graph" on:pointerdown={(event) => startFloatingResize(event, 'graph')}>Resize</button>
        {/if}
      </aside>
    {/if}
  </main>

  {#each floatingPanes as pane (pane.id)}
    <aside
      class="floating-window editor-floating panel"
      class:focused={activeFloatingWindow === `editor-${pane.id}`}
      style={getFloatingPaneStyle(pane)}
      role="region"
      aria-label={`Floating Editor ${pane.id}`}
      on:pointerdown={() => focusFloatingWindow('editor', pane.id)}
    >
      <div class="window-title" role="toolbar" tabindex="-1" aria-label={`Editor ${pane.id} controls`} on:pointerdown={(e) => startFloatingMove(e, 'editor', pane.id)}>
        <span class="window-title-text">Editor #{pane.id}{getActiveTab(pane) ? ` · ${getActiveTab(pane).file.name}` : ''}</span>
        <div class="window-actions">
          <button on:click={() => togglePaneFloat(pane.id)}>Dock</button>
          <button on:click={() => toggleMaximizeFloatingWindow('editor', pane.id)}>
            {pane.floatRect?.maximized ? 'Restore' : 'Full'}
          </button>
          <button title="Add another editor window" on:click={() => addPane(false)}>+</button>
          {#if panes.length > 1}
            <button class="tab-close" aria-label="Close editor window" on:click={() => closePane(pane.id)}>×</button>
          {/if}
        </div>
      </div>

      <div class="tabbar">
        <div class="tabs-scroll">
          {#if pane.tabs.length}
            {#each pane.tabs as tab (tab.id)}
              <div class="tab tab-wrap" class:active={tab.id === pane.active}>
                <button on:click|stopPropagation={() => activateTab(pane.id, tab.id)}>{tab.file.name}{tab.dirty ? ' •' : ''}</button>
                <button class="tab-close" aria-label="Close tab" on:click|stopPropagation={() => closeTab(pane.id, tab.id)}>×</button>
              </div>
            {/each}
          {:else}
            <div class="tab muted">No file selected</div>
          {/if}
        </div>
      </div>

      <div class="editor-body">
        {#if getActiveTab(pane)?.file?.previewType === 'image'}
          <div class="image-preview">
            <img src={getActiveTab(pane).content} alt={getActiveTab(pane).file.relativePath} />
            <div>{getActiveTab(pane).file.relativePath}</div>
          </div>
        {:else if getActiveTab(pane)?.file?.previewType === 'pdf'}
          <iframe class="pdf-preview" src={getActiveTab(pane).content} title={`PDF preview: ${getActiveTab(pane).file.relativePath}`}></iframe>
        {:else if getActiveTab(pane)?.file?.name?.toLowerCase().endsWith('.md') && markdownPreview}
          <MarkdownPreview content={getActiveTab(pane).content} title={getActiveTab(pane).file.name.replace(/\.md$/i, '')} on:wiki={(event) => openWikiLink(event.detail)} />
        {:else}
          <CodeEditor file={getActiveTab(pane)?.file} content={getActiveTab(pane)?.content ?? ''} {vimMode} {showLineNumbers} on:change={(event) => updateTabContent(pane.id, event.detail)} />
        {/if}
      </div>

      {#if !pane.floatRect?.maximized}
        <button class="float-resize" aria-label="Resize editor window" on:pointerdown={(e) => startFloatingResize(e, 'editor', pane.id)}>Resize</button>
      {/if}
    </aside>
  {/each}

  {#if terminalVisible}
    <section
      class="terminal-host"
      class:terminal-slot={!terminalFloating}
      class:floating-window={terminalFloating}
      class:terminal-floating={terminalFloating}
      class:focused={activeFloatingWindow === 'terminal'}
      style={getTerminalStyle(terminalFloating, terminalFloat)}
      aria-label="Integrated Terminal"
      on:pointerdown={() => terminalFloating && focusFloatingWindow('terminal')}
    >
      {#if !terminalFloating}
        <div class="terminal-resizer" role="separator" aria-label="Resize terminal" aria-orientation="horizontal" on:pointerdown={(event) => startLayoutResize(event, 'terminal')}></div>
        <div class="terminal-bar">
          <span class="terminal-bar-title">Terminal</span>
          <div class="terminal-bar-actions">
            <button on:click={() => (terminalFloating = true)}>Float</button>
            <button aria-label="Close terminal" on:click={() => (terminalVisible = false)}>×</button>
          </div>
        </div>
      {:else}
        <div class="window-title" role="toolbar" tabindex="-1" aria-label="Terminal controls" on:pointerdown={(e) => startFloatingMove(e, 'terminal')}>
          <span>Integrated Terminal</span>
          <div class="window-actions">
            <button on:click={() => (terminalFloating = false)}>Dock</button>
            <button on:click={() => toggleMaximizeFloatingWindow('terminal')}>
              {terminalFloat.maximized ? 'Restore' : 'Full'}
            </button>
            <button aria-label="Close terminal" on:click={() => (terminalVisible = false)}>×</button>
          </div>
        </div>
      {/if}
      <div class="terminal-shell-wrap">
        <TerminalPanel api={api} cwd={project?.rootPath ?? ''} />
      </div>
      {#if terminalFloating && !terminalFloat.maximized}
        <button class="float-resize" aria-label="Resize terminal" on:pointerdown={(e) => startFloatingResize(e, 'terminal')}>Resize</button>
      {/if}
    </section>
  {/if}

  <footer class="statusbar">{status} · Ctrl/⌘P search · Ctrl/⌘\\ split · Ctrl/⌘` terminal · Ctrl/⌘G graph · Ctrl/⌘S save</footer>

  {#if contextMenu}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px">
      <div class="context-title">{contextMenu.entry.name}</div>
      {#if contextMenu.entry.type === 'folder'}
        <button on:click={() => openCreateFromContext('file')}>New File</button>
        <button on:click={() => openCreateFromContext('note')}>New Note</button>
        <button on:click={() => openCreateFromContext('folder')}>New Folder</button>
      {/if}
      {#if contextMenu.entry.path !== project?.rootPath}
        <button class="danger" on:click={() => askDelete(contextMenu.entry)}>Delete {contextMenu.entry.type}</button>
      {/if}
    </div>
  {/if}

  {#if deleteTarget}
    <div class="modal-backdrop" role="presentation" on:click={() => (deleteTarget = null)}>
      <div class="modal" role="dialog" aria-label="Confirm delete">
        <h2>Delete {deleteTarget.type}?</h2>
        <p>This permanently removes <strong>{deleteTarget.relativePath}</strong>{deleteTarget.type === 'folder' ? ' and everything inside it' : ''}.</p>
        <div class="modal-actions">
          <button on:click={() => (deleteTarget = null)}>Cancel</button>
          <button class="danger" on:click={deleteSelectedPath}>Delete permanently</button>
        </div>
      </div>
    </div>
  {/if}

  {#if createDialog}
    <div class="modal-backdrop" role="presentation" on:click={closeCreateDialogFromBackdrop} on:keydown={(event) => event.key === 'Escape' && closeCreateDialog()}>
      <form class="modal" on:submit|preventDefault={submitCreateDialog}>
        <h2>Create {createDialog === 'note' ? 'note' : createDialog}</h2>
        <p>Path inside <strong>{createParent?.relativePath ?? project?.tree.name}</strong></p>
        <input bind:this={createInput} bind:value={createPath} placeholder={createDialog === 'folder' ? 'src/components' : createDialog === 'note' ? 'notes/my-note.md' : 'src/example.js'} />
        <div class="modal-actions">
          <button type="button" on:click={closeCreateDialog}>Cancel</button>
          <button class="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  {/if}

  {#if paletteOpen}
    <div class="palette-backdrop" role="presentation" on:click={closePalette} on:keydown={(event) => event.key === 'Escape' && closePalette()}>
      <div class="palette" role="dialog" tabindex="-1" aria-label="Command palette" on:click|stopPropagation on:keydown|stopPropagation>
        <input bind:this={paletteInput} bind:value={query} placeholder="Search files or type a command..." />
        <button on:click={() => (graphVisible = !graphVisible)}>Toggle graph</button>
        <button on:click={() => (graphFloating = !graphFloating)}>{graphFloating ? 'Dock graph' : 'Float graph'}</button>
        <button on:click={() => addPane(false)}>Add editor window</button>
        <button on:click={() => addPane(true)}>Add floating editor window</button>
        <button on:click={toggleSplit}>Toggle split editor</button>
        <button on:click={() => togglePaneFloat(activePaneId)}>Float / Dock current editor</button>
        <button on:click={() => (terminalVisible = !terminalVisible)}>Toggle terminal</button>
        <button on:click={() => (terminalFloating = !terminalFloating)}>{terminalFloating ? 'Dock terminal' : 'Float terminal'}</button>
        <button on:click={() => (vimMode = !vimMode)}>Toggle Vim mode</button>
        <button on:click={() => setTheme(theme === 'cream' ? 'obsidian' : 'cream')}>Toggle theme</button>
        {#each filteredFiles as file (file.path)}
          <button class="result" on:click={() => selectFile(file)}>{file.relativePath}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>
