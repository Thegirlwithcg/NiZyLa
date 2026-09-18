<script>
  import { onMount, tick } from 'svelte';
  import FileTree from './components/FileTree.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import GraphView from './components/GraphView.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';

  let projects = [];
  let activeProjectIndex = 0;
  let panes = [{ id: 0, tabs: [], active: null }, { id: 1, tabs: [], active: null }];
  let activePane = 0;
  let status = 'Open a project folder to begin.';
  let graphVisible = true;
  let terminalVisible = false;
  let splitMode = false;
  let vimMode = false;
  let paletteOpen = false;
  let query = '';
  let paletteInput;
  let plugins = [];
  let theme = localStorage.getItem('nizyla.theme') || 'cream';
  let graphFullscreen = false;
  let createDialog = null;
  let createPath = '';
  let createInput;
  let contextMenu = null;
  let deleteTarget = null;

  const api = globalThis.nizyla;
  $: project = projects[activeProjectIndex] ?? null;
  $: activeTab = panes[activePane]?.tabs.find((tab) => tab.id === panes[activePane]?.active) ?? null;
  $: activeFile = activeTab?.file ?? null;
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
      if (mod && event.key.toLowerCase() === '\\') { event.preventDefault(); splitMode = !splitMode; }
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

  async function selectFile(entry, paneIndex = activePane) {
    if (entry.type !== 'file' && entry.type !== 'symbol') return;
    const owningProject = projects.findIndex((p) => entry.path.startsWith(p.rootPath));
    if (owningProject >= 0) activeProjectIndex = owningProject;

    let content = '';
    try {
      content = await api.readFile(entry.path);
    } catch (error) {
      status = `Could not read ${entry.name}: ${error.message}`;
      return;
    }

    const file = { name: entry.name ?? entry.label, path: entry.path, relativePath: entry.relativePath?.split('#')[0] ?? entry.label, type: 'file' };
    const id = file.path;
    const pane = panes[paneIndex];
    const exists = pane.tabs.some((tab) => tab.id === id);
    panes = panes.map((p, index) => index === paneIndex ? {
      ...p,
      active: id,
      tabs: exists ? p.tabs.map((tab) => tab.id === id ? { ...tab, file, content } : tab) : [...p.tabs, { id, file, content, dirty: false }]
    } : p);
    activePane = paneIndex;
    paletteOpen = false;
    status = entry.type === 'symbol' ? `${entry.relativePath} line ${entry.line}` : file.relativePath;
  }

  async function selectGraphNode(event) {
    await selectFile(event.detail);
  }

  function updateTabContent(paneIndex, content) {
    const pane = panes[paneIndex];
    panes = panes.map((p, index) => index === paneIndex ? {
      ...p,
      tabs: p.tabs.map((tab) => tab.id === pane.active ? { ...tab, content, dirty: true } : tab)
    } : p);
  }

  function getActiveTab(pane) {
    return pane.tabs.find((item) => item.id === pane.active) ?? null;
  }

  function activateTab(paneIndex, tabId) {
    activePane = paneIndex;
    panes = panes.map((pane, index) => index === paneIndex ? { ...pane, active: tabId } : pane);
  }

  function closeTab(paneIndex, tabId) {
    const pane = panes[paneIndex];
    const nextTabs = pane.tabs.filter((tab) => tab.id !== tabId);
    const nextActive = pane.active === tabId ? nextTabs.at(-1)?.id ?? null : pane.active;
    panes = panes.map((p, index) => index === paneIndex ? { ...p, tabs: nextTabs, active: nextActive } : p);
  }

  async function saveFile() {
    const pane = panes[activePane];
    const tab = pane?.tabs.find((item) => item.id === pane.active);
    if (!tab || !api) return;
    await api.writeFile(tab.file.path, tab.content);
    panes = panes.map((p, index) => index === activePane ? { ...p, tabs: p.tabs.map((t) => t.id === tab.id ? { ...t, dirty: false } : t) } : p);
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

  function cleanRelativePath(value) {
    return value?.trim().replace(/^\/+/, '').replace(/\/+/g, '/') ?? '';
  }

  async function openCreateDialog(type) {
    if (!project) return;
    createDialog = type;
    createPath = type === 'file' ? 'src/new-file.js' : 'src/new-folder';
    await tick();
    createInput?.focus();
    createInput?.select();
  }

  function openContextMenu(event) {
    if (event.detail.entry.path === project?.rootPath) return;
    contextMenu = event.detail;
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
  }

  function closeCreateDialogFromBackdrop(event) {
    if (event.target === event.currentTarget) closeCreateDialog();
  }

  async function submitCreateDialog() {
    if (!project || !api || !createDialog) return;
    const name = cleanRelativePath(createPath);
    if (!name) return;
    try {
      if (createDialog === 'file') {
        const filePath = `${project.rootPath}/${name}`;
        await api.createFile(filePath);
        await refreshProject();
        await selectFile({ name: name.split('/').at(-1), path: filePath, relativePath: name, type: 'file' });
        status = `Created file ${name}`;
      } else {
        await api.createFolder(`${project.rootPath}/${name}`);
        await refreshProject();
        status = `Created folder ${name}`;
      }
      closeCreateDialog();
    } catch (error) {
      status = `Could not create ${createDialog}: ${error.message}`;
    }
  }

  function flattenFiles(entry) {
    if (!entry) return [];
    const result = [];
    if (entry.type === 'file') result.push(entry);
    for (const child of entry.children || []) result.push(...flattenFiles(child));
    return result;
  }
</script>

<div class="app-shell theme-{theme}" class:graph-hidden={!graphVisible} class:terminal-open={terminalVisible} class:graph-fullscreen={graphFullscreen}>
  <header class="topbar">
    <div class="brand">
      <div class="logo">N</div>
      <div>
        <strong>NiZyLa</strong>
        <span>{projects.length} workspace{projects.length === 1 ? '' : 's'} · {plugins.length} plugin{plugins.length === 1 ? '' : 's'} · LSP-ready core</span>
      </div>
    </div>
    <div class="actions">
      <button on:click={openProject}>Open Folder</button>
      <button on:click={refreshProject} disabled={!project}>Refresh</button>
      <button on:click={openPalette}>Command / Search</button>
      <select value={theme} on:change={(event) => setTheme(event.currentTarget.value)} aria-label="Theme">
        <option value="cream">Cream Light</option>
        <option value="obsidian">Obsidian Dark</option>
      </select>
      <button on:click={() => (splitMode = !splitMode)} class:active={splitMode}>Split</button>
      <button on:click={() => (terminalVisible = !terminalVisible)} class:active={terminalVisible}>Terminal</button>
      <button on:click={() => (vimMode = !vimMode)} class:active={vimMode}>Vim {vimMode ? 'On' : 'Off'}</button>
      <button on:click={() => (graphVisible = !graphVisible)}>Graph {graphVisible ? 'Hide' : 'Show'}</button>
      <button class="primary" on:click={saveFile} disabled={!activeTab || !activeTab.dirty}>Save</button>
    </div>
  </header>

  <main class="workspace">
    <aside class="sidebar panel">
      <div class="panel-title">Workspaces</div>
      {#if projects.length}
        <div class="workspace-tabs">
          {#each projects as item, index}
            <button class:active={index === activeProjectIndex} on:click={() => (activeProjectIndex = index)}>{item.tree.name}</button>
          {/each}
        </div>
        <div class="panel-title small explorer-title">
          <span>Explorer</span>
          <button on:click={() => openCreateDialog('file')} disabled={!project}>+ File</button>
          <button on:click={() => openCreateDialog('folder')} disabled={!project}>+ Folder</button>
        </div>
        <FileTree entry={project.tree} {activeFile} on:select={(event) => selectFile(event.detail)} on:context={openContextMenu} />
      {:else}
        <div class="empty">No folder open.</div>
      {/if}
    </aside>

    <section class="editors" class:split={splitMode}>
      {#each panes.slice(0, splitMode ? 2 : 1) as pane, paneIndex}
        <div class="editor-area panel" class:focused={activePane === paneIndex} on:click={() => (activePane = paneIndex)} role="presentation">
          <div class="tabbar">
            {#if pane.tabs.length}
              {#each pane.tabs as tab (tab.id)}
                <div class="tab tab-wrap" class:active={tab.id === pane.active}>
                  <button on:click|stopPropagation={() => activateTab(paneIndex, tab.id)}>{tab.file.relativePath}{tab.dirty ? ' •' : ''}</button>
                  <button class="tab-close" aria-label="Close tab" on:click|stopPropagation={() => closeTab(paneIndex, tab.id)}>×</button>
                </div>
              {/each}
            {:else}
              <div class="tab muted">No file selected</div>
            {/if}
          </div>
          <CodeEditor file={getActiveTab(pane)?.file} content={getActiveTab(pane)?.content ?? ''} {vimMode} on:change={(event) => updateTabContent(paneIndex, event.detail)} />
        </div>
      {/each}
    </section>

    {#if graphVisible}
      <aside class="graph-panel panel">
        <div class="panel-title graph-title">
          <span>Project Graph</span>
          <button on:click={() => (graphFullscreen = !graphFullscreen)}>{graphFullscreen ? 'Exit Full' : 'Full'}</button>
        </div>
        {#if project}
          <GraphView graph={project.graph} activePath={activeFile?.path} fullscreen={graphFullscreen} on:node={selectGraphNode} />
        {:else}
          <div class="empty">Graph appears after opening a project.</div>
        {/if}
      </aside>
    {/if}
  </main>

  {#if terminalVisible}
    <TerminalPanel api={api} cwd={project?.rootPath ?? ''} />
  {/if}

  <footer class="statusbar">{status} · Ctrl/⌘P search · Ctrl/⌘\\ split · Ctrl/⌘` terminal · Ctrl/⌘G graph · Ctrl/⌘S save</footer>

  {#if contextMenu}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px">
      <div class="context-title">{contextMenu.entry.name}</div>
      <button class="danger" on:click={() => askDelete(contextMenu.entry)}>Delete {contextMenu.entry.type}</button>
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
        <h2>Create {createDialog}</h2>
        <p>Path inside <strong>{project?.tree.name}</strong></p>
        <input bind:this={createInput} bind:value={createPath} placeholder={createDialog === 'file' ? 'src/example.js' : 'src/components'} />
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
        <button on:click={() => (splitMode = !splitMode)}>Toggle split editor</button>
        <button on:click={() => (terminalVisible = !terminalVisible)}>Toggle terminal</button>
        <button on:click={() => (vimMode = !vimMode)}>Toggle Vim mode</button>
        <button on:click={() => openCreateDialog('file')}>Create file</button>
        <button on:click={() => openCreateDialog('folder')}>Create folder</button>
        <button on:click={() => setTheme(theme === 'cream' ? 'obsidian' : 'cream')}>Toggle theme</button>
        {#each filteredFiles as file (file.path)}
          <button class="result" on:click={() => selectFile(file)}>{file.relativePath}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>
