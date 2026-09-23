<script>
  import { onMount, tick } from 'svelte';
  import FileTree from './components/FileTree.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import GraphView from './components/GraphView.svelte';
  import TerminalPanel from './components/TerminalPanel.svelte';
  import logoUrl from '../resource/Logo NiZyLa.svg';
  import MarkdownPreview from './components/MarkdownPreview.svelte';
  import PreferencesModal from './components/PreferencesModal.svelte';
  import GeometryWorkspace from './components/GeometryWorkspace.svelte';
  import { createGeometryDocument, parseGeometryDocument, serializeGeometryDocument, validateGeometryDocument } from './core/geometry.js';
  import { sameDocument } from './core/geometry-editor.js';
  import { loadPreferences, applyPreferences, savePreferences } from './core/preferences.js';

  const api = globalThis.nizyla;
  const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const detachedMode = urlParams?.get('detached') ?? null;
  const detachedWindowId = urlParams?.get('windowId') ?? null;
  const detachedCwdParam = urlParams?.get('cwd') ?? '';
  let detachedState = null;

  let projects = [];
  let activeProjectIndex = 0;

  let nextPaneId = 2;
  let panes = [
    {
      id: 1,
      tabs: [],
      active: null,
      floating: false,
      detached: false,
      floatRect: { x: 300, y: 90, width: 740, height: 540, maximized: false },
      zIndex: 10
    }
  ];
  let activePaneId = 1;

  let status = 'Open a project folder to begin.';
  let graphVisible = true;
  let graphAutoHidden = false;
  let graphFloating = false;
  let graphDetached = false;
  let graphFloat = { x: 320, y: 90, width: 760, height: 560, maximized: false, zIndex: 12 };
  let graphFullscreen = false;
  let graphFolderId = null;
  let graphViewMode = 'folder';

  let terminalVisible = false;
  let terminalFloating = false;
  let terminalDetached = false;
  let terminalFloat = { x: 260, y: 380, width: 800, height: 360, maximized: false, zIndex: 13 };

  let topZIndex = 20;
  let activeFloatingWindow = null;
  let floatingDrag = null;
  let dragNearEdge = false;

  let markdownPreview = false;
  let paletteOpen = false;
  let query = '';
  let paletteInput;
  let plugins = [];
  let preferences = loadPreferences();
  let theme = preferences.theme && preferences.theme !== 'cream' ? preferences.theme : 'obsidian';
  let showPreferences = false;
  let showLineNumbers = localStorage.getItem('nizyla.lineNumbers') !== 'false';
  let createDialog = null;
  let createPath = '';
  let createParent = null;
  let createInput;
  let createBusy = false;
  let resolveGeometrySave = null;
  let contextMenu = null;
  let tabMenu = null;
  let deleteTarget = null;
  let workspaceEl;
  let layoutDrag = null;
  let layoutSize = { sidebar: 270, graph: 390, terminal: 190 };
  let sidebarEl;
  let explorerFontSize = Number(localStorage.getItem('nizyla.explorerFontSize')) || 13;
  let sidebarView = 'files';
  let documentSearchQuery = '';
  let documentSearchKind = 'all';
  let documentSearchResults = [];
  let documentSearchBusy = false;
  let documentSearchTimer;
  let documentSearchIndex = [];
  let documentSearchToken = 0;
  let searchHighlightTerm = '';
  let searchScopeFolder = null;
  let searchMatchCase = typeof localStorage !== 'undefined' && localStorage.getItem('nizyla.searchMatchCase') === 'true';
  let searchWholeWord = typeof localStorage !== 'undefined' && localStorage.getItem('nizyla.searchWholeWord') === 'true';
  let searchUseRegex = typeof localStorage === 'undefined' || localStorage.getItem('nizyla.searchUseRegex') === null ? true : localStorage.getItem('nizyla.searchUseRegex') === 'true';
  let searchRegexError = '';
  let allCollapsed = false;

  let isSavingTabs = new Set();
  let savingGeometryTab = null;
  let geometryConfirmDialog = null;
  let isPythonRunning = false;
  let activeRunId = null;
  let terminalPanelRef = null;

  function isTabDirty(tab) {
    if (!tab) return false;
    if (tab.kind === 'geometry') {
      return !!tab.hasDrafts || tab.baseline === null || !sameDocument(tab.doc, tab.baseline);
    }
    return !!tab.dirty;
  }

  const isGeometryTab = (t) => t?.kind === 'geometry';
  const canExportTab = (t) => isGeometryTab(t) && !t.hasDrafts && validateGeometryDocument(t.doc).every((d) => d.severity !== 'error');
  const paneHasGeometry = (pane) => pane?.tabs?.some((t) => t.kind === 'geometry');

  $: canSave = isGeometryTab(activeTab)
    ? ((isTabDirty(activeTab) || !activeTab.file?.path) && !activeTab.hasDrafts && !isSavingTabs.has(activeTab.id) && !createDialog)
    : (!!activeTab?.dirty);

  function requestClose() {
    windowControl('close');
  }

  function promptUnsavedGeometry(tab, actionLabel = 'continuing') {
    if (!isTabDirty(tab)) return Promise.resolve('discard');
    const name = tab?.file?.name || 'Scratch Node';
    return new Promise((resolve) => {
      geometryConfirmDialog = {
        title: 'Unsaved Changes',
        message: `${name} has unsaved changes. Save before ${actionLabel}?`,
        hasDrafts: !!tab?.hasDrafts,
        resolve
      };
    });
  }

  function handleGeometryConfirmChoice(choice) {
    const dialog = geometryConfirmDialog;
    geometryConfirmDialog = null;
    dialog?.resolve(choice);
  }

  function handleNewScratchGeometry() {
    const targetPane = panes.find((p) => p.id === activePaneId && !p.detached) ?? panes.find((p) => !p.detached) ?? panes[0];
    if (!targetPane) return;
    const scratchId = `scratch:${crypto.randomUUID()}`;
    const doc = createGeometryDocument();
    const newTab = {
      id: scratchId,
      kind: 'geometry',
      file: { name: 'Scratch Graph', path: null, relativePath: 'Scratch Graph', type: 'file' },
      doc,
      baseline: doc,
      documentKey: crypto.randomUUID(),
      hasDrafts: false,
      dirty: false
    };
    panes = panes.map((p) => p.id === targetPane.id ? {
      ...p,
      active: scratchId,
      tabs: [...p.tabs, newTab]
    } : p);
    activePaneId = targetPane.id;
    status = 'Opened new Geometry Code scratch tab';
  }

  async function openGeometryFile(filePath, targetPaneId = activePaneId) {
    if (createBusy) return;
    const normalized = filePath.replace(/\\/g, '/');
    for (const p of panes) {
      const found = p.tabs.find((t) => t.file?.path && t.file.path.replace(/\\/g, '/') === normalized);
      if (found) {
        activateTab(p.id, found.id);
        activePaneId = p.id;
        if (p.floating) {
          topZIndex += 1;
          panes = panes.map((pane) => pane.id === p.id ? { ...pane, zIndex: topZIndex } : pane);
          activeFloatingWindow = `editor-${p.id}`;
        }
        status = `${found.file.name} is already open`;
        return;
      }
    }

    let content;
    try {
      content = await api.readFile(filePath);
    } catch (err) {
      status = `Could not read ${filePath.split(/[/\\]/).pop()}: ${err.message}`;
      return;
    }

    const { document: parsedDoc, diagnostics } = parseGeometryDocument(content);
    if (!parsedDoc) {
      const shapeMsg = diagnostics.map((d) => d.message).join('; ');
      status = `Cannot open ${filePath.split(/[/\\]/).pop()}: ${shapeMsg}`;
      return;
    }

    const fileName = filePath.split(/[/\\]/).pop();
    const relativePath = project?.rootPath && filePath.startsWith(project.rootPath)
      ? filePath.slice(project.rootPath.length).replace(/^[/\\]/, '')
      : fileName;
    const newTab = {
      id: filePath,
      kind: 'geometry',
      file: { name: fileName, path: filePath, relativePath, type: 'file' },
      doc: parsedDoc,
      baseline: parsedDoc,
      documentKey: crypto.randomUUID(),
      hasDrafts: false,
      dirty: false
    };

    const targetPane = panes.find((p) => p.id === targetPaneId && !p.detached) ?? panes.find((p) => !p.detached) ?? panes[0];
    if (!targetPane) return;
    panes = panes.map((p) => p.id === targetPane.id ? {
      ...p,
      active: filePath,
      tabs: [...p.tabs, newTab]
    } : p);
    activePaneId = targetPane.id;

    const errCount = diagnostics.filter((d) => d.severity === 'error').length;
    const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;
    if (errCount > 0) {
      status = `Opened ${fileName} with ${errCount} graph error(s) (Export disabled)`;
    } else if (warnCount > 0) {
      status = `Opened ${fileName} with ${warnCount} warning(s)`;
    } else {
      status = `Opened ${fileName}`;
    }
  }

  async function saveGeometry(tab = activeTab, saveAs = false) {
    if (!tab || tab.kind !== 'geometry') return false;
    if (isSavingTabs.has(tab.id)) return false;
    if (tab.hasDrafts) {
      status = 'Please fix draft errors before saving.';
      return false;
    }
    if (!tab.file?.path || saveAs) {
      if (!project) {
        status = 'Please open a project folder before saving Geometry Code.';
        return false;
      }
      if (createDialog) return false;
      savingGeometryTab = tab;
      return new Promise((resolve) => {
        resolveGeometrySave = resolve;
        openCreateDialog('geometry-save');
      });
    }

    isSavingTabs = new Set([...isSavingTabs, tab.id]);
    const snapshot = tab.doc;
    const filePath = tab.file.path;
    try {
      await api.saveGeometryFile(filePath, snapshot);
      panes = panes.map((p) => ({
        ...p,
        tabs: p.tabs.map((t) => t.id === tab.id ? {
          ...t,
          baseline: snapshot,
          dirty: t.hasDrafts || !sameDocument(t.doc, snapshot)
        } : t)
      }));
      const refreshError = await refreshFileProject(filePath);
      status = refreshError || `Saved ${tab.file.name} successfully.`;
      const current = panes.flatMap((p) => p.tabs).find((t) => t.id === tab.id);
      return current ? (!current.hasDrafts && sameDocument(current.doc, snapshot)) : false;
    } catch (err) {
      status = `Save failed: ${err.message}`;
      return false;
    } finally {
      const next = new Set(isSavingTabs);
      next.delete(tab.id);
      isSavingTabs = next;
    }
  }

  async function closeGeometryGraph() {
    if (activeTab?.kind === 'geometry') {
      await closeTab(activePaneId, activeTab.id);
    }
  }

  async function handleNewGeometryCode() {
    if (createBusy || createDialog) return;
    if (!project) {
      status = 'Please open a project folder before creating Geometry Code.';
      return;
    }
    openCreateDialog('geometry');
  }

  async function handleConvertSourceToGeometry(file) {
    if (!file || !file.path) return;
    const isPy = /\.py$/i.test(file.name);
    const isGd = /\.gd$/i.test(file.name);
    if (!isPy && !isGd) return;

    let source = '';
    const openTab = panes.flatMap((p) => p.tabs).find((t) => t.file?.path === file.path);
    if (openTab) {
      source = openTab.content;
    } else {
      source = await api.readFile(file.path);
    }

    status = `Converting ${file.name} to Geometry Code...`;
    try {
      let res;
      if (isPy) {
        res = await api.convertPython({
          source,
          sourceFile: file.path,
          preferredInterpreter: preferences?.pythonInterpreter,
          projectRoot: project?.rootPath
        });
      } else {
        res = await api.convertGdscript({
          source,
          sourceFile: file.path
        });
      }

      if (!res || !res.ok || !res.document) {
        status = `Conversion failed: ${res?.error || 'Unknown error'}`;
        return;
      }

      const targetPath = file.path.replace(/\.(py|gd)$/i, '.gcn');
      const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();

      // Find a tab with the same normalized target path in ANY pane
      let targetPane = null;
      let existingTab = null;
      let existingIndex = -1;

      for (const p of panes) {
        const idx = p.tabs.findIndex((t) => t.file?.path && t.file.path.replace(/\\/g, '/').toLowerCase() === normTarget);
        if (idx !== -1) {
          targetPane = p;
          existingTab = p.tabs[idx];
          existingIndex = idx;
          break;
        }
      }

      if (existingTab) {
        if (isTabDirty(existingTab)) {
          const decision = await promptUnsavedGeometry(existingTab, 'replacing it with the conversion result');
          if (decision === 'cancel') return;
          if (decision === 'save') {
            const ok = await saveGeometry(existingTab);
            if (!ok) return;
          }
        }

        const fileName = targetPath.split(/[/\\]/).pop();
        const relativePath = file.relativePath.replace(/\.(py|gd)$/i, '.gcn');
        const updatedTab = {
          ...existingTab,
          file: { name: fileName, path: targetPath, relativePath, type: 'file' },
          doc: res.document,
          baseline: null,
          documentKey: crypto.randomUUID(),
          hasDrafts: false,
          dirty: true
        };

        panes = panes.map((p) => {
          if (p.id !== targetPane.id) return p;
          const nextTabs = [...p.tabs];
          const curIdx = nextTabs.findIndex((t) => t.id === existingTab.id);
          const replaceIdx = curIdx !== -1 ? curIdx : existingIndex;
          nextTabs[replaceIdx] = updatedTab;
          return {
            ...p,
            active: updatedTab.id,
            tabs: nextTabs
          };
        });
        activePaneId = targetPane.id;
        if (targetPane.floating) {
          topZIndex += 1;
          panes = panes.map((p) => p.id === targetPane.id ? { ...p, zIndex: topZIndex } : p);
          activeFloatingWindow = `editor-${targetPane.id}`;
        }
        status = `Converted ${file.name} successfully! Replaced unsaved .gcn`;
      } else {
        const fileName = targetPath.split(/[/\\]/).pop();
        const relativePath = file.relativePath.replace(/\.(py|gd)$/i, '.gcn');
        const newTab = {
          id: targetPath,
          kind: 'geometry',
          file: { name: fileName, path: targetPath, relativePath, type: 'file' },
          doc: res.document,
          baseline: null,
          documentKey: crypto.randomUUID(),
          hasDrafts: false,
          dirty: true
        };
        const targetPane = panes.find((p) => p.id === activePaneId && !p.detached) ?? panes[0];
        panes = panes.map((p) => p.id === targetPane.id ? {
          ...p,
          active: targetPath,
          tabs: [...p.tabs.filter((t) => t.id !== targetPath), newTab]
        } : p);
        activePaneId = targetPane.id;
        status = `Converted ${file.name} successfully! Opened as unsaved .gcn`;
      }
    } catch (err) {
      status = `Conversion error: ${err.message}`;
    }
  }

  async function handleRunPython(tab = activeTab) {
    if (isPythonRunning || !tab || tab.kind !== 'geometry') return;
    if (tab.doc.target !== 'python') {
      status = 'NiZyLa only supports running Python in this version.';
      return;
    }

    if (tab.hasDrafts) {
      status = 'Please fix draft errors before running.';
      return;
    }

    const diags = validateGeometryDocument(tab.doc);
    const errors = diags.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      status = `Geometry Code has errors (${errors.length}) and cannot be run.`;
      return;
    }

    status = 'Preparing terminal for Python run...';
    terminalVisible = true;
    await tick();
    await terminalPanelRef?.openRunTab('pending');
    status = 'Starting Python run...';
    try {
      const res = await api.runPython({
        document: tab.doc,
        filePath: tab.file?.path ?? null,
        projectRoot: project?.rootPath,
        sourceFile: tab.doc.sourceFile,
        preferredInterpreter: preferences?.pythonInterpreter
      });

      if (!res || !res.ok) {
        status = `Run failed: ${res?.error || 'Unknown error'}`;
        if (res?.noInterpreter) {
          showPreferences = true;
        }
        return;
      }

      isPythonRunning = true;
      activeRunId = res.runId;
      await terminalPanelRef?.openRunTab(res.runId);
      status = 'Running program...';
    } catch (err) {
      status = `Run failed: ${err.message}`;
    }
  }

  async function handleStopPython() {
    if (!isPythonRunning || !activeRunId) return;
    try {
      await api.stopPython(activeRunId);
      isPythonRunning = false;
      activeRunId = null;
      status = 'Program stopped.';
    } catch (err) {
      status = `Failed to stop program: ${err.message}`;
    }
  }

  async function handleExportGeometry(tab = activeTab) {
    if (!tab || tab.kind !== 'geometry') return;
    if (tab.hasDrafts) {
      status = 'Please fix draft errors before export.';
      return;
    }
    const diagnostics = validateGeometryDocument(tab.doc);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      status = `Geometry Code has errors (${errors.length}) and cannot be exported.`;
      return;
    }
    try {
      const defaultName = tab.file?.path ? tab.file.path.split(/[/\\]/).pop().replace(/\.gcn$/i, '') : 'main';
      const res = await api.exportGeometryFile({
        defaultFileName: defaultName,
        defaultDirectory: activeExplorerFolder?.path,
        target: tab.doc.target,
        document: tab.doc
      });
      if (res.canceled) {
        status = 'Export cancelled.';
      } else {
        const refreshError = await refreshFileProject(res.filePath);
        status = refreshError || `Export succeeded: ${res.filePath}`;
      }
    } catch (err) {
      status = `Export failed: ${err.message}`;
    }
  }

  function handleGeometryChange(paneId, tabId, nextDoc) {
    panes = panes.map((p) => p.id === paneId ? {
      ...p,
      tabs: p.tabs.map((t) => t.id === tabId ? {
        ...t,
        doc: nextDoc,
        dirty: t.hasDrafts || t.baseline === null || !sameDocument(nextDoc, t.baseline)
      } : t)
    } : p);
  }

  function handleGeometryDraftChange(paneId, tabId, hasDrafts) {
    panes = panes.map((p) => p.id === paneId ? {
      ...p,
      tabs: p.tabs.map((t) => t.id === tabId ? {
        ...t,
        hasDrafts,
        dirty: hasDrafts || t.baseline === null || !sameDocument(t.doc, t.baseline)
      } : t)
    } : p);
  }

  async function handleSave() {
    if (activeTab?.kind === 'geometry') {
      await saveGeometry(activeTab);
    } else {
      await saveFile();
    }
  }

  $: totalMatchCount = documentSearchResults.reduce((sum, g) => sum + (g.matches?.length || 0), 0);
  $: totalFileCount = documentSearchResults.length;

  function handleExplorerWheel(event) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY < 0 ? 1 : -1;
      explorerFontSize = Math.max(10, Math.min(26, explorerFontSize + delta));
      localStorage.setItem('nizyla.explorerFontSize', String(explorerFontSize));
      document.documentElement.style.setProperty('--explorer-font-size', `${explorerFontSize}px`);
      status = `Explorer Font Size: ${explorerFontSize}px (Ctrl+Scroll to adjust)`;
    }
  }

  function handleEditorZoom(event) {
    const delta = event.detail;
    const current = preferences.fontSize || 14;
    const next = Math.max(10, Math.min(36, current + delta));
    if (next !== current) {
      preferences.fontSize = next;
      savePreferences(preferences);
      status = `Editor Font Size: ${next}px (Ctrl+Scroll to adjust)`;
    }
  }

  let actionsEl;
  let isMiddleDragging = false;
  let middleStartX = 0;
  let middleStartScrollLeft = 0;

  $: project = projects[activeProjectIndex] ?? null;
  $: activeExplorerFolder = findFolder(project?.tree, graphFolderId) ?? project?.tree ?? null;
  $: currentPane = panes.find((p) => p.id === activePaneId) ?? panes[0] ?? null;
  $: activeTab = currentPane?.tabs.find((tab) => tab.id === currentPane?.active) ?? null;
  $: activeFile = activeTab?.file ?? null;
  $: dockedPanes = panes.filter((p) => !p.floating && !p.detached);
  $: floatingPanes = panes.filter((p) => p.floating && !p.detached);
  $: files = projects.flatMap((p) => flattenFiles(p.tree).map((f) => ({ ...f, projectRoot: p.rootPath })));
  $: filteredFiles = query ? files.filter((file) => file.relativePath.toLowerCase().includes(query.toLowerCase())).slice(0, 40) : files.slice(0, 40);
  $: searchScopeLabel = searchScopeFolder ? (searchScopeFolder.relativePath || searchScopeFolder.name) : 'Entire workspace';

  onMount(async () => {
    applyPreferences(preferences);
    document.documentElement.style.setProperty('--explorer-font-size', `${explorerFontSize}px`);
    sidebarEl?.addEventListener('wheel', handleExplorerWheel, { passive: false });
    if (detachedMode && api?.getDetachedState) {
      detachedState = await api.getDetachedState(detachedWindowId);
      if (detachedState) {
        if (detachedState.theme) theme = detachedState.theme;
        if (detachedState.showLineNumbers !== undefined) showLineNumbers = detachedState.showLineNumbers;
        if (detachedState.currentFolderId !== undefined) graphFolderId = detachedState.currentFolderId;
        if (detachedState.viewMode !== undefined) graphViewMode = detachedState.viewMode;
        if (detachedState.pane) {
          panes = [{ ...detachedState.pane, floating: false, detached: false }];
          activePaneId = detachedState.pane.id;
        }
        if (detachedState.project) {
          projects = [detachedState.project];
          activeProjectIndex = 0;
        }
      }
      rebuildDocumentSearchIndex();
    }

    const unlistenDock = api?.onDetachedDockBack?.((data) => handleDetachedDockBack(data));
    const unlistenClosed = api?.onDetachedClosed?.((data) => handleDetachedClosed(data));
    const unlistenOpenFile = api?.onMainOpenFile?.((file) => selectFile(file));
    const unlistenSyncFolder = api?.onMainSyncFolder?.((folderPath) => { graphFolderId = folderPath; });
    const unlistenRunExit = api?.onRunExit?.(({ runId, exitCode }) => {
      if (activeRunId === runId) {
        isPythonRunning = false;
        activeRunId = null;
        status = `Program finished (exit code ${exitCode})`;
      }
    });

    const closeContextMenuOnOutsideClick = (event) => {
      if (contextMenu && !event.target.closest('.context-menu')) contextMenu = null;
      if (tabMenu && !event.target.closest('.context-menu')) tabMenu = null;
    };
    const keydown = async (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); openPalette(); query = ''; }
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); await handleSave(); }
      if (mod && event.key.toLowerCase() === 'g') { event.preventDefault(); toggleGraph(); }
      if (mod && event.key.toLowerCase() === '\\') { event.preventDefault(); toggleSplit(); }
      if (mod && event.key === '`') { event.preventDefault(); toggleTerminal(); }
      if (mod && (event.key === ',' || event.key === '<')) { event.preventDefault(); showPreferences = !showPreferences; }
      if (event.key === 'Escape') { paletteOpen = false; showPreferences = false; contextMenu = null; tabMenu = null; }
    };
    const beforeUnload = (event) => {
      const dirtyTabs = [];
      const seenKeys = new Set();
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.kind === 'geometry' && isTabDirty(tab) && !seenKeys.has(tab.documentKey)) {
            seenKeys.add(tab.documentKey);
            dirtyTabs.push({
              filePath: tab.file?.path ?? null,
              document: tab.doc,
              hasDrafts: !!tab.hasDrafts
            });
          }
        }
      }
      if (dirtyTabs.length === 0) return;
      api?.syncGeometryUnloadState?.({ documents: dirtyTabs });
      event.preventDefault();
      event.returnValue = '';
    };
    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('keydown', keydown);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pointerdown', closeContextMenuOnOutsideClick);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pointerdown', closeContextMenuOnOutsideClick);
      sidebarEl?.removeEventListener('wheel', handleExplorerWheel);
      unlistenDock?.();
      unlistenClosed?.();
      unlistenOpenFile?.();
      unlistenSyncFolder?.();
      unlistenRunExit?.();
    };
  });

  function onActionsMouseDown(event) {
    if (event.button === 1) {
      event.preventDefault();
      isMiddleDragging = true;
      middleStartX = event.clientX;
      middleStartScrollLeft = actionsEl?.scrollLeft ?? 0;
      window.addEventListener('pointermove', onActionsMiddleMouseMove);
      window.addEventListener('pointerup', onActionsMiddleMouseUp, { once: true });
    }
  }

  function onActionsMiddleMouseMove(event) {
    if (!isMiddleDragging || !actionsEl) return;
    event.preventDefault();
    const dx = event.clientX - middleStartX;
    actionsEl.scrollLeft = middleStartScrollLeft - dx;
  }

  function onActionsMiddleMouseUp(event) {
    if (isMiddleDragging) {
      isMiddleDragging = false;
      window.removeEventListener('pointermove', onActionsMiddleMouseMove);
    }
  }

  function onActionsWheel(event) {
    if (!actionsEl) return;
    const delta = event.deltaY || event.deltaX;
    if (delta) {
      event.preventDefault();
      actionsEl.scrollLeft += delta;
    }
  }

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
    rebuildDocumentSearchIndex();
  }

  async function refreshProject(rootPath = project?.rootPath) {
    if (!rootPath || !api) return;
    const rescanned = await api.scanProject(rootPath);
    projects = projects.map((p) => p.rootPath === rootPath ? rescanned : p);
    status = `Rescanned ${rescanned.rootPath}`;
    await refreshPlugins();
    rebuildDocumentSearchIndex();
  }

  async function refreshFileProject(filePath) {
    const owners = projects.filter((p) => isSameOrDescendant(filePath, p.rootPath));
    try {
      await Promise.all(owners.map((p) => refreshProject(p.rootPath)));
    } catch (error) {
      // The write already succeeded; do not report it as a failed save.
      return `File written successfully, but Refresh Explorer failed: ${error.message}`;
    }
  }

  function findFolder(entry, folderPath) {
    if (entry?.type !== 'folder' || !folderPath) return null;
    if (normalizeSearchPath(entry.path) === normalizeSearchPath(folderPath)) return entry;
    for (const child of entry.children ?? []) {
      const found = findFolder(child, folderPath);
      if (found) return found;
    }
    return null;
  }

  async function refreshPlugins() {
    if (!api) return;
    plugins = await api.listPlugins(projects.map((p) => p.rootPath));
  }

  function windowControl(action) {
    api?.windowControl?.(action);
  }

  function normalizeSearchPath(value = '') {
    return String(value).replace(/\\/g, '/').toLowerCase();
  }

  function activateExplorerFolder(folder) {
    if (folder?.type === 'folder') graphFolderId = folder.path;
  }

  function setSearchScopeFolder(folder) {
    searchScopeFolder = folder?.type === 'folder' ? folder : null;
    if (searchScopeFolder) graphFolderId = searchScopeFolder.path;
    sidebarView = 'search';
    runDocumentSearch();
  }

  function clearSearchScope() {
    searchScopeFolder = null;
    runDocumentSearch();
  }

  function scheduleDocumentSearch(nextQuery = documentSearchQuery, nextKind = documentSearchKind) {
    clearTimeout(documentSearchTimer);
    if (!nextQuery.trim()) {
      documentSearchResults = [];
      documentSearchBusy = false;
      return;
    }
    documentSearchBusy = true;
    documentSearchTimer = setTimeout(() => runDocumentSearch(nextQuery, nextKind), 35);
  }

  function updateDocumentSearchQuery(value) {
    documentSearchQuery = value;
    scheduleDocumentSearch(value, documentSearchKind);
  }

  function updateDocumentSearchKind(value) {
    documentSearchKind = value;
    scheduleDocumentSearch(documentSearchQuery, value);
  }

  function toggleMatchCase() {
    searchMatchCase = !searchMatchCase;
    if (typeof localStorage !== 'undefined') localStorage.setItem('nizyla.searchMatchCase', String(searchMatchCase));
    runDocumentSearch();
  }

  function toggleWholeWord() {
    searchWholeWord = !searchWholeWord;
    if (typeof localStorage !== 'undefined') localStorage.setItem('nizyla.searchWholeWord', String(searchWholeWord));
    runDocumentSearch();
  }

  function toggleUseRegex() {
    searchUseRegex = !searchUseRegex;
    if (typeof localStorage !== 'undefined') localStorage.setItem('nizyla.searchUseRegex', String(searchUseRegex));
    runDocumentSearch();
  }

  function toggleCollapseAll() {
    allCollapsed = !allCollapsed;
    documentSearchResults = documentSearchResults.map((g) => ({ ...g, collapsed: allCollapsed }));
  }

  function toggleFileCollapse(index) {
    if (documentSearchResults[index]) {
      documentSearchResults[index].collapsed = !documentSearchResults[index].collapsed;
      documentSearchResults = [...documentSearchResults];
    }
  }

  function selectSearchResult(fileEntry, match) {
    selectFile({
      ...fileEntry,
      line: match.line,
      searchTerm: match.searchTerm || documentSearchQuery.trim()
    });
  }

  function getSearchMatcher(rawQuery, matchCase, wholeWord, useRegex) {
    searchRegexError = '';
    if (!rawQuery) return null;
    let pattern = rawQuery;
    if (!useRegex) {
      pattern = escapeRegExp(pattern);
    }
    if (wholeWord) {
      pattern = `\\b(?:${pattern})\\b`;
    }
    const flags = matchCase ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch (err) {
      searchRegexError = err.message || 'Invalid regular expression';
      return null;
    }
  }

  function splitMatchPreview(text, term, matchCase, wholeWord, useRegex) {
    if (!text || !term) return [{ text, match: false }];
    const matcher = getSearchMatcher(term, matchCase, wholeWord, useRegex);
    if (!matcher) return [{ text, match: false }];
    const parts = [];
    let lastIndex = 0;
    let match;
    try {
      while ((match = matcher.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ text: text.slice(lastIndex, match.index), match: false });
        }
        parts.push({ text: match[0], match: true });
        lastIndex = matcher.lastIndex;
        if (!matcher.global || match[0].length === 0) {
          lastIndex = match.index + 1;
          matcher.lastIndex = lastIndex;
        }
        if (parts.length >= 25) break;
      }
    } catch {
      // ignore regex exec errors
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), match: false });
    }
    return parts.length ? parts : [{ text, match: false }];
  }

  function runDocumentSearch(nextQuery = documentSearchQuery, nextKind = documentSearchKind) {
    const rawTerm = nextQuery.trim();
    const token = ++documentSearchToken;
    if (!rawTerm) {
      documentSearchResults = [];
      documentSearchBusy = false;
      searchRegexError = '';
      return;
    }

    const matcher = getSearchMatcher(rawTerm, searchMatchCase, searchWholeWord, searchUseRegex);
    if (!matcher) {
      documentSearchResults = [];
      documentSearchBusy = false;
      return;
    }

    documentSearchBusy = true;
    const scopePath = normalizeSearchPath(searchScopeFolder?.path || '');
    const showAllSymbolsInKind = rawTerm === '/' && ['variable', 'class', 'function'].includes(nextKind);
    const fileGroups = new Map();

    for (const item of documentSearchIndex) {
      const entryPath = normalizeSearchPath(item.entry?.path || '');
      if (scopePath && !entryPath.startsWith(scopePath + '/') && entryPath !== scopePath) continue;

      if (item.matchType === 'text') {
        if (nextKind !== 'all' && nextKind !== 'text') continue;
        const fileMatches = [];
        for (let lineIdx = 0; lineIdx < item.lines.length; lineIdx++) {
          const lineText = item.lines[lineIdx];
          matcher.lastIndex = 0;
          let match;
          while ((match = matcher.exec(lineText)) !== null) {
            fileMatches.push({
              line: lineIdx + 1,
              preview: lineText.trim() || '(empty line)',
              searchTerm: match[0] || rawTerm,
              matchType: 'text'
            });
            break; // Keep one entry per matching line
          }
          if (fileMatches.length >= 150) break;
        }
        if (fileMatches.length > 0) {
          const existing = fileGroups.get(item.entry.path);
          if (existing) {
            existing.matches.push(...fileMatches);
          } else {
            fileGroups.set(item.entry.path, {
              file: item.entry,
              collapsed: allCollapsed,
              matches: fileMatches
            });
          }
        }
      } else {
        if (nextKind !== 'all' && item.matchType !== nextKind) continue;
        matcher.lastIndex = 0;
        const isMatch = showAllSymbolsInKind || matcher.test(item.entry.label) || matcher.test(item.entry.relativePath);
        if (isMatch) {
          let group = fileGroups.get(item.entry.path);
          if (!group) {
            const fileEntry = files.find((f) => f.path === item.entry.path) || {
              name: fileNameFromPath(item.entry.path),
              path: item.entry.path,
              relativePath: item.entry.relativePath?.split('#')[0] || fileNameFromPath(item.entry.path),
              type: 'file',
              previewType: previewTypeFor(item.entry.path)
            };
            group = { file: fileEntry, collapsed: allCollapsed, matches: [] };
            fileGroups.set(item.entry.path, group);
          }
          group.matches.push({
            line: item.entry.line ?? 1,
            preview: `${item.matchType} · ${item.entry.label}`,
            searchTerm: item.entry.label,
            matchType: item.matchType,
            label: item.entry.label
          });
        }
      }
    }

    if (token === documentSearchToken) {
      documentSearchResults = Array.from(fileGroups.values());
      documentSearchBusy = false;
    }
  }

  async function refreshDocumentSearch() {
    documentSearchBusy = true;
    await rebuildDocumentSearchIndex();
    runDocumentSearch();
    status = `Search refreshed${documentSearchQuery.trim() ? `: ${documentSearchQuery.trim()}` : ''}`;
  }

  async function rebuildDocumentSearchIndex() {
    await tick();
    if (!api || !projects.length) {
      documentSearchIndex = [];
      documentSearchResults = [];
      return;
    }

    documentSearchBusy = Boolean(documentSearchQuery.trim());
    const index = [];

    for (const item of projects) {
      for (const node of item.graph?.nodes || []) {
        if (node.type !== 'symbol') continue;
        index.push({
          matchType: node.kind,
          entry: node,
          searchText: `${node.label} ${node.relativePath}`.toLowerCase()
        });
      }
    }

    for (const file of files) {
      if (previewTypeFor(file.path) !== 'text') continue;
      try {
        const content = await api.readFile(file.path);
        index.push({
          matchType: 'text',
          entry: file,
          content,
          lines: content.split(/\r?\n/),
          searchText: `${file.relativePath}\n${content}`.toLowerCase()
        });
      } catch {
        // Ignore unreadable files while indexing.
      }
    }

    documentSearchIndex = index;
    runDocumentSearch();
  }

  function fileNameFromPath(filePath = '') {
    return String(filePath).replace(/\\/g, '/').split('/').pop() || filePath;
  }

  function previewTypeFor(filePath = '') {
    const cleanPath = filePath.split('?')[0].split('#')[0].toLowerCase();
    const ext = cleanPath.includes('.') ? cleanPath.slice(cleanPath.lastIndexOf('.')) : '';
    if (imageExtensions.has(ext)) return 'image';
    if (ext === '.pdf') return 'pdf';
    return 'text';
  }

  async function closeWorkspace(index) {
    if (createBusy) return;
    const closing = projects[index];
    if (!closing) return;
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        if (tab.kind === 'geometry' && tab.file?.path && isSameOrDescendant(tab.file.path, closing.rootPath) && isTabDirty(tab)) {
          const decision = await promptUnsavedGeometry(tab, 'closing the project');
          if (decision === 'cancel') return;
          if (decision === 'save') {
            const ok = await saveGeometry(tab);
            if (!ok) return;
          }
        }
      }
    }
    projects = projects.filter((_, itemIndex) => itemIndex !== index);
    panes = panes.map((pane) => {
      const tabs = pane.tabs.filter((tab) => !tab.file?.path || !isSameOrDescendant(tab.file.path, closing.rootPath));
      return { ...pane, tabs, active: tabs.some((tab) => tab.id === pane.active) ? pane.active : tabs.at(-1)?.id ?? null };
    });
    const remainingCount = projects.length;
    activeProjectIndex = remainingCount ? Math.max(0, Math.min(activeProjectIndex >= index ? activeProjectIndex - 1 : activeProjectIndex, remainingCount - 1)) : 0;
    status = `Closed ${closing.rootPath}`;
    refreshPlugins();
    rebuildDocumentSearchIndex();
  }

  async function selectFile(entry, targetPaneId = activePaneId) {
    if (entry.type !== 'file' && entry.type !== 'symbol') return;
    if (entry.path?.toLowerCase().endsWith('.gcn')) {
      await openGeometryFile(entry.path);
      return;
    }
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

    const relativePath = entry.relativePath?.split('#')[0] ?? fileNameFromPath(entry.path);
    const fileName = entry.type === 'symbol' ? fileNameFromPath(relativePath) : (entry.name ?? fileNameFromPath(entry.path));
    const file = { name: fileName, path: entry.path, relativePath, type: 'file', previewType, searchLine: entry.line ?? null };
    markdownPreview = file.name.toLowerCase().endsWith('.md') && !entry.matchType;
    const id = file.path;

    const targetPane = panes.find((p) => p.id === targetPaneId && !p.detached) ?? panes.find((p) => !p.detached) ?? panes[0];
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
    searchHighlightTerm = entry.searchTerm || (entry.matchType && entry.matchType !== 'text' ? (entry.label ?? '') : '');
    status = entry.type === 'symbol' ? `${entry.relativePath} line ${entry.line}` : file.relativePath;
  }

  async function selectGraphNode(event) {
    await selectFile(event.detail);
  }

  function isSameOrDescendant(filePath, parentPath) {
    const file = normalizeSearchPath(filePath);
    const parent = normalizeSearchPath(parentPath).replace(/\/$/, '');
    return file === parent || file.startsWith(`${parent}/`);
  }

  async function moveEntry(event) {
    const { source, target } = event.detail;
    if (!api?.movePath || (source.type !== 'file' && source.type !== 'folder')) return;
    try {
      const result = await api.movePath(source.path, target.path);
      if (graphFolderId && isSameOrDescendant(graphFolderId, source.path)) {
        graphFolderId = `${result.path}${graphFolderId.slice(source.path.length)}`;
      }
      const targetRelativePath = target.path === project?.rootPath ? '' : target.relativePath;
      panes = panes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) => {
          if (!tab.file?.path || !isSameOrDescendant(tab.file.path, source.path)) return tab;
          const suffix = tab.file.path.slice(source.path.length);
          const relativeSuffix = (tab.file.relativePath || tab.file.name).slice(source.relativePath.length).replace(/^[/\\]/, '');
          const relativePath = [targetRelativePath, source.name, relativeSuffix].filter(Boolean).join('/');
          const nextPath = `${result.path}${suffix}`;
          return {
            ...tab,
            id: nextPath,
            file: { ...tab.file, path: nextPath, relativePath }
          };
        }),
        active: (pane.active && isSameOrDescendant(pane.active, source.path)) ? `${result.path}${pane.active.slice(source.path.length)}` : pane.active
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

  async function closeTab(paneId, tabId) {
    const pane = panes.find((p) => p.id === paneId);
    const tab = pane?.tabs.find((t) => t.id === tabId);
    if (tab && tab.kind === 'geometry' && isTabDirty(tab)) {
      const decision = await promptUnsavedGeometry(tab, 'closing this tab');
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const ok = await saveGeometry(tab);
        if (!ok) return;
      }
    }
    panes = panes.map((p) => {
      if (p.id !== paneId) return p;
      const nextTabs = p.tabs.filter((t) => t.id !== tabId);
      const nextActive = p.active === tabId ? nextTabs.at(-1)?.id ?? null : p.active;
      return { ...p, tabs: nextTabs, active: nextActive };
    });
  }

  function openTabMenu(paneId, tabId, event) {
    tabMenu = {
      paneId,
      tabId,
      x: event.clientX,
      y: event.clientY
    };
  }

  function floatTab(paneId, tabId) {
    const sourcePane = panes.find((p) => p.id === paneId);
    const tab = sourcePane?.tabs.find((t) => t.id === tabId);
    if (!sourcePane || !tab) return;

    console.log('[floatTab] Panes before:', JSON.stringify(panes.map(p => ({ id: p.id, floating: p.floating, tabs: p.tabs.map(t => t.id), active: p.active }))));

    panes = panes.map((p) => {
      if (p.id !== paneId) return p;
      const nextTabs = p.tabs.filter((t) => t.id !== tabId);
      const nextActive = p.active === tabId ? nextTabs.at(-1)?.id ?? null : p.active;
      return { ...p, tabs: nextTabs, active: nextActive };
    });

    const newPane = addPane(true, [tab]);
    newPane.active = tab.id;
    activePaneId = newPane.id;
    activeFloatingWindow = `editor-${newPane.id}`;
    status = `Floated tab ${tab.file?.name ?? ''} into window #${newPane.id}`;

    console.log('[floatTab] Panes after:', JSON.stringify(panes.map(p => ({ id: p.id, floating: p.floating, tabs: p.tabs.map(t => t.id), active: p.active }))));
  }

  function addPane(floating = false, customTabs = null) {
    const newId = nextPaneId++;
    const currentActiveTab = activeTab;
    const defaultInitialTabs = currentActiveTab && currentActiveTab.kind !== 'geometry' ? [{ ...currentActiveTab, dirty: false }] : [];
    const initialTabs = customTabs !== null ? customTabs : defaultInitialTabs;
    const offset = (panes.length % 6) * 32;
    const newPane = {
      id: newId,
      tabs: initialTabs,
      active: initialTabs.length ? initialTabs[0].id : null,
      floating,
      detached: false,
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
    const targetPane = remaining.find((p) => p.id === activePaneId && !p.detached) || remaining[0];
    if (paneToClose && targetPane) {
      for (const tab of paneToClose.tabs) {
        if (!targetPane.tabs.some((t) => t.id === tab.id || (tab.documentKey && t.documentKey === tab.documentKey))) {
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

  async function detachPane(paneId) {
    if (!api?.openDetachedWindow) {
      status = 'Detached multi-monitor window requires desktop app.';
      return;
    }
    const pane = panes.find((p) => p.id === paneId);
    if (!pane || paneHasGeometry(pane)) return;

    const windowId = `editor-${paneId}`;
    const screenX = typeof window !== 'undefined' ? (window.screenX || 0) : 0;
    const screenY = typeof window !== 'undefined' ? (window.screenY || 0) : 0;
    const bounds = {
      x: screenX + (pane.floatRect?.x ?? 200),
      y: screenY + (pane.floatRect?.y ?? 100),
      width: pane.floatRect?.width ?? 800,
      height: pane.floatRect?.height ?? 600
    };

    panes = panes.map((p) => p.id === paneId ? { ...p, detached: true, floating: false } : p);

    await api.openDetachedWindow({
      windowId,
      type: 'editor',
      title: `Editor #${paneId} - NiZyLa`,
      bounds,
      state: {
        pane,
        project,
        theme,
        showLineNumbers
      }
    });
    status = `Detached Editor #${paneId} to separate window (move to any monitor)`;
  }

  async function detachGraph() {
    if (!api?.openDetachedWindow) return;
    const windowId = 'graph';
    const screenX = typeof window !== 'undefined' ? (window.screenX || 0) : 0;
    const screenY = typeof window !== 'undefined' ? (window.screenY || 0) : 0;
    const bounds = {
      x: screenX + (graphFloat?.x ?? 320),
      y: screenY + (graphFloat?.y ?? 90),
      width: graphFloat?.width ?? 800,
      height: graphFloat?.height ?? 600
    };
    graphFloating = false;
    graphVisible = false;
    graphDetached = true;

    await api.openDetachedWindow({
      windowId,
      type: 'graph',
      title: 'Project Graph - NiZyLa',
      bounds,
      state: {
        graph: project?.graph,
        activePath: activeFile?.path,
        theme,
        currentFolderId: graphFolderId,
        viewMode: graphViewMode
      }
    });
    status = 'Detached Project Graph to separate window (move to any monitor)';
  }

  async function detachTerminal() {
    if (!api?.openDetachedWindow) return;
    const windowId = 'terminal';
    const screenX = typeof window !== 'undefined' ? (window.screenX || 0) : 0;
    const screenY = typeof window !== 'undefined' ? (window.screenY || 0) : 0;
    const bounds = {
      x: screenX + (terminalFloat?.x ?? 260),
      y: screenY + (terminalFloat?.y ?? 380),
      width: terminalFloat?.width ?? 840,
      height: terminalFloat?.height ?? 400
    };
    terminalFloating = false;
    terminalVisible = false;
    terminalDetached = true;

    await api.openDetachedWindow({
      windowId,
      type: 'terminal',
      title: 'Terminal - NiZyLa',
      bounds,
      state: {
        cwd: activeExplorerFolder?.path ?? '',
        theme
      }
    });
    status = 'Detached Terminal to separate window (move to any monitor)';
  }

  function dockDetachedSelf() {
    if (!api?.dockDetachedWindow || !detachedWindowId) return;
    if (detachedWindowId === 'graph') {
      api.dockDetachedWindow(detachedWindowId, {
        currentFolderId: graphFolderId,
        viewMode: graphViewMode
      });
    } else {
      api.dockDetachedWindow(detachedWindowId, {
        pane: panes[0],
        theme,
        showLineNumbers
      });
    }
  }

  function handleDetachedDockBack({ windowId, state }) {
    if (windowId.startsWith('editor-')) {
      const paneId = Number(windowId.replace('editor-', ''));
      panes = panes.map((p) => {
        if (p.id !== paneId) return p;
        return {
          ...p,
          detached: false,
          floating: true,
          tabs: state?.pane?.tabs ?? p.tabs,
          active: state?.pane?.active ?? p.active
        };
      });
      activePaneId = paneId;
      status = `Docked Editor #${paneId} back to main window`;
    } else if (windowId === 'graph') {
      graphDetached = false;
      graphVisible = true;
      graphFloating = true;
      if (state?.currentFolderId !== undefined) graphFolderId = state.currentFolderId;
      if (state?.viewMode !== undefined) graphViewMode = state.viewMode;
      status = 'Docked Project Graph back to main window';
    } else if (windowId === 'terminal') {
      terminalDetached = false;
      terminalVisible = true;
      terminalFloating = true;
      status = 'Docked Terminal back to main window';
    }
  }

  async function closeTerminalWorkspaceFromLastTab() {
    if (detachedMode === 'terminal') {
      api?.updateDetachedState?.('terminal', { closedByLastTab: true });
      window.close();
      return;
    }

    if (terminalDetached && api?.closeDetachedWindow) {
      await api.closeDetachedWindow('terminal');
    }

    terminalDetached = false;
    terminalVisible = false;
    terminalFloating = false;
    status = 'Terminal closed';
  }

  async function toggleTerminal() {
    if (terminalDetached) {
      if (api?.closeDetachedWindow) {
        await api.closeDetachedWindow('terminal');
      }
      terminalDetached = false;
      terminalVisible = true;
      terminalFloating = false;
      status = 'Terminal restored to main window';
      return;
    }
    terminalVisible = !terminalVisible;
  }

  function handleWindowResize() {
    if (window.innerWidth < 1100) {
      if (graphVisible && !graphDetached) {
        graphVisible = false;
        graphAutoHidden = true;
      }
    } else {
      if (graphAutoHidden) {
        graphVisible = true;
        graphAutoHidden = false;
      }
    }
  }

  async function toggleGraph() {
    if (graphDetached) {
      if (api?.closeDetachedWindow) {
        await api.closeDetachedWindow('graph');
      }
      graphDetached = false;
      graphVisible = true;
      graphFloating = false;
      graphAutoHidden = false;
      status = 'Project Graph restored to main window';
      return;
    }
    graphVisible = !graphVisible;
    graphAutoHidden = false;
  }

  function handleDetachedClosed({ windowId, state }) {
    if (windowId.startsWith('editor-')) {
      const paneId = Number(windowId.replace('editor-', ''));
      panes = panes.map((p) => {
        if (p.id !== paneId) return p;
        return {
          ...p,
          detached: false,
          tabs: state?.pane?.tabs ?? p.tabs,
          active: state?.pane?.active ?? p.active
        };
      });
    } else if (windowId === 'graph') {
      graphDetached = false;
      graphVisible = true;
      graphFloating = false;
      status = 'Project Graph restored to main window';
    } else if (windowId === 'terminal') {
      terminalDetached = false;
      if (state?.closedByLastTab) {
        terminalVisible = false;
        terminalFloating = false;
        status = 'Terminal closed';
      } else {
        terminalVisible = true;
        terminalFloating = false;
        status = 'Terminal restored to main window';
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
    preferences.theme = nextTheme;
    savePreferences(preferences);
  }

  function onPreferencesUpdate(updated) {
    preferences = updated;
    theme = updated.theme;
  }

  function toggleLineNumbers() {
    showLineNumbers = !showLineNumbers;
    localStorage.setItem('nizyla.lineNumbers', String(showLineNumbers));
  }

  function cleanRelativePath(value) {
    return value?.trim().replace(/^\/+/, '').replace(/\/+/g, '/') ?? '';
  }

  async function openCreateDialog(type, parent = activeExplorerFolder) {
    if (!project) return;
    createDialog = type;
    createParent = parent;
    createPath = type === 'geometry-save' && savingGeometryTab?.file?.name ? savingGeometryTab.file.name : '';
    await tick();
    createInput?.focus();
  }

  function openContextMenu(event) {
    contextMenu = event.detail;
    if (contextMenu.entry?.type === 'folder') activateExplorerFolder(contextMenu.entry);
  }

  function openExplorerContextMenu(event) {
    if (event.target !== event.currentTarget || !project) return;
    event.preventDefault();
    contextMenu = { entry: project.tree, x: event.clientX, y: event.clientY };
  }

  function openCreateFromContext(type) {
    const entry = contextMenu?.entry;
    const parent = entry?.type === 'folder' ? entry : activeExplorerFolder;
    contextMenu = null;
    if (type === 'geometry') {
      handleNewGeometryCode();
      return;
    }
    openCreateDialog(type, parent);
  }

  function searchFolderFromContext(entry) {
    contextMenu = null;
    setSearchScopeFolder(entry);
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
        const tabs = pane.tabs.filter((tab) => !tab.file?.path || (tab.file.path !== target.path && !tab.file.path.startsWith(`${target.path}/`)));
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

  function closeCreateDialog(saved = false) {
    if (createBusy) return;
    createDialog = null;
    createPath = '';
    createParent = null;
    const resolve = resolveGeometrySave;
    resolveGeometrySave = null;
    resolve?.(saved === true);
  }

  function closeCreateDialogFromBackdrop(event) {
    if (event.target === event.currentTarget) closeCreateDialog();
  }

  async function submitCreateDialog() {
    if (!project || !api || !createDialog || createBusy) return;
    const name = cleanRelativePath(createPath);
    if (!name) return;
    const parent = createParent ?? project.tree;
    const relativePath = parent.path === project.rootPath ? name : `${parent.relativePath}/${name}`;
    const savingGraph = createDialog === 'geometry-save';
    if (savingGraph && savingGeometryTab?.hasDrafts) {
      status = 'Please fix draft errors before saving.';
      return;
    }
    createBusy = true;
    try {
      if (createDialog === 'geometry' || savingGraph) {
        const gcnName = name.toLowerCase().endsWith('.gcn') ? name : `${name}.gcn`;
        const filePath = `${parent.path}/${gcnName}`;
        const targetTab = savingGraph ? savingGeometryTab : null;
        const initialDoc = targetTab ? targetTab.doc : createGeometryDocument();
        const initialContent = serializeGeometryDocument(initialDoc);
        await api.createGeometryFile(filePath, initialContent);

        const file = {
          name: gcnName.split('/').pop(),
          path: filePath,
          relativePath: parent.path === project.rootPath ? gcnName : `${parent.relativePath}/${gcnName}`,
          type: 'file',
          previewType: 'geometry'
        };

        if (savingGraph && targetTab) {
          const oldId = targetTab.id;
          panes = panes.map((p) => {
            const hasTab = p.tabs.some((t) => t.id === oldId);
            if (!hasTab) return p;
            return {
              ...p,
              active: p.active === oldId ? filePath : p.active,
              tabs: p.tabs.map((t) => t.id === oldId ? {
                ...t,
                id: filePath,
                file,
                baseline: initialDoc,
                hasDrafts: false,
                dirty: false
              } : t)
            };
          });
        } else {
          const newTab = {
            id: filePath,
            kind: 'geometry',
            documentKey: crypto.randomUUID(),
            file,
            doc: initialDoc,
            baseline: initialDoc,
            hasDrafts: false,
            dirty: false
          };
          const targetPane = panes.find((p) => p.id === activePaneId && !p.detached) ?? panes.find((p) => !p.detached) ?? panes[0];
          if (targetPane) {
            panes = panes.map((p) => p.id === targetPane.id ? {
              ...p,
              active: newTab.id,
              tabs: [...p.tabs, newTab]
            } : p);
            activePaneId = targetPane.id;
          }
        }

        const refreshError = await refreshFileProject(filePath);
        status = refreshError || `Saved Geometry Code ${gcnName.split('/').pop()} successfully.`;
        createBusy = false;
        closeCreateDialog(true);
        return;
      }
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
      createBusy = false;
      closeCreateDialog();
    } catch (error) {
      status = `Could not create ${createDialog}: ${error.message}`;
    } finally {
      createBusy = false;
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
      const rawX = floatingDrag.x + dx;
      const rawY = floatingDrag.y + dy;

      const nearLeft = event.clientX <= 20 || rawX <= 15;
      const nearRight = event.clientX >= window.innerWidth - 20 || rawX + floatingDrag.width >= window.innerWidth - 15;
      const nearTop = event.clientY <= 55 || rawY <= 55;
      const nearBottom = event.clientY >= window.innerHeight - 25 || rawY + floatingDrag.height >= window.innerHeight - 20;
      const isNearEdge = (nearLeft || nearRight || nearTop || nearBottom);
      if (floatingDrag.windowType === 'editor') {
        const pane = panes.find((p) => p.id === floatingDrag.paneId);
        dragNearEdge = isNearEdge && !paneHasGeometry(pane);
      } else {
        dragNearEdge = isNearEdge;
      }

      const nextX = Math.max(-100, Math.min(window.innerWidth - 80, rawX));
      const nextY = Math.max(50, Math.min(window.innerHeight - 40, rawY));

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
    if (floatingDrag?.action === 'move' && dragNearEdge && api?.openDetachedWindow) {
      const currentDrag = { ...floatingDrag };
      floatingDrag = null;
      dragNearEdge = false;
      window.removeEventListener('pointermove', onFloatingPointerMove);

      if (currentDrag.windowType === 'editor') {
        const pane = panes.find((p) => p.id === currentDrag.paneId);
        if (pane && !paneHasGeometry(pane)) {
          detachPane(currentDrag.paneId);
        }
      } else if (currentDrag.windowType === 'graph') {
        detachGraph();
      } else if (currentDrag.windowType === 'terminal') {
        detachTerminal();
      }
      return;
    }
    floatingDrag = null;
    dragNearEdge = false;
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

{#if detachedMode === 'editor'}
  <div class="detached-shell theme-{theme}">
    <header class="topbar detached-topbar">
      <div class="brand">
        <img class="logo" src={logoUrl} alt="NiZyLa logo" />
        <div>
          <strong>NiZyLa</strong>
          <span>Editor #{panes[0]?.id ?? ''} · Detached Multi-Monitor</span>
        </div>
      </div>
      <div
        class="actions"
        class:middle-dragging={isMiddleDragging}
        role="toolbar"
        tabindex="-1"
        aria-label="Editor actions"
        bind:this={actionsEl}
        on:mousedown={onActionsMouseDown}
        on:wheel={onActionsWheel}
      >
        <button class="primary" on:click={dockDetachedSelf}>Dock to Main Window</button>
        <select value={theme} on:change={(event) => setTheme(event.currentTarget.value)} aria-label="Theme">
          <option value="structs">Structs Teal (Indie)</option>
          <option value="obsidian">Obsidian Dark</option>
          <option value="cream">Cream Light</option>
          <option value="cyberpunk">Cyberpunk Neon</option>
          <option value="custom">Custom Theme</option>
        </select>
        <button on:click={() => (showPreferences = true)} title="Preferences: Theme, Fonts, Syntax">⚙ Preferences</button>
        <button on:click={toggleLineNumbers} class:active={!showLineNumbers}>Lines {showLineNumbers ? 'On' : 'Off'}</button>
        {#if activeFile?.name?.toLowerCase().endsWith('.md')}
          <button on:click={() => (markdownPreview = !markdownPreview)} class:active={markdownPreview}>Markdown {markdownPreview ? 'Preview' : 'Edit'}</button>
        {/if}
        <button class="primary" on:click={saveFile} disabled={!activeTab || !activeTab.dirty}>Save</button>
      </div>
      <div class="window-control-box">
        <button title="Minimize" on:click={() => windowControl('minimize')}>—</button>
        <button title="Maximize" on:click={() => windowControl('maximize')}>□</button>
        <button class="close" title="Close" on:click={() => windowControl('close')}>×</button>
      </div>
    </header>

    <main class="detached-content">
      <div class="editor-area panel focused">
        <div class="tabbar">
          <div class="tabs-scroll">
            {#if panes[0]?.tabs.length}
              {#each panes[0].tabs as tab (tab.id)}
                <div class="tab tab-wrap" class:active={tab.id === panes[0].active}>
                  <button on:click|stopPropagation={() => activateTab(panes[0].id, tab.id)}>{tab.file.name}{tab.dirty ? ' •' : ''}</button>
                  <button class="tab-close" aria-label="Close tab" on:click|stopPropagation={() => closeTab(panes[0].id, tab.id)}>×</button>
                </div>
              {/each}
            {:else}
              <div class="tab muted">No file selected</div>
            {/if}
          </div>
        </div>
        {#if activeTab?.file?.previewType === 'image'}
          <div class="image-preview">
            <img src={activeTab.content} alt={activeTab.file.relativePath} />
            <div>{activeTab.file.relativePath}</div>
          </div>
        {:else if activeTab?.file?.previewType === 'pdf'}
          <iframe class="pdf-preview" src={activeTab.content} title={`PDF preview: ${activeTab.file.relativePath}`}></iframe>
        {:else if activeTab?.file?.name?.toLowerCase().endsWith('.md') && markdownPreview}
          <MarkdownPreview content={activeTab.content} title={activeTab.file.name.replace(/\.md$/i, '')} on:wiki={(event) => openWikiLink(event.detail)} />
        {:else}
          <CodeEditor file={activeTab?.file} content={activeTab?.content ?? ''} {showLineNumbers} {theme} {preferences} searchHighlight={searchHighlightTerm} searchLine={activeTab?.file?.searchLine ?? null} on:change={(event) => updateTabContent(panes[0].id, event.detail)} on:zoom={handleEditorZoom} on:clearSearchHighlight={() => (searchHighlightTerm = '')} />
        {/if}
      </div>
    </main>
    <footer class="statusbar">{activeFile?.relativePath ?? 'No file'} · Detached Multi-Monitor Window</footer>
  </div>
{:else if detachedMode === 'graph'}
  <div class="detached-shell theme-{theme}">
    <header class="topbar detached-topbar">
      <div class="brand">
        <img class="logo" src={logoUrl} alt="NiZyLa logo" />
        <div>
          <strong>NiZyLa</strong>
          <span>Project Graph · Detached Multi-Monitor</span>
        </div>
      </div>
      <div class="actions">
        <button class="primary" on:click={dockDetachedSelf}>Dock to Main Window</button>
      </div>
      <div class="window-control-box">
        <button title="Minimize" on:click={() => windowControl('minimize')}>—</button>
        <button title="Maximize" on:click={() => windowControl('maximize')}>□</button>
        <button class="close" title="Close" on:click={() => windowControl('close')}>×</button>
      </div>
    </header>
    <main class="detached-content">
      {#if project?.graph || detachedState?.graph}
        <GraphView
          graph={project?.graph ?? detachedState.graph}
          activePath={activeFile?.path ?? detachedState?.activePath}
          fullscreen={true}
          bind:currentFolderId={graphFolderId}
          bind:viewMode={graphViewMode}
          on:folder={(e) => api?.syncFolderToMainWindow?.(e.detail)}
          on:node={(event) => api?.openFileInMainWindow(event.detail)}
          on:move={moveEntry}
        />
      {:else}
        <div class="empty">No graph data available.</div>
      {/if}
    </main>
    <footer class="statusbar">Project Graph · Click node to open in main window</footer>
  </div>
{:else if detachedMode === 'terminal'}
  <div class="detached-shell theme-{theme}">
    <header class="topbar detached-topbar">
      <div class="brand">
        <img class="logo" src={logoUrl} alt="NiZyLa logo" />
        <div>
          <strong>NiZyLa</strong>
          <span>Terminal · Detached Multi-Monitor</span>
        </div>
      </div>
      <div class="actions">
        <button class="primary" on:click={dockDetachedSelf}>Dock to Main Window</button>
      </div>
      <div class="window-control-box">
        <button title="Minimize" on:click={() => windowControl('minimize')}>—</button>
        <button title="Maximize" on:click={() => windowControl('maximize')}>□</button>
        <button class="close" title="Close" on:click={() => windowControl('close')}>×</button>
      </div>
    </header>
    <main class="detached-content terminal-detached">
      <TerminalPanel api={api} cwd={detachedCwdParam || detachedState?.cwd || project?.rootPath || ''} onLastTabClose={closeTerminalWorkspaceFromLastTab} />
    </main>
    <footer class="statusbar">Integrated Terminal · Detached Multi-Monitor Window</footer>
  </div>
{:else}
  <div class="app-shell theme-{theme}" class:graph-hidden={!graphVisible || graphDetached} class:terminal-open={terminalVisible && !terminalFloating && !terminalDetached} class:graph-fullscreen={graphFullscreen} class:graph-floating={graphFloating} style="--sidebar-width: {layoutSize.sidebar}px; --graph-width: {layoutSize.graph}px; --terminal-height: {layoutSize.terminal}px">
    <header class="topbar app-titlebar">
      <div class="brand">
        <img class="logo" src={logoUrl} alt="NiZyLa logo" />
        <div>
          <strong>NiZyLa</strong>
          <span>{projects.length} workspace{projects.length === 1 ? '' : 's'} · {plugins.length} plugin{plugins.length === 1 ? '' : 's'} · local code completion</span>
        </div>
      </div>
      <button class="new-geometry-btn" on:click={handleNewScratchGeometry} title="New Geometry Code scratch graph">+ Geometry Code</button>
      <div
        class="actions"
        class:middle-dragging={isMiddleDragging}
        role="toolbar"
        tabindex="-1"
        aria-label="Menu bar actions"
        bind:this={actionsEl}
        on:mousedown={onActionsMouseDown}
        on:wheel={onActionsWheel}
        title="Scroll with mouse wheel or middle-click and drag"
      >
        <button on:click={openProject}>Open Folder</button>
        <button on:click={() => refreshProject()} disabled={!project}>Refresh</button>
        <select value={theme} on:change={(event) => setTheme(event.currentTarget.value)} aria-label="Theme">
          <option value="structs">Structs Teal (Indie)</option>
          <option value="obsidian">Obsidian Dark</option>
          <option value="cream">Cream Light</option>
          <option value="cyberpunk">Cyberpunk Neon</option>
          <option value="custom">Custom Theme</option>
        </select>
        <button on:click={() => (showPreferences = true)} title="Preferences: Theme, Fonts, Syntax (Ctrl+,)">⚙ Preferences</button>
        <button on:click={() => addPane(false)} title="Add a new editor window">+ Editor</button>
        <button on:click={() => addPane(true)} title="Add a floating editor window">+ Float Editor</button>
        <button on:click={toggleSplit} class:active={dockedPanes.length > 1}>Split {dockedPanes.length > 1 ? `(${dockedPanes.length})` : ''}</button>
        <button on:click={toggleTerminal} class:active={terminalVisible || terminalDetached}>Terminal{terminalDetached ? ' (Detached)' : (terminalVisible && terminalFloating ? ' (Float)' : '')}</button>
        <button on:click={toggleLineNumbers} class:active={!showLineNumbers}>Lines {showLineNumbers ? 'On' : 'Off'}</button>
        {#if activeFile?.name?.toLowerCase().endsWith('.md')}
          <button on:click={() => (markdownPreview = !markdownPreview)} class:active={markdownPreview}>Markdown {markdownPreview ? 'Preview' : 'Edit'}</button>
        {/if}
        <button on:click={toggleGraph}>Graph {graphDetached ? '(Detached)' : (graphVisible ? (graphFloating ? '(Float)' : 'Hide') : 'Show')}</button>
        {#if isGeometryTab(activeTab)}
          <button on:click={handleNewGeometryCode} title="Create a new Geometry Code Node (.gcn) in the project">+ Node</button>
          <button on:click={() => saveGeometry(activeTab, true)} disabled={activeTab?.hasDrafts || isSavingTabs.has(activeTab?.id) || !!createDialog} title="Save a copy in the selected Explorer folder">Save As</button>
          <button on:click={() => handleExportGeometry(activeTab)} disabled={!canExportTab(activeTab)} title="Export Python / GDScript">Export</button>
          <button on:click={closeGeometryGraph} title="Close the current Geometry Code Node">Close Node</button>
        {:else if activeFile && /\.(py|gd)$/i.test(activeFile.name)}
          <button class="primary" on:click={() => handleConvertSourceToGeometry(activeFile)} title="Convert to Geometry Code (.gcn)">⇄ Convert to .gcn</button>
        {/if}
        <button class="primary" on:click={handleSave} disabled={!canSave}>Save</button>
      </div>
      <div class="window-control-box">
        <button title="Minimize" on:click={() => windowControl('minimize')}>—</button>
        <button title="Maximize" on:click={() => windowControl('maximize')}>□</button>
        <button class="close" title="Close" on:click={requestClose}>×</button>
      </div>
    </header>

    <main class="workspace" bind:this={workspaceEl}>
      <nav class="activity-bar" aria-label="Primary navigation">
        <button class:active={sidebarView === 'files'} title="Files" on:click={() => (sidebarView = 'files')}>▣</button>
        <button class:active={sidebarView === 'search'} title="Search documents" on:click={() => (sidebarView = 'search')}>⌕</button>
        <button title="Open folder" on:click={openProject}><span class="nav-folder-icon" aria-hidden="true"></span></button>
        <button title="Graph" on:click={toggleGraph}>◎</button>
        <button title="Terminal" on:click={toggleTerminal}>›_</button>
        <button title="Preferences" on:click={() => (showPreferences = true)}>⚙</button>
      </nav>
      <aside class="sidebar panel" bind:this={sidebarEl}>
        {#if sidebarView === 'search'}
          <div class="panel-title">Search</div>
          <div class="document-search">
            <div class="search-scope">
              <span>Searching in: <strong>{searchScopeLabel}</strong></span>
              {#if searchScopeFolder}<button on:click={clearSearchScope}>Search all</button>{/if}
            </div>
            <div class="search-box-row">
              <div class="search-input-wrapper">
                <input
                  value={documentSearchQuery}
                  placeholder="Search documents..."
                  on:input={(event) => updateDocumentSearchQuery(event.currentTarget.value)}
                  on:keydown={(event) => event.key === 'Enter' && refreshDocumentSearch()}
                />
                <div class="search-toggles">
                  <button
                    type="button"
                    class="search-toggle-btn"
                    class:active={searchMatchCase}
                    title="Match Case (Aa)"
                    on:click={toggleMatchCase}
                  >Aa</button>
                  <button
                    type="button"
                    class="search-toggle-btn"
                    class:active={searchWholeWord}
                    title="Match Whole Word (\b)"
                    on:click={toggleWholeWord}
                  >\b</button>
                  <button
                    type="button"
                    class="search-toggle-btn"
                    class:active={searchUseRegex}
                    title="Use Regular Expression (.*)"
                    on:click={toggleUseRegex}
                  >.*</button>
                </div>
              </div>
              <div class="search-controls-row">
                <select value={documentSearchKind} on:change={(event) => updateDocumentSearchKind(event.currentTarget.value)} aria-label="Search type">
                  <option value="all">All</option>
                  <option value="text">Text</option>
                  <option value="variable">Variable</option>
                  <option value="class">Class</option>
                  <option value="function">Function</option>
                </select>
                <button type="button" title="Refresh index and search now" on:click={refreshDocumentSearch}>Search</button>
              </div>
            </div>
            <div class="search-meta">
              {#if documentSearchBusy}
                <span class="search-spinner" aria-hidden="true"></span> Searching...
              {:else if searchRegexError}
                <span class="search-error" title={searchRegexError}>⚠️ {searchRegexError}</span>
              {:else if totalMatchCount > 0}
                <span>{totalMatchCount} {totalMatchCount === 1 ? 'match' : 'matches'} in {totalFileCount} {totalFileCount === 1 ? 'file' : 'files'}</span>
                <button type="button" class="search-collapse-toggle" on:click={toggleCollapseAll}>
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              {:else}
                <span>{documentSearchQuery.trim() ? 'No matches found.' : 'Type to search.'}</span>
              {/if}
            </div>
            <div class="search-results">
              {#if documentSearchResults.length}
                {#each documentSearchResults as group, gIndex}
                  <div class="search-file-group">
                    <button type="button" class="search-file-header" on:click={() => toggleFileCollapse(gIndex)}>
                      <span class="search-file-arrow">{group.collapsed ? '▸' : '▾'}</span>
                      <span class="search-file-name">{group.file.name}</span>
                      <span class="search-file-path">{group.file.relativePath}</span>
                      <span class="search-file-count" title={`${group.matches.length} matches`}>{group.matches.length}</span>
                    </button>
                    {#if !group.collapsed}
                      <div class="search-match-list">
                        {#each group.matches as match}
                          <button type="button" class="search-match-item" on:click={() => selectSearchResult(group.file, match)}>
                            <span class="search-line-num">L{match.line}</span>
                            <span class="search-match-preview" title={match.preview}>
                              {#each splitMatchPreview(match.preview, match.searchTerm || documentSearchQuery, searchMatchCase, searchWholeWord, searchUseRegex) as part}
                                {#if part.match}
                                  <mark class="search-match-text">{part.text}</mark>
                                {:else}
                                  <span>{part.text}</span>
                                {/if}
                              {/each}
                            </span>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              {:else if !documentSearchBusy && documentSearchQuery.trim()}
                <div class="empty">No matches found.</div>
              {/if}
            </div>
          </div>
        {:else}
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
            <FileTree entry={project.tree} {activeFile} activeFolderPath={graphFolderId} on:select={(event) => selectFile(event.detail)} on:folder={(event) => activateExplorerFolder(event.detail)} on:context={openContextMenu} on:move={moveEntry} />
          </div>
        {:else}
          <div class="empty">No folder open.</div>
        {/if}
        {/if}
      </aside>
      {#if !graphFullscreen && !graphDetached}
        <div class="pane-resizer sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" on:pointerdown={(event) => startLayoutResize(event, 'sidebar')}></div>
      {/if}

      <section class="editors" style={getEditorsGridStyle(dockedPanes.length)}>
        {#if dockedPanes.length}
          {#each dockedPanes as pane (pane.id)}
            <div
              class="editor-area panel"
              class:focused={activePaneId === pane.id}
              on:pointerdown|capture={() => (activePaneId = pane.id)}
              role="presentation"
            >
              <div class="tabbar">
                <div class="tabs-scroll">
                  {#if pane.tabs.length}
                    {#each pane.tabs as tab (tab.id)}
                      <div class="tab tab-wrap" role="presentation" class:active={tab.id === pane.active} on:contextmenu|preventDefault={(e) => openTabMenu(pane.id, tab.id, e)}>
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
                  <button class="pane-btn" title={paneHasGeometry(pane) ? "Cannot detach pane containing Geometry Code" : "Detach to separate monitor window"} disabled={paneHasGeometry(pane)} on:click|stopPropagation={() => detachPane(pane.id)}>Detach ⧉</button>
                  {#if panes.length > 1}
                    <button class="pane-btn pane-close" title="Close editor window" on:click|stopPropagation={() => closePane(pane.id)}>×</button>
                  {/if}
                </div>
              </div>
              {#if getActiveTab(pane)?.kind === 'geometry'}
                {@const tab = getActiveTab(pane)}
                <GeometryWorkspace
                  document={tab.doc}
                  documentKey={tab.documentKey}
                  active={activePaneId === pane.id}
                  filePath={tab.file?.path ?? null}
                  dirty={isTabDirty(tab)}
                  {theme}
                  {preferences}
                  {showLineNumbers}
                  onchange={(next) => handleGeometryChange(pane.id, tab.id, next)}
                  ondraftchange={(hasDrafts) => handleGeometryDraftChange(pane.id, tab.id, hasDrafts)}
                  onexport={() => handleExportGeometry(tab)}
                  onrun={() => handleRunPython(tab)}
                  onstop={handleStopPython}
                  isRunning={isPythonRunning}
                />
              {:else if getActiveTab(pane)?.file?.previewType === 'image'}
                <div class="image-preview">
                  <img src={getActiveTab(pane).content} alt={getActiveTab(pane).file.relativePath} />
                  <div>{getActiveTab(pane).file.relativePath}</div>
                </div>
              {:else if getActiveTab(pane)?.file?.previewType === 'pdf'}
                <iframe class="pdf-preview" src={getActiveTab(pane).content} title={`PDF preview: ${getActiveTab(pane).file.relativePath}`}></iframe>
              {:else if getActiveTab(pane)?.file?.name?.toLowerCase().endsWith('.md') && markdownPreview}
                <MarkdownPreview content={getActiveTab(pane).content} title={getActiveTab(pane).file.name.replace(/\.md$/i, '')} on:wiki={(event) => openWikiLink(event.detail)} />
              {:else}
                <CodeEditor file={getActiveTab(pane)?.file} content={getActiveTab(pane)?.content ?? ''} {showLineNumbers} {theme} {preferences} searchHighlight={searchHighlightTerm} searchLine={getActiveTab(pane)?.file?.searchLine ?? null} on:change={(event) => updateTabContent(pane.id, event.detail)} on:zoom={handleEditorZoom} on:clearSearchHighlight={() => (searchHighlightTerm = '')} />
              {/if}
            </div>
          {/each}
        {:else}
          <div class="empty-editors panel">
            <div class="empty-title">All editor windows are floating or detached</div>
            <div class="empty-actions">
              <button on:click={() => addPane(false)}>+ Add Docked Editor</button>
              <button on:click={dockAllEditors}>Dock All Editors</button>
            </div>
          </div>
        {/if}
      </section>

      {#if graphVisible && !graphDetached}
        {#if !graphFloating && !graphFullscreen}
          <div class="pane-resizer graph-resizer" role="separator" aria-label="Resize graph panel" aria-orientation="vertical" on:pointerdown={(event) => startLayoutResize(event, 'graph')}></div>
        {/if}
        <aside
          class="graph-panel panel"
          class:floating-window={graphFloating}
          class:graph-floating={graphFloating}
          class:focused={activeFloatingWindow === 'graph'}
          class:float-drag-cue={floatingDrag?.windowType === 'graph' && dragNearEdge}
          style={getGraphStyle(graphFloating, graphFloat, graphFullscreen)}
          on:pointerdown={() => graphFloating && focusFloatingWindow('graph')}
        >
          <div class="panel-title graph-title window-title" role="toolbar" tabindex="-1" aria-label="Project graph controls" on:pointerdown={(e) => graphFloating && startFloatingMove(e, 'graph')}>
            <span>Project Graph</span>
            {#if floatingDrag?.windowType === 'graph' && dragNearEdge}
              <span class="float-edge-notice">Release to Pop Out</span>
            {/if}
            <div class="window-actions">
              <button on:click={() => (graphFloating = !graphFloating)}>{graphFloating ? 'Dock' : 'Float'}</button>
              <button on:click={detachGraph} title="Detach to separate monitor window">Detach ⧉</button>
              <button on:click={() => toggleMaximizeFloatingWindow('graph')}>
                {graphFloat.maximized || graphFullscreen ? 'Restore' : 'Full'}
              </button>
              <button aria-label="Close graph" on:click={() => { graphVisible = false; graphAutoHidden = false; }}>×</button>
            </div>
          </div>
          {#if project}
            <GraphView
              graph={project.graph}
              activePath={activeFile?.path}
              fullscreen={graphFullscreen || graphFloat.maximized}
              bind:currentFolderId={graphFolderId}
              bind:viewMode={graphViewMode}
              on:node={selectGraphNode}
              on:move={moveEntry}
            />
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
        class:float-drag-cue={floatingDrag?.windowType === 'editor' && floatingDrag?.paneId === pane.id && dragNearEdge}
        style={getFloatingPaneStyle(pane)}
        role="region"
        aria-label={`Floating Editor ${pane.id}`}
        on:pointerdown={() => focusFloatingWindow('editor', pane.id)}
      >
        <div class="window-title" role="toolbar" tabindex="-1" aria-label={`Editor ${pane.id} controls`} on:pointerdown={(e) => startFloatingMove(e, 'editor', pane.id)}>
          <span class="window-title-text">Editor #{pane.id}{getActiveTab(pane) ? ` · ${getActiveTab(pane).file.name}` : ''}</span>
          {#if floatingDrag?.windowType === 'editor' && floatingDrag?.paneId === pane.id && dragNearEdge}
            <span class="float-edge-notice">Release to Pop Out</span>
          {/if}
          <div class="window-actions">
            <button on:click={() => togglePaneFloat(pane.id)}>Dock</button>
            <button on:click={() => detachPane(pane.id)} disabled={paneHasGeometry(pane)} title={paneHasGeometry(pane) ? "Cannot detach pane containing Geometry Code" : "Detach to separate monitor window"}>Detach ⧉</button>
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
                <div class="tab tab-wrap" role="presentation" class:active={tab.id === pane.active} on:contextmenu|preventDefault={(e) => openTabMenu(pane.id, tab.id, e)}>
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
          {#if getActiveTab(pane)?.kind === 'geometry'}
            {@const tab = getActiveTab(pane)}
            <GeometryWorkspace
              document={tab.doc}
              documentKey={tab.documentKey}
              active={activePaneId === pane.id}
              filePath={tab.file?.path ?? null}
              dirty={isTabDirty(tab)}
              {theme}
              {preferences}
              {showLineNumbers}
              onchange={(next) => handleGeometryChange(pane.id, tab.id, next)}
              ondraftchange={(hasDrafts) => handleGeometryDraftChange(pane.id, tab.id, hasDrafts)}
              onexport={() => handleExportGeometry(tab)}
              onrun={() => handleRunPython(tab)}
              onstop={handleStopPython}
              isRunning={isPythonRunning}
            />
          {:else if getActiveTab(pane)?.file?.previewType === 'image'}
            <div class="image-preview">
              <img src={getActiveTab(pane).content} alt={getActiveTab(pane).file.relativePath} />
              <div>{getActiveTab(pane).file.relativePath}</div>
            </div>
          {:else if getActiveTab(pane)?.file?.previewType === 'pdf'}
            <iframe class="pdf-preview" src={getActiveTab(pane).content} title={`PDF preview: ${getActiveTab(pane).file.relativePath}`}></iframe>
          {:else if getActiveTab(pane)?.file?.name?.toLowerCase().endsWith('.md') && markdownPreview}
            <MarkdownPreview content={getActiveTab(pane).content} title={getActiveTab(pane).file.name.replace(/\.md$/i, '')} on:wiki={(event) => openWikiLink(event.detail)} />
          {:else}
            <CodeEditor file={getActiveTab(pane)?.file} content={getActiveTab(pane)?.content ?? ''} {showLineNumbers} {theme} {preferences} searchHighlight={searchHighlightTerm} searchLine={getActiveTab(pane)?.file?.searchLine ?? null} on:change={(event) => updateTabContent(pane.id, event.detail)} on:zoom={handleEditorZoom} on:clearSearchHighlight={() => (searchHighlightTerm = '')} />
          {/if}
        </div>

        {#if !pane.floatRect?.maximized}
          <button class="float-resize" aria-label="Resize editor window" on:pointerdown={(e) => startFloatingResize(e, 'editor', pane.id)}>Resize</button>
        {/if}
      </aside>
    {/each}

    {#if terminalVisible && !terminalDetached}
      <section
        class="terminal-host"
        class:terminal-slot={!terminalFloating}
        class:floating-window={terminalFloating}
        class:terminal-floating={terminalFloating}
        class:focused={activeFloatingWindow === 'terminal'}
        class:float-drag-cue={floatingDrag?.windowType === 'terminal' && dragNearEdge}
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
              <button on:click={detachTerminal} title="Detach to separate monitor window">Detach ⧉</button>
              <button aria-label="Close terminal" on:click={() => (terminalVisible = false)}>×</button>
            </div>
          </div>
        {:else}
          <div class="window-title" role="toolbar" tabindex="-1" aria-label="Terminal controls" on:pointerdown={(e) => startFloatingMove(e, 'terminal')}>
            <span>Integrated Terminal</span>
            {#if floatingDrag?.windowType === 'terminal' && dragNearEdge}
              <span class="float-edge-notice">Release to Pop Out</span>
            {/if}
            <div class="window-actions">
              <button on:click={() => (terminalFloating = false)}>Dock</button>
              <button on:click={detachTerminal} title="Detach to separate monitor window">Detach ⧉</button>
              <button on:click={() => toggleMaximizeFloatingWindow('terminal')}>
                {terminalFloat.maximized ? 'Restore' : 'Full'}
              </button>
              <button aria-label="Close terminal" on:click={() => (terminalVisible = false)}>×</button>
            </div>
          </div>
        {/if}
        <div class="terminal-shell-wrap">
          <TerminalPanel bind:this={terminalPanelRef} api={api} cwd={activeExplorerFolder?.path ?? ''} onLastTabClose={closeTerminalWorkspaceFromLastTab} />
        </div>
        {#if terminalFloating && !terminalFloat.maximized}
          <button class="float-resize" aria-label="Resize terminal" on:pointerdown={(e) => startFloatingResize(e, 'terminal')}>Resize</button>
        {/if}
      </section>
    {/if}

    <footer class="statusbar">{isGeometryTab(activeTab) ? `${activeTab.file?.name ?? 'scratch.gcn'}${isTabDirty(activeTab) ? ' •' : ''} · ` : ''}{status} · Ctrl/⌘P search · Ctrl/⌘\ split · Ctrl/⌘` terminal · Ctrl/⌘G graph · Ctrl/⌘S save</footer>

    {#if contextMenu}
      <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px">
        <div class="context-title">{contextMenu.entry.name}</div>
        {#if contextMenu.entry.type === 'folder'}
          <button on:click={() => searchFolderFromContext(contextMenu.entry)}>Search in this Folder</button>
          <button on:click={() => openCreateFromContext('file')}>New File</button>
          <button on:click={() => openCreateFromContext('geometry')}>New Geometry Code</button>
          <button on:click={() => openCreateFromContext('folder')}>New Folder</button>
        {:else if contextMenu.entry.type === 'file' && /\.(py|gd)$/i.test(contextMenu.entry.name)}
          <button on:click={() => handleConvertSourceToGeometry(contextMenu.entry)}>Convert to Geometry Code (.gcn)</button>
        {/if}
        {#if contextMenu.entry.path !== project?.rootPath}
          <button class="danger" on:click={() => askDelete(contextMenu.entry)}>Delete {contextMenu.entry.type}</button>
        {/if}
      </div>
    {/if}

    {#if tabMenu}
      {@const pane = panes.find((p) => p.id === tabMenu.paneId)}
      {@const tab = pane?.tabs.find((t) => t.id === tabMenu.tabId)}
      {@const isSoleFloating = Boolean(pane?.floating && pane?.tabs.length === 1)}
      {#if tab}
        <div class="context-menu" style="left: {tabMenu.x}px; top: {tabMenu.y}px">
          <div class="context-title">{tab.file?.name ?? 'Untitled'}</div>
          <button
            disabled={isSoleFloating}
            title={isSoleFloating ? 'Already floating' : ''}
            on:click={() => { floatTab(tabMenu.paneId, tabMenu.tabId); tabMenu = null; }}
          >Float</button>
        </div>
      {/if}
    {/if}

    {#if deleteTarget}
      <div class="modal-backdrop" role="presentation" on:click={() => (deleteTarget = null)}>
        <div class="modal" role="dialog" aria-label="Confirm delete">
          <h2>Delete {deleteTarget.type}?</h2>
          <p>This permanently removes <strong>{deleteTarget.relativePath}</strong>{deleteTarget.type === 'folder' ? ' and everything inside it' : ''}.</p>
          {#if panes.some(p => p.tabs.some(tab => tab.kind === 'geometry' && tab.file?.path && isSameOrDescendant(tab.file.path, deleteTarget.path) && isTabDirty(tab)))}
            <p class="gcn-var-error">This file has unsaved changes. Deleting it permanently discards them.</p>
          {/if}
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
          <h2>{createDialog === 'geometry-save' ? 'Save Geometry Code' : `Create ${createDialog === 'note' ? 'note' : createDialog === 'geometry' ? 'Geometry Code' : createDialog}`}</h2>
          <p>Path inside <strong>{createParent?.relativePath ?? project?.tree.name}</strong></p>
          <input bind:this={createInput} bind:value={createPath} disabled={createBusy} placeholder={createDialog === 'folder' ? 'src/components' : createDialog === 'note' ? 'notes/my-note.md' : createDialog.startsWith('geometry') ? 'logic.gcn' : 'src/example.js'} />
          <div class="modal-actions">
            <button type="button" on:click={() => closeCreateDialog()} disabled={createBusy}>Cancel</button>
            <button class="primary" type="submit" disabled={createBusy}>{createDialog === 'geometry-save' ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    {/if}

    {#if geometryConfirmDialog}
      <div class="modal-backdrop" role="presentation">
        <div class="modal" role="dialog" aria-label={geometryConfirmDialog.title}>
          <h2>{geometryConfirmDialog.title}</h2>
          <p>{geometryConfirmDialog.message}</p>
          {#if geometryConfirmDialog.hasDrafts}
            <p class="gcn-var-error">Some fields have invalid input (draft). Fix them before saving.</p>
          {/if}
          <div class="modal-actions">
            <button type="button" on:click={() => handleGeometryConfirmChoice('cancel')}>Cancel</button>
            <button type="button" class="danger" on:click={() => handleGeometryConfirmChoice('discard')}>Don't Save</button>
            <button type="button" class="primary" on:click={() => handleGeometryConfirmChoice('save')} disabled={geometryConfirmDialog.hasDrafts}>Save</button>
          </div>
        </div>
      </div>
    {/if}

    {#if paletteOpen}
      <div class="palette-backdrop" role="presentation" on:click={closePalette} on:keydown={(event) => event.key === 'Escape' && closePalette()}>
        <div class="palette" role="dialog" tabindex="-1" aria-label="Command palette" on:click|stopPropagation on:keydown|stopPropagation>
          <input bind:this={paletteInput} bind:value={query} placeholder="Search files or type a command..." />
          <button on:click={() => { paletteOpen = false; handleNewGeometryCode(); }}>+ New Geometry Code (.gcn)</button>
          <button on:click={() => { paletteOpen = false; showPreferences = true; }}>⚙ Preferences: Color Theme, Fonts & Syntax</button>
          <button on:click={() => { paletteOpen = false; setTheme('structs'); }}>Theme: Structs Teal (Indie Sci-Fi)</button>
          <button on:click={() => { paletteOpen = false; setTheme('obsidian'); }}>Theme: Obsidian Dark</button>
          <button on:click={() => { paletteOpen = false; setTheme('cream'); }}>Theme: Cream Light</button>
          <button on:click={() => { paletteOpen = false; setTheme('cyberpunk'); }}>Theme: Cyberpunk Neon</button>
          <button on:click={toggleGraph}>Toggle graph</button>
          <button on:click={() => (graphFloating = !graphFloating)}>{graphFloating ? 'Dock graph' : 'Float graph'}</button>
          <button on:click={detachGraph}>Detach graph to separate window</button>
          <button on:click={() => addPane(false)}>Add editor window</button>
          <button on:click={() => addPane(true)}>Add floating editor window</button>
          <button on:click={() => detachPane(activePaneId)} disabled={paneHasGeometry(panes.find(p => p.id === activePaneId))}>Detach active editor to separate window</button>
          <button on:click={toggleSplit}>Toggle split editor</button>
          <button on:click={() => togglePaneFloat(activePaneId)}>Float / Dock current editor</button>
          <button on:click={toggleTerminal}>Toggle terminal</button>
          <button on:click={() => (terminalFloating = !terminalFloating)}>{terminalFloating ? 'Dock terminal' : 'Float terminal'}</button>
          <button on:click={detachTerminal}>Detach terminal to separate window</button>
          <button on:click={() => setTheme(theme === 'cream' ? 'obsidian' : 'cream')}>Toggle theme</button>
          {#each filteredFiles as file (file.path)}
            <button class="result" on:click={() => selectFile(file)}>{file.relativePath}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if showPreferences}
      <PreferencesModal {preferences} currentTheme={theme} on:update={(e) => onPreferencesUpdate(e.detail)} on:close={() => (showPreferences = false)} />
    {/if}
  </div>
{/if}
