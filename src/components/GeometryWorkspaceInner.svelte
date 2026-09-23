<script module>
  import { sameContent } from '../core/geometry-editor.js';
  const historyStore = new Map();
  const MAX_HISTORY_ENTRIES = 20;

  function persistHistory(key, ed, stack) {
    if (!key || !ed) return;
    if (historyStore.has(key)) historyStore.delete(key);
    historyStore.set(key, { editor: ed, scopeStack: stack });
    while (historyStore.size > MAX_HISTORY_ENTRIES) {
      const oldestKey = historyStore.keys().next().value;
      historyStore.delete(oldestKey);
    }
  }
</script>

<script>
  import { onDestroy, onMount, setContext, tick, untrack } from 'svelte';
  import { Background, MarkerType, SvelteFlow, useSvelteFlow, useUpdateNodeInternals } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { nodeDefinitions } from '../core/geometry.js';
  import { generateGeometryCode } from '../core/geometry-codegen.js';
  import { nodeHelp } from '../core/node-help.js';
  import { THEME_PRESETS } from '../core/preferences.js';
  import {
    addEdge, addNode, addVariable, applyEdit, cancelEdit, checkConnection, computePorts, copyFragment, createEditorState,
    deleteVariable, duplicateNodes, endEdit, getGraphAtScope, moveNodes, pasteFragment, positionsFromFlow, redo,
    removeItems, setLiteralType, setNodeData, setTarget, setViewport, setViewportAtScope, undo, updateGraphAtScope,
    updateVariable, variableUsage, addFunctionParameter, updateFunctionParameter, removeFunctionParameter
  } from '../core/geometry-editor.js';
  import CodeEditor from './CodeEditor.svelte';
  import GeometryAddMenu from './GeometryAddMenu.svelte';
  import GeometryField from './GeometryField.svelte';
  import GeometryNode from './GeometryNode.svelte';

  let {
    document: initialDocument,
    documentKey,
    active = true,
    theme,
    preferences,
    showLineNumbers = true,
    onchange,
    ondraftchange,
    filePath = null,
    dirty = false,
    onexport,
    onrun = null,
    onstop = null,
    isRunning = false
  } = $props();

  const uid = $props.id();
  const flow = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeTypes = { geometry: GeometryNode };

  const startKey = untrack(() => documentKey);
  const savedOnStart = startKey ? historyStore.get(startKey) : null;
  let initialEditorState;
  if (savedOnStart && sameContent(savedOnStart.editor.present, untrack(() => initialDocument))) {
    initialEditorState = { ...savedOnStart.editor, present: untrack(() => initialDocument) };
  } else {
    initialEditorState = createEditorState(untrack(() => initialDocument));
  }
  let editor = $state.raw(initialEditorState);
  let loadedKey = untrack(() => documentKey);
  let scopeStack = $state.raw(savedOnStart ? savedOnStart.scopeStack || [] : []);

  let nodes = $state.raw([]);
  let edges = $state.raw([]);
  let view = $state.raw({ nodes: new Map(), ports: new Map(), diagnostics: new Map(), edgeDiagnostics: new Set(), variables: [] });
  let generated = $state.raw({ code: null, diagnostics: [], sourceMap: [] });
  let drafts = $state.raw({});
  let notice = $state.raw({ text: '', error: false });
  let menu = $state.raw(null);
  let deleting = $state.raw(null);
  let copyResult = $state.raw('');
  let grab = $state.raw(null);
  let suppressNextContextMenu = false;
  let canvasEl = $state();
  let addButton = $state();
  let pointer = null;
  let noticeTimer;
  const savedLayout = (() => {
    try { return JSON.parse(localStorage.getItem('nizyla.gcnLayout') || '{}'); } catch { return {}; }
  })();
  let gcnLayout = $state({ side: savedLayout.side ?? 360, details: savedLayout.details ?? 260, panelVisible: savedLayout.panelVisible ?? true });
  let collapsed = $state({ help: false, variables: false, parameters: false, diagnostics: false, ...(savedLayout.collapsed || {}) });
  let codeLineNumbers = $state(savedLayout.codeLineNumbers ?? true);
  let resizing = null;

  let helpSectionEl = $state();
  let codeModalNodeId = $state(null);
  let codeDialogEl = $state();
  const codeModalNode = $derived(codeModalNodeId ? activeGraph.nodes.find((n) => n.id === codeModalNodeId && n.type === 'codeNode') : null);

  $effect(() => {
    if (codeModalNodeId && !codeModalNode) {
      codeDialogEl?.close();
      codeModalNodeId = null;
    }
  });

  function openCodeModal(id) {
    codeModalNodeId = id;
    tick().then(() => {
      codeDialogEl?.showModal();
    });
  }

  function showNodeHelp(id) {
    selectOnly([id]);
    collapsed = { ...collapsed, help: false };
    saveGcnLayout();
    tick().then(() => {
      helpSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  const doc = $derived(editor.present);
  const scopePathIds = $derived(scopeStack.map((s) => s.id));
  const activeGraph = $derived(getGraphAtScope(doc, scopePathIds) || doc);
  const draftMessages = $derived(Object.values(drafts));
  const hasDrafts = $derived(draftMessages.length > 0);
  const errors = $derived(generated.diagnostics.filter((d) => d.severity === 'error'));
  const canUndo = $derived(editor.past.length > 0 || !!editor.pending);
  const canRedo = $derived(editor.future.length > 0);
  const canCopy = $derived(!!generated.code && !hasDrafts);
  const canRun = $derived(!isRunning && !hasDrafts && errors.length === 0 && doc.target === 'python');
  const previewFile = $derived(doc.target === 'python' ? { name: 'generated.py', path: 'generated.py' } : { name: 'generated.gd', path: 'generated.gd' });

  const selectedNode = $derived(nodes.find((n) => n.selected));
  const selectedNodes = $derived(nodes.filter((n) => n.selected));
  const isSingleNodeSelected = $derived(selectedNodes.length === 1);
  const singleSelectedNode = $derived(isSingleNodeSelected ? activeGraph.nodes.find((n) => n.id === selectedNodes[0].id) : null);
  const singleSelectedDef = $derived(singleSelectedNode ? nodeDefinitions[singleSelectedNode.type] : null);
  const singleSelectedHelp = $derived(singleSelectedNode ? nodeHelp[singleSelectedNode.type] : null);
  const singleSelectedPorts = $derived(singleSelectedNode ? (view.ports.get(singleSelectedNode.id) || []) : []);
  const selectedFunctionNode = $derived(selectedNode && activeGraph.nodes.find((n) => n.id === selectedNode.id && n.type === 'functionDef'));
  const canEnterSelected = $derived(selectedNode && ['functionDef', 'classDef'].includes(activeGraph.nodes.find((n) => n.id === selectedNode.id)?.type));

  function getEnclosingFunction(d, pathIds) {
    for (let i = pathIds.length - 1; i >= 0; i--) {
      const parentGraph = getGraphAtScope(d, pathIds.slice(0, i)) || d;
      const n = parentGraph.nodes?.find((node) => node.id === pathIds[i]);
      if (n && n.type === 'functionDef') {
        return { node: n, scope: pathIds.slice(0, i) };
      }
    }
    return null;
  }

  const currentFunction = $derived(
    (selectedFunctionNode ? { node: selectedFunctionNode, scope: scopePathIds } : null) ||
    getEnclosingFunction(doc, scopePathIds)
  );
  const currentFunctionNode = $derived(currentFunction?.node ?? null);
  const functionParameters = $derived(currentFunctionNode?.data?.parameters || []);

  function getAllFunctions(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return [];
    const funcs = [];
    for (const n of graph.nodes) {
      if (n.type === 'functionDef') funcs.push(n);
      if (n.type === 'classDef' && n.data?.graph) funcs.push(...getAllFunctions(n.data.graph));
    }
    return funcs;
  }

  const availableFunctions = $derived(getAllFunctions(doc));

  function say(text, error = false) {
    clearTimeout(noticeTimer);
    notice = { text, error };
    noticeTimer = setTimeout(() => (notice = { text: '', error: false }), 6000);
  }

  function onwindowblur() {
    if (grab) cancelGrab();
  }

  function onwindowcontextmenu(e) {
    if (suppressNextContextMenu) {
      e.preventDefault();
      suppressNextContextMenu = false;
    }
  }

  function onwindowpointerdowncapture(e) {
    if (grab && canvasEl && !canvasEl.contains(e.target)) {
      placeGrab();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onwindowblur);
    window.addEventListener('contextmenu', onwindowcontextmenu, { capture: true });
    window.addEventListener('pointerdown', onwindowpointerdowncapture, { capture: true });
  }

  onMount(() => {
    ondraftchange?.(false, {});
  });

  onDestroy(() => {
    const finalEditor = endEdit(editor);
    persistHistory(documentKey, finalEditor, scopeStack);
    clearTimeout(noticeTimer);
    window.removeEventListener('pointermove', resizePanels);
    window.removeEventListener('pointerup', stopResizePanels);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', onwindowblur);
      window.removeEventListener('contextmenu', onwindowcontextmenu, { capture: true });
      window.removeEventListener('pointerdown', onwindowpointerdowncapture, { capture: true });
    }
  });

  function saveGcnLayout() {
    try { localStorage.setItem('nizyla.gcnLayout', JSON.stringify({ ...gcnLayout, collapsed, codeLineNumbers })); } catch (_) {}
  }

  function toggleSidePanel() {
    gcnLayout = { ...gcnLayout, panelVisible: !gcnLayout.panelVisible };
    saveGcnLayout();
  }

  function startPanelResize(event, type) {
    event.preventDefault();
    resizing = { type, startX: event.clientX, startY: event.clientY, ...gcnLayout };
    document.body.classList.add(type === 'side' ? 'resizing-col' : 'resizing-row');
    window.addEventListener('pointermove', resizePanels);
    window.addEventListener('pointerup', stopResizePanels, { once: true });
  }

  function resizePanels(event) {
    if (!resizing) return;
    const bodyRect = canvasEl?.closest('.gcn-body')?.getBoundingClientRect();
    if (resizing.type === 'side') {
      const width = bodyRect?.width ?? window.innerWidth;
      gcnLayout = { ...gcnLayout, side: Math.max(280, Math.min(width - 240 - 6, resizing.side - (event.clientX - resizing.startX))) };
    } else {
      const sideHeight = canvasEl?.closest('.gcn-body')?.querySelector('.gcn-side')?.clientHeight ?? 600;
      gcnLayout = { ...gcnLayout, details: Math.max(120, Math.min(sideHeight - 180, resizing.details + (event.clientY - resizing.startY))) };
    }
  }

  function stopResizePanels() {
    saveGcnLayout();
    resizing = null;
    document.body.classList.remove('resizing-col', 'resizing-row');
    window.removeEventListener('pointermove', resizePanels);
  }

  function nudgePanel(type, delta) {
    if (type === 'side') gcnLayout = { ...gcnLayout, side: Math.max(280, Math.min(720, gcnLayout.side + delta)) };
    else gcnLayout = { ...gcnLayout, details: Math.max(120, Math.min(520, gcnLayout.details + delta)) };
    saveGcnLayout();
  }

  function togglePanel(name) {
    collapsed = { ...collapsed, [name]: !collapsed[name] };
    saveGcnLayout();
  }

  function resetLayout() {
    gcnLayout = { side: 360, details: 260, panelVisible: true };
    collapsed = { help: false, variables: false, parameters: false, diagnostics: false };
    codeLineNumbers = true;
    saveGcnLayout();
  }

  function refresh() {
    const d = editor.present;
    let result;
    try {
      result = generateGeometryCode(d, d.target);
    } catch (error) {
      result = { code: null, diagnostics: [{ severity: 'error', code: 'internal', message: `Could not generate code: ${error.message}` }], sourceMap: [] };
    }
    generated = result;
    copyResult = '';

    const currentGraph = getGraphAtScope(d, scopePathIds) || d;
    const diagnostics = new Map();
    const edgeDiagnostics = new Set();
    for (const item of result.diagnostics) {
      if (item.nodeId) diagnostics.set(item.nodeId, [...(diagnostics.get(item.nodeId) ?? []), item]);
      if (item.edgeId) edgeDiagnostics.add(item.edgeId);
    }
    view = {
      nodes: new Map(currentGraph.nodes.map((n) => [n.id, n])),
      ports: computePorts(currentGraph),
      diagnostics,
      edgeDiagnostics,
      variables: currentGraph.variables
    };
    syncFlow();
  }

  function syncFlow() {
    const currentGraph = activeGraph;
    const previousNodes = new Map(nodes.map((n) => [n.id, n]));
    nodes = (currentGraph.nodes || []).map((g) => {
      const old = previousNodes.get(g.id);
      if (old && old.position.x === g.position.x && old.position.y === g.position.y) return old;
      return { ...(old ?? { id: g.id, type: 'geometry', data: {}, selected: false }), position: { x: g.position.x, y: g.position.y } };
    });
    const previousEdges = new Map(edges.map((e) => [e.id, e]));
    edges = (currentGraph.edges || []).map((e) => {
      const sourceKind = view.ports.get(e.source)?.find((p) => p.id === e.sourceHandle)?.kind;
      const cls = `gcn-edge-${sourceKind ?? 'value'}${view.edgeDiagnostics.has(e.id) ? ' gcn-edge-error' : ''}`;
      return { id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle,
        selected: !!previousEdges.get(e.id)?.selected, class: cls, ...(sourceKind === 'exec' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}) };
    });
  }

  function setEditor(next) {
    const before = editor.present;
    editor = next;
    persistHistory(documentKey, next, scopeStack);
    const now = next.present;
    refresh();
    if (now !== before) onchange?.(now);
  }

  refresh();

  $effect(() => {
    const key = documentKey;
    if (key === loadedKey) return;
    untrack(() => {
      if (grab) cancelGrab();
      loadedKey = key;
      const saved = key ? historyStore.get(key) : null;
      if (saved && sameContent(saved.editor.present, initialDocument)) {
        editor = { ...saved.editor, present: initialDocument };
        scopeStack = saved.scopeStack || [];
      } else {
        editor = createEditorState(initialDocument);
        scopeStack = [];
      }
      drafts = {};
      ondraftchange?.(false, {});
      menu = null;
      deleting = null;
      nodes = [];
      edges = [];
      refresh();
      flow.setViewport(editor.present.viewport);
    });
  });

  $effect(() => {
    if (!active) {
      if (grab) cancelGrab();
      menu = null;
      return;
    }
    tick().then(() => requestAnimationFrame(() => untrack(() => updateNodeInternals([...view.nodes.keys()]))));
  });

  // ---- edits -----------------------------------------------------------------------------------

  const apply = (next, live = false) => next && setEditor(applyEdit(editor, next, live));
  const finishEdit = () => setEditor(endEdit(editor));

  function applyScoped(updateFn, live = false) {
    const nextDoc = updateGraphAtScope(editor.present, scopePathIds, updateFn);
    apply(nextDoc, live);
  }

  function setDraft(key, message) {
    if (!message && !(key in drafts)) return;
    const next = { ...drafts };
    if (message) next[key] = message; else delete next[key];
    drafts = next;
    ondraftchange?.(Object.keys(next).length > 0, next);
  }

  function setData(id, patch, live = false) {
    const result = setNodeData(activeGraph, id, patch);
    if (!result) return;
    if (result.removedEdges.length) {
      const names = result.removedEdges.map((e) => e.target === id ? e.targetHandle : e.sourceHandle).join(', ');
      say(`Removed wire${result.removedEdges.length > 1 ? 's' : ''} on port ${names}: port no longer exists. Undo restores it.`);
    }
    applyScoped(() => result.doc, live);
  }

  function enterScope(nodeId) {
    if (grab) cancelGrab();
    const targetNode = activeGraph.nodes.find((n) => n.id === nodeId);
    if (!targetNode || !['functionDef', 'classDef'].includes(targetNode.type)) return;
    if (!targetNode.data?.graph) return;

    // Save current viewport
    const currentVp = flow.getViewport();
    const withVp = setViewportAtScope(editor.present, scopePathIds, currentVp);
    editor = { ...editor, present: withVp };

    const label = targetNode.data?.name || (targetNode.type === 'functionDef' ? 'Function' : 'Class');
    scopeStack = [...scopeStack, { id: nodeId, label }];
    persistHistory(documentKey, editor, scopeStack);
    refresh();

    tick().then(() => {
      const targetGraph = getGraphAtScope(editor.present, scopeStack.map((s) => s.id));
      if (targetGraph?.viewport) {
        flow.setViewport(targetGraph.viewport);
      }
    });
  }

  function exitTo(scopeIndex) {
    if (grab) cancelGrab();
    if (scopeIndex === scopeStack.length) return;
    const currentVp = flow.getViewport();
    const withVp = setViewportAtScope(editor.present, scopePathIds, currentVp);
    editor = { ...editor, present: withVp };

    scopeStack = scopeStack.slice(0, scopeIndex);
    persistHistory(documentKey, editor, scopeStack);
    refresh();

    tick().then(() => {
      const targetGraph = getGraphAtScope(editor.present, scopeStack.map((s) => s.id)) || editor.present;
      if (targetGraph?.viewport) {
        flow.setViewport(targetGraph.viewport);
      }
    });
  }

  setContext('gcn', {
    get view() { return view; },
    get parameters() { return functionParameters; },
    get availableFunctions() { return availableFunctions; },
    get isRoot() { return scopePathIds.length === 0; },
    get target() { return doc.target; },
    get theme() { return theme; },
    get preferences() { return preferences; },
    get codeLineNumbers() { return codeLineNumbers; },
    toggleCodeLineNumbers: () => { codeLineNumbers = !codeLineNumbers; saveGcnLayout(); },
    openCode: (id) => openCodeModal(id),
    showHelp: (id) => showNodeHelp(id),
    describe: (item) => describe(item),
    setData,
    setLiteralType: (id, type) => {
      const r = setLiteralType(activeGraph, id, type);
      if (r) applyScoped(() => r.doc);
    },
    endEdit: finishEdit,
    setDraft,
    enterScope
  });

  function selectOnly(nodeIds = [], edgeIds = []) {
    nodes = nodes.map((n) => !!n.selected === nodeIds.includes(n.id) ? n : { ...n, selected: nodeIds.includes(n.id) });
    edges = edges.map((e) => !!e.selected === edgeIds.includes(e.id) ? e : { ...e, selected: edgeIds.includes(e.id) });
  }

  function commitPositions(dragged) {
    const rounded = Object.fromEntries(Object.entries(positionsFromFlow(dragged)).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
    const next = moveNodes(activeGraph, rounded);
    if (next) applyScoped(() => next);
    else syncFlow();
  }

  function deleteSelection() {
    const nodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const edgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    const next = removeItems(activeGraph, { nodeIds, edgeIds });
    if (!next) { if (nodeIds.length) say('The Start node cannot be deleted.'); return; }
    applyScoped(() => next);
    canvasEl?.focus();
  }

  function placeGrab() {
    if (!grab) return;
    const ids = grab.ids;
    const positions = {};
    for (const id of ids) {
      const n = nodes.find((node) => node.id === id);
      if (n) {
        positions[id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      }
    }
    grab = null;
    if (notice.text === 'Move to place · Click / Enter = place · Esc / Right-click = cancel') {
      notice = { text: '', error: false };
    }
    const nextGraph = moveNodes(activeGraph, positions);
    if (nextGraph) {
      applyScoped(() => nextGraph, true);
    }
    finishEdit();
    canvasEl?.focus();
  }

  function cancelGrab() {
    if (!grab) return;
    const originalIds = grab.originalIds;
    grab = null;
    if (notice.text === 'Move to place · Click / Enter = place · Esc / Right-click = cancel') {
      notice = { text: '', error: false };
    }
    setEditor(cancelEdit(editor));
    selectOnly(originalIds);
    canvasEl?.focus();
  }

  async function duplicateSelection() {
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
    if (!selectedIds.length) return;
    const nonStartIds = selectedIds.filter((id) => activeGraph.nodes.find((n) => n.id === id)?.type !== 'start');
    if (!nonStartIds.length) {
      say('The Start node cannot be duplicated.');
      return;
    }

    if (!pointer) {
      const result = duplicateNodes(activeGraph, nonStartIds, { x: 40, y: 40 });
      if (!result) return;
      applyScoped(() => result.doc);
      await tick();
      selectOnly(result.nodeIds);
      canvasEl?.focus();
      return;
    }

    finishEdit();
    const result = duplicateNodes(activeGraph, nonStartIds, { x: 0, y: 0 });
    if (!result) return;
    applyScoped(() => result.doc, true);
    await tick();
    selectOnly(result.nodeIds);
    const copyNodes = result.doc.nodes.filter((n) => result.nodeIds.includes(n.id));
    const origins = Object.fromEntries(copyNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    grab = {
      ids: result.nodeIds,
      originalIds: nonStartIds,
      origins,
      startFlow: flow.screenToFlowPosition(pointer)
    };
    say('Move to place · Click / Enter = place · Esc / Right-click = cancel');
    canvasEl?.focus();
  }

  function getAccessibleVariables() {
    const vars = [...(activeGraph.variables || [])];
    for (let i = scopePathIds.length - 1; i >= 0; i--) {
      const enclosing = getGraphAtScope(doc, scopePathIds.slice(0, i));
      if (enclosing?.variables) {
        vars.push(...enclosing.variables);
      }
    }
    return vars;
  }

  async function copySelection() {
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const nonStartIds = selectedIds.filter((id) => activeGraph.nodes.find((n) => n.id === id)?.type !== 'start');
    if (!nonStartIds.length) return false;
    const text = copyFragment(activeGraph, nonStartIds, getAccessibleVariables());
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied ${nonStartIds.length} node${nonStartIds.length === 1 ? '' : 's'}`);
      return true;
    } catch (err) {
      say(`Copy failed: ${err?.message ?? 'clipboard unavailable'}`, true);
      return true;
    }
  }

  async function pasteSelection() {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      say(`Paste failed: ${err?.message ?? 'clipboard unavailable'}`, true);
      return;
    }
    if (!text) return;

    const box = canvasEl.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const anchorScreen = pointer ?? center;
    const anchorFlow = flow.screenToFlowPosition(anchorScreen);

    let result;
    try {
      result = pasteFragment(activeGraph, text, anchorFlow, getAccessibleVariables());
    } catch (err) {
      console.error(err);
      say(`Paste failed: ${err?.message ?? 'unexpected error'}`, true);
      return;
    }

    if (!result) return; // Non-.gcn text stays a silent no-op
    if (result.error) {
      say(result.error, true);
      return;
    }
    if (!result.nodeIds.length) return;

    applyScoped(() => result.doc);
    await tick();
    selectOnly(result.nodeIds);
    const varCount = result.addedVariableIds?.length ?? 0;
    const nodeCount = result.nodeIds.length;
    const varMsg = varCount > 0 ? ` (+${varCount} variable${varCount === 1 ? '' : 's'})` : '';
    say(`Pasted ${nodeCount} node${nodeCount === 1 ? '' : 's'}${varMsg}`);
    canvasEl?.focus();
  }

  function connect(connection) {
    const result = addEdge(activeGraph, connection);
    if (result.error) say(result.error, true);
    else applyScoped(() => result.doc);
    return false;
  }

  function connectEnd(_event, state) {
    if (!state.toHandle || state.isValid) return;
    const fromSource = state.fromHandle.type === 'source';
    const [from, to] = fromSource ? [state.fromHandle, state.toHandle] : [state.toHandle, state.fromHandle];
    const check = checkConnection(activeGraph, { source: from.nodeId, sourceHandle: from.id, target: to.nodeId, targetHandle: to.id });
    if (!check.ok) say(check.message, true);
  }

  // ---- add-node menu ---------------------------------------------------------------------------

  function openMenu(fromButton) {
    const box = canvasEl.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    if (fromButton) {
      const b = addButton.getBoundingClientRect();
      menu = { x: b.left, y: b.bottom + 4, at: center };
    } else {
      const at = pointer ?? center;
      menu = { x: at.x + 8, y: at.y + 8, at };
    }
  }

  async function pick(presetId) {
    const at = menu.at;
    menu = null;
    const result = addNode(activeGraph, presetId, flow.screenToFlowPosition(at));
    if (!result) return;
    applyScoped(() => result.doc);
    await tick();
    selectOnly([result.nodeId]);
    canvasEl.focus();
  }

  function closeMenu() {
    menu = null;
    canvasEl?.focus();
  }

  // ---- keyboard --------------------------------------------------------------------------------

  const typing = (target) => target instanceof Element
    && !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor');

  function onkeydown(event) {
    if (!active || event.defaultPrevented || typing(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const inCanvas = canvasEl.contains(event.target);

    if (grab) {
      if (event.key === 'Escape' || (mod && (key === 'z' || key === 'y'))) {
        event.preventDefault();
        cancelGrab();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        placeGrab();
        return;
      }
      event.preventDefault();
      return;
    }

    if (mod && !event.altKey && key === 'z') {
      event.preventDefault();
      setEditor(event.shiftKey ? redo(editor) : undo(editor));
    } else if (mod && !event.altKey && !event.shiftKey && key === 'y') {
      event.preventDefault();
      setEditor(redo(editor));
    } else if (inCanvas && mod && !event.altKey && !event.shiftKey && key === 'c') {
      const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
      const nonStartIds = selectedIds.filter((id) => activeGraph.nodes.find((n) => n.id === id)?.type !== 'start');
      if (nonStartIds.length > 0) {
        event.preventDefault();
        copySelection();
      }
    } else if (inCanvas && mod && !event.altKey && !event.shiftKey && key === 'v') {
      event.preventDefault();
      pasteSelection();
    } else if (inCanvas && !mod && !event.altKey && event.shiftKey && key === 'a') {
      event.preventDefault();
      openMenu(false);
    } else if (inCanvas && !mod && !event.altKey && event.shiftKey && key === 'd') {
      event.preventDefault();
      duplicateSelection();
    } else if (inCanvas && !mod && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deleteSelection();
    } else if (inCanvas && !mod && event.key === 'Enter') {
      if (canEnterSelected) {
        event.preventDefault();
        enterScope(selectedNode.id);
      }
    }
  }

  // ---- variables -------------------------------------------------------------------------------

  const friendly = (message) => activeGraph.variables.reduce((text, v) => text.replaceAll(v.id, `"${v.name}"`), message);
  const describe = (item) => item.code === 'missing-variable' ? 'Variable is missing. Choose an existing variable.' : friendly(item.message);
  const variableProblems = (variable) => generated.diagnostics.filter((d) => (d.code === 'invalid-variable-name' && d.message.includes(variable.id))
    || (d.code === 'duplicate-variable-name' && d.message === `Duplicate variable name: ${variable.name}.`));

  function requestDelete(variable) {
    const uses = variableUsage(activeGraph, variable.id);
    if (uses) deleting = { id: variable.id, uses };
    else applyScoped((g) => deleteVariable(g, variable.id));
  }

  function confirmDelete() {
    applyScoped((g) => deleteVariable(g, deleting.id));
    deleting = null;
  }

  // ---- parameters manager ----------------------------------------------------------------------

  function addParam() {
    if (!currentFunction) return;
    const { node: fNode, scope } = currentFunction;
    const nextDoc = updateGraphAtScope(editor.present, scope, (g) => {
      const r = addFunctionParameter(g, fNode.id);
      return r ? r.doc : g;
    });
    apply(nextDoc);
  }

  function updateParam(pId, patch) {
    if (!currentFunction) return;
    const { node: fNode, scope } = currentFunction;
    const nextDoc = updateGraphAtScope(editor.present, scope, (g) => {
      const r = updateFunctionParameter(g, fNode.id, pId, patch);
      return r ? r.doc : g;
    });
    apply(nextDoc);
  }

  function removeParam(pId) {
    if (!currentFunction) return;
    const { node: fNode, scope } = currentFunction;
    const nextDoc = updateGraphAtScope(editor.present, scope, (g) => {
      const r = removeFunctionParameter(g, fNode.id, pId);
      return r ? r.doc : g;
    });
    apply(nextDoc);
  }

  // ---- diagnostics + preview -------------------------------------------------------------------

  const nodeLabel = (id) => {
    const n = activeGraph.nodes.find((n) => n.id === id);
    return n ? `${nodeDefinitions[n.type]?.label || n.type} at ${Math.round(n.position.x)}, ${Math.round(n.position.y)}` : '';
  };

  async function goTo(item) {
    if (item.scopePath && item.scopePath.length > 0) {
      // Scope navigation if error is in another graph
      const targetIds = item.scopePath;
      if (JSON.stringify(targetIds) !== JSON.stringify(scopePathIds)) {
        exitTo(0);
        for (const sid of targetIds) {
          enterScope(sid);
        }
      }
    }
    const nodeId = item.nodeId && view.nodes.has(item.nodeId) ? item.nodeId : null;
    const edgeId = item.edgeId && activeGraph.edges.some((e) => e.id === item.edgeId) ? item.edgeId : null;
    if (!nodeId && !edgeId) return;
    selectOnly(nodeId ? [nodeId] : [], edgeId ? [edgeId] : []);
    if (nodeId) await flow.fitView({ nodes: [{ id: nodeId }], maxZoom: 1.2, padding: 0.6, duration: 250 });
    canvasEl.focus();
  }

  async function copyCode() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      copyResult = 'Copied to clipboard.';
    } catch (error) {
      copyResult = `Copy failed: ${error?.message ?? 'clipboard unavailable'}`;
    }
  }

  function oncanvaspointerdowncapture(e) {
    if (grab) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) {
        placeGrab();
      } else if (e.button === 2) {
        suppressNextContextMenu = true;
        cancelGrab();
      }
      return;
    }
    if (!typing(e.target)) canvasEl.focus({ preventScroll: true });
  }

  function oncanvaspointermove(e) {
    pointer = { x: e.clientX, y: e.clientY };
    if (!grab) return;
    const nowFlow = flow.screenToFlowPosition(pointer);
    const dx = nowFlow.x - grab.startFlow.x;
    const dy = nowFlow.y - grab.startFlow.y;
    nodes = nodes.map((n) => {
      if (!grab.ids.includes(n.id)) return n;
      const orig = grab.origins[n.id];
      if (!orig) return n;
      return { ...n, position: { x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) } };
    });
  }

  function oncanvascontextmenu(e) {
    if (grab || suppressNextContextMenu) {
      e.preventDefault();
      suppressNextContextMenu = false;
    }
  }
</script>

<div class="gcn-workspace" {onkeydown} role="presentation">
  <div class="gcn-toolbar" role="toolbar" aria-label="Geometry Code tools">
    <button bind:this={addButton} onclick={() => openMenu(true)} aria-haspopup="dialog">+ Add Node</button>
    <button onclick={() => setEditor(undo(editor))} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
    <button onclick={() => setEditor(redo(editor))} disabled={!canRedo} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">Redo</button>
    <button onclick={() => flow.fitView({ padding: 0.2, maxZoom: 1.25, duration: 200 })}>Fit View</button>

    {#if canEnterSelected}
      <button class="gcn-enter-toolbar-btn" onclick={() => enterScope(selectedNode.id)} title={selectedFunctionNode ? 'Open function body' : 'Open class body'} aria-label="Open Subgraph">
        Open Subgraph ⏎
      </button>
    {/if}

    {#if doc.target === 'python' && onrun}
      <button class="gcn-run-btn" onclick={onrun} disabled={!canRun} title="Run Python Program">
        ▶ Run
      </button>
      <button class="gcn-stop-btn" onclick={onstop} disabled={!isRunning} title="Stop Running Program">
        ■ Stop
      </button>
    {/if}

    <select aria-label="Target language" value={doc.target} onchange={(e) => apply(setTarget(doc, e.currentTarget.value))}>
      <option value="python">Python</option>
      <option value="gdscript">GDScript</option>
    </select>
    <span class="gcn-file-badge" class:dirty>
      {filePath ? filePath.split(/[/\\]/).pop() : 'Scratch Graph'}{dirty ? ' •' : ''}
    </span>
    <button type="button" class="gcn-panel-toggle" class:active={gcnLayout.panelVisible} onclick={toggleSidePanel} title="Toggle side panel">Panel</button>
    <button type="button" onclick={resetLayout} title="Reset Geometry Code layout">Reset Layout</button>
    <span class="gcn-notice" class:error={notice.error} role="status" aria-live="polite">{notice.text}</span>
  </div>

  <!-- Breadcrumbs navigation -->
  <nav class="gcn-breadcrumbs" aria-label="Graph hierarchy">
    <button type="button" class="gcn-crumb" aria-current={scopeStack.length === 0 ? 'location' : undefined} onclick={() => exitTo(0)}>
      Module
    </button>
    {#each scopeStack as item, idx}
      <span class="gcn-crumb-sep">/</span>
      <button type="button" class="gcn-crumb" aria-current={idx === scopeStack.length - 1 ? 'location' : undefined} onclick={() => exitTo(idx + 1)}>
        {item.label}
      </button>
    {/each}
  </nav>

  <div class="gcn-body" class:no-panel={!gcnLayout.panelVisible} style={`--gcn-side-width: ${gcnLayout.side}px; --gcn-details-height: ${gcnLayout.details}px;`}>
    <div class="gcn-canvas" bind:this={canvasEl} tabindex="-1" aria-label="Geometry Code graph canvas" role="application"
      class:grabbing={!!grab}
      onpointerdowncapture={oncanvaspointerdowncapture}
      onpointermove={oncanvaspointermove}
      onpointerleave={() => { if (!grab) pointer = null; }}
      oncontextmenu={oncanvascontextmenu}>
      <SvelteFlow bind:nodes bind:edges {nodeTypes} colorMode={THEME_PRESETS[theme]?.scheme === 'light' ? 'light' : 'dark'}
        deleteKey={[]} minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }} edgesReconnectable={false} autoPanOnNodeFocus={false}
        isValidConnection={(c) => checkConnection(activeGraph, c).ok} onbeforeconnect={connect} onconnectend={connectEnd}
        onnodedragstop={({ nodes: dragged }) => commitPositions(dragged)}
        onselectiondragstop={(_e, dragged) => commitPositions(dragged)}
        onmoveend={(_e, viewport) => applyScoped((g) => ({ ...g, viewport }))}>
        <Background />
      </SvelteFlow>
    </div>

    {#if gcnLayout.panelVisible}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="gcn-panel-splitter gcn-side-splitter" role="separator" tabindex="0" aria-label="Resize Canvas and right panel" aria-orientation="vertical" onpointerdown={(event) => startPanelResize(event, 'side')} onkeydown={(event) => { if (event.key === 'ArrowLeft') nudgePanel('side', 20); if (event.key === 'ArrowRight') nudgePanel('side', -20); }}></div>

      <aside class="gcn-side" aria-label="Geometry Code panels">
        <div class="gcn-side-details">
        {#if currentFunctionNode}
          <section aria-labelledby={`gcn-params-${uid}`} class:collapsed={collapsed.parameters}>
            <div class="gcn-section-head">
              <button type="button" class="gcn-collapse" aria-expanded={!collapsed.parameters} onclick={() => togglePanel('parameters')}>{collapsed.parameters ? '▸' : '▾'}</button>
              <h3 id={`gcn-params-${uid}`}>Parameters ({currentFunctionNode.data?.name || 'func'})</h3>
              <button onclick={addParam}>+ Parameter</button>
            </div>
            {#if !collapsed.parameters}
            {#each (currentFunctionNode.data?.parameters || []) as p (p.id)}
              <div class="gcn-param-row">
                <input value={p.name} placeholder="param_name" spellcheck="false"
                  oninput={(e) => updateParam(p.id, { name: e.currentTarget.value })} />
                <select value={p.type || 'any'} onchange={(e) => updateParam(p.id, { type: e.currentTarget.value })}>
                  <option value="any">any</option>
                  <option value="int">int</option>
                  <option value="float">float</option>
                  <option value="string">string</option>
                  <option value="bool">bool</option>
                  <option value="list">list</option>
                  <option value="dict">dict</option>
                </select>
                <button onclick={() => removeParam(p.id)} aria-label={`Remove parameter ${p.name}`}>×</button>
              </div>
            {:else}
              <p class="gcn-empty">No parameters.</p>
            {/each}
            {/if}
          </section>
        {/if}

        <section bind:this={helpSectionEl} aria-labelledby={`gcn-help-${uid}`} class:collapsed={collapsed.help}>
          <div class="gcn-section-head">
            <button type="button" class="gcn-collapse" aria-expanded={!collapsed.help} onclick={() => togglePanel('help')}>{collapsed.help ? '▸' : '▾'}</button>
            <h3 id={`gcn-help-${uid}`}>Node Help</h3>
          </div>
          {#if !collapsed.help}
            {#if isSingleNodeSelected && singleSelectedNode && singleSelectedDef && singleSelectedHelp}
              <div class="gcn-help-content">
                <div class="gcn-help-header">
                  <strong>{singleSelectedNode.type === 'codeNode' ? `</> ${singleSelectedNode.data?.title || 'Code'}` : singleSelectedDef.label}</strong>
                  <span class="gcn-category">{singleSelectedDef.category}</span>
                </div>
                <p class="gcn-help-summary">{singleSelectedHelp.summary}</p>
                {#if singleSelectedPorts.length > 0}
                  <ul class="gcn-help-ports">
                    {#each singleSelectedPorts as p (p.id + p.direction)}
                      <li class="gcn-help-port">{p.direction} {p.id} · {p.kind === 'exec' ? 'exec' : p.valueType}</li>
                    {/each}
                  </ul>
                {/if}
                <div class="gcn-help-code">
                  <CodeEditor
                    file={{ name: doc.target === 'gdscript' ? 'help.gd' : 'help.py', path: `gcn-help:${singleSelectedNode.id}.${doc.target === 'gdscript' ? 'gd' : 'py'}` }}
                    content={doc.target === 'gdscript' ? singleSelectedHelp.gdscript : singleSelectedHelp.python}
                    readOnly={true}
                    showLineNumbers={false}
                    {theme}
                    {preferences}
                  />
                </div>
              </div>
            {:else}
              <p class="gcn-empty">Select one node to see what it does.</p>
            {/if}
          {/if}
        </section>

        <section aria-labelledby={`gcn-vars-${uid}`} class:collapsed={collapsed.variables}>
          <div class="gcn-section-head">
            <button type="button" class="gcn-collapse" aria-expanded={!collapsed.variables} onclick={() => togglePanel('variables')}>{collapsed.variables ? '▸' : '▾'}</button>
            <h3 id={`gcn-vars-${uid}`}>Variables</h3>
            <button onclick={() => applyScoped((g) => addVariable(g).doc)}>+ Variable</button>
          </div>
          {#if !collapsed.variables}
          {#each activeGraph.variables as variable (variable.id)}
            <div class="gcn-var">
              <div class="gcn-var-row">
                <input aria-label="Variable name" value={variable.name} spellcheck="false"
                  oninput={(e) => applyScoped((g) => updateVariable(g, variable.id, { name: e.currentTarget.value }), true)} onblur={finishEdit} />
                <select aria-label="Variable type" value={variable.type} onchange={(e) => applyScoped((g) => updateVariable(g, variable.id, { type: e.currentTarget.value }))}>
                  {#each ['int', 'float', 'string', 'bool', 'list', 'dict'] as type}<option value={type}>{type}</option>{/each}
                </select>
                <button onclick={() => requestDelete(variable)} aria-label={`Delete variable ${variable.name}`}>Delete</button>
              </div>
              <div class="gcn-var-row">
                <span class="gcn-label">initial</span>
                {#if variable.type === 'int' || variable.type === 'float'}
                  <GeometryField kind={variable.type} value={variable.initialValue} fieldKey={`var:${variable.id}`} label="Initial value"
                    oncommit={(value) => applyScoped((g) => updateVariable(g, variable.id, { initialValue: value }), true)} onblur={finishEdit} ondraft={setDraft} />
                {:else if variable.type === 'string'}
                  <input aria-label="Initial value" value={variable.initialValue} spellcheck="false"
                    oninput={(e) => applyScoped((g) => updateVariable(g, variable.id, { initialValue: e.currentTarget.value }), true)} onblur={finishEdit} />
                {:else if variable.type === 'bool'}
                  <label class="gcn-check"><input type="checkbox" checked={variable.initialValue}
                    onchange={(e) => applyScoped((g) => updateVariable(g, variable.id, { initialValue: e.currentTarget.checked }))} /> {variable.initialValue ? 'true' : 'false'}</label>
                {:else if variable.type === 'list'}
                  <input aria-label="Initial value" value="[]" readonly disabled style="opacity: 0.7;" />
                {:else if variable.type === 'dict'}
                  <input aria-label="Initial value" value="{'{}'}" readonly disabled style="opacity: 0.7;" />
                {/if}
              </div>
              {#each variableProblems(variable) as problem}<div class="gcn-var-error" role="alert">{friendly(problem.message)}</div>{/each}
              {#if deleting?.id === variable.id}
                <div class="gcn-confirm" role="alertdialog" aria-label="Confirm variable deletion">
                  <span>Used by {deleting.uses} node{deleting.uses === 1 ? '' : 's'}. They will show "Missing variable".</span>
                  <button onclick={confirmDelete}>Delete anyway</button><button onclick={() => (deleting = null)}>Cancel</button>
                </div>
              {/if}
            </div>
          {:else}
            <p class="gcn-empty">No variables.</p>
          {/each}
          {/if}
        </section>

        <section aria-labelledby={`gcn-diag-${uid}`} class:collapsed={collapsed.diagnostics}>
          <div class="gcn-section-head">
            <button type="button" class="gcn-collapse" aria-expanded={!collapsed.diagnostics} onclick={() => togglePanel('diagnostics')}>{collapsed.diagnostics ? '▸' : '▾'}</button>
            <h3 id={`gcn-diag-${uid}`}>Diagnostics</h3>
            <span class="gcn-count">{errors.length} error{errors.length === 1 ? '' : 's'}</span>
          </div>
          {#if !collapsed.diagnostics}
          {#each draftMessages as message}
            <div class="gcn-diag error"><b>Error:</b> Fix invalid input first — {message}</div>
          {/each}
          {#each generated.diagnostics as item}
            {#if item.nodeId || item.edgeId}
              <button class="gcn-diag {item.severity}" onclick={() => goTo(item)}>
                <b>{item.severity === 'error' ? 'Error' : 'Warning'}:</b> {describe(item)}
                {#if item.nodeId}<small>{nodeLabel(item.nodeId)}</small>{/if}
              </button>
            {:else}
              <div class="gcn-diag {item.severity}"><b>{item.severity === 'error' ? 'Error' : 'Warning'}:</b> {describe(item)} <small>Graph</small></div>
            {/if}
          {/each}
          {#if !generated.diagnostics.length && !hasDrafts}<p class="gcn-empty">No problems.</p>{/if}
          {/if}
        </section>
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div class="gcn-panel-splitter gcn-preview-splitter" role="separator" tabindex="0" aria-label="Resize details and Code Preview" aria-orientation="horizontal" onpointerdown={(event) => startPanelResize(event, 'details')} onkeydown={(event) => { if (event.key === 'ArrowUp') nudgePanel('details', -20); if (event.key === 'ArrowDown') nudgePanel('details', 20); }}></div>

        <section aria-labelledby={`gcn-code-${uid}`} class="gcn-preview">
          <div class="gcn-section-head">
            <h3 id={`gcn-code-${uid}`}>Code Preview</h3>
            {#if onexport}
              <button onclick={() => onexport?.()} disabled={!canCopy} title="Export code to file">Export</button>
            {/if}
            <button onclick={copyCode} disabled={!canCopy} title="Copy generated code to clipboard">Copy Code</button>
          </div>
          <div class="gcn-preview-box">
            <CodeEditor file={previewFile} content={canCopy ? generated.code : ''} readOnly={true} {showLineNumbers} {theme} {preferences} />
            {#if !canCopy}
              <div class="gcn-preview-blocked" role="status">
                {hasDrafts ? 'Fix invalid input to see code.' : 'Graph has errors. Fix errors above.'}
              </div>
            {/if}
          </div>
          {#if copyResult}<p class="gcn-copy" role="status">{copyResult}</p>{/if}
        </section>
      </aside>
    {/if}
  </div>

  {#if menu}
    <GeometryAddMenu x={menu.x} y={menu.y} onpick={pick} onclose={closeMenu} />
  {/if}

  <dialog bind:this={codeDialogEl} class="gcn-code-dialog" onclose={() => { finishEdit(); codeModalNodeId = null; canvasEl?.focus(); }}>
    {#if codeModalNode}
      {@const ext = doc.target === 'gdscript' ? 'gd' : 'py'}
      {@const title = codeModalNode.data?.title || 'Code'}
      <div class="gcn-code-dialog-header">
        <h3>&lt;/&gt; {title} · Code</h3>
        <div class="gcn-code-dialog-actions">
          <button type="button" class="gcn-btn-lines" class:active={codeLineNumbers} aria-pressed={codeLineNumbers}
            onclick={() => { codeLineNumbers = !codeLineNumbers; saveGcnLayout(); }} title="Toggle line numbers">#</button>
          <button type="button" class="gcn-btn-close" onclick={() => codeDialogEl?.close()}>Close</button>
        </div>
      </div>
      <div class="gcn-code-dialog-body">
        <CodeEditor
          file={{ name: `node.${ext}`, path: `gcn-code:${codeModalNode.id}.${ext}` }}
          content={codeModalNode.data?.code ?? ''}
          showLineNumbers={codeLineNumbers}
          {theme}
          {preferences}
          onchange={(code) => setData(codeModalNode.id, { code }, true)}
        />
      </div>
    {/if}
  </dialog>
</div>
