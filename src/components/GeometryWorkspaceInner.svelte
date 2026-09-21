<script>
  import { onDestroy, setContext, tick, untrack } from 'svelte';
  import { Background, MarkerType, SvelteFlow, useSvelteFlow, useUpdateNodeInternals } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { nodeDefinitions } from '../core/geometry.js';
  import { generateGeometryCode } from '../core/geometry-codegen.js';
  import {
    addEdge, addNode, addVariable, applyEdit, checkConnection, computePorts, createEditorState, deleteVariable, endEdit,
    getGraphAtScope, moveNodes, positionsFromFlow, redo, removeItems, setLiteralType, setNodeData, setTarget,
    setViewport, setViewportAtScope, undo, updateGraphAtScope, updateVariable, variableUsage,
    addFunctionParameter, updateFunctionParameter, removeFunctionParameter
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

  const flow = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeTypes = { geometry: GeometryNode };

  let editor = $state.raw(createEditorState(untrack(() => initialDocument)));
  let loadedKey = untrack(() => documentKey);
  let scopeStack = $state.raw([]); // Array of { id, label }

  let nodes = $state.raw([]);
  let edges = $state.raw([]);
  let view = $state.raw({ nodes: new Map(), ports: new Map(), diagnostics: new Map(), edgeDiagnostics: new Set(), variables: [] });
  let generated = $state.raw({ code: null, diagnostics: [], sourceMap: [] });
  let drafts = $state.raw({});
  let notice = $state.raw({ text: '', error: false });
  let menu = $state.raw(null);
  let deleting = $state.raw(null);
  let copyResult = $state.raw('');
  let canvasEl;
  let addButton;
  let pointer = null;
  let noticeTimer;

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
  const selectedFunctionNode = $derived(selectedNode && activeGraph.nodes.find((n) => n.id === selectedNode.id && n.type === 'functionDef'));
  const canEnterSelected = $derived(selectedNode && ['functionDef', 'classDef'].includes(activeGraph.nodes.find((n) => n.id === selectedNode.id)?.type));

  function say(text, error = false) {
    clearTimeout(noticeTimer);
    notice = { text, error };
    noticeTimer = setTimeout(() => (notice = { text: '', error: false }), 6000);
  }
  onDestroy(() => clearTimeout(noticeTimer));

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
    const now = next.present;
    refresh();
    if (now !== before) onchange?.(now);
  }

  refresh();

  $effect(() => {
    const key = documentKey;
    if (key === loadedKey) return;
    untrack(() => {
      loadedKey = key;
      editor = createEditorState(initialDocument);
      scopeStack = [];
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
    if (!active) { menu = null; return; }
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
    const targetNode = activeGraph.nodes.find((n) => n.id === nodeId);
    if (!targetNode || !['functionDef', 'classDef'].includes(targetNode.type)) return;
    if (!targetNode.data?.graph) return;

    // Save current viewport
    const currentVp = flow.getViewport();
    const withVp = setViewportAtScope(editor.present, scopePathIds, currentVp);
    editor = { ...editor, present: withVp };

    const label = targetNode.data?.name || (targetNode.type === 'functionDef' ? 'Function' : 'Class');
    scopeStack = [...scopeStack, { id: nodeId, label }];
    refresh();

    tick().then(() => {
      const targetGraph = getGraphAtScope(editor.present, scopeStack.map((s) => s.id));
      if (targetGraph?.viewport) {
        flow.setViewport(targetGraph.viewport);
      }
    });
  }

  function exitTo(scopeIndex) {
    if (scopeIndex === scopeStack.length) return;
    const currentVp = flow.getViewport();
    const withVp = setViewportAtScope(editor.present, scopePathIds, currentVp);
    editor = { ...editor, present: withVp };

    scopeStack = scopeStack.slice(0, scopeIndex);
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

    if (mod && !event.altKey && key === 'z') {
      event.preventDefault();
      setEditor(event.shiftKey ? redo(editor) : undo(editor));
    } else if (mod && !event.altKey && !event.shiftKey && key === 'y') {
      event.preventDefault();
      setEditor(redo(editor));
    } else if (inCanvas && !mod && !event.altKey && event.shiftKey && key === 'a') {
      event.preventDefault();
      openMenu(false);
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
    if (!selectedFunctionNode) return;
    const r = addFunctionParameter(activeGraph, selectedFunctionNode.id);
    if (r) applyScoped(() => r.doc);
  }

  function updateParam(pId, patch) {
    if (!selectedFunctionNode) return;
    const r = updateFunctionParameter(activeGraph, selectedFunctionNode.id, pId, patch);
    if (r) applyScoped(() => r.doc);
  }

  function removeParam(pId) {
    if (!selectedFunctionNode) return;
    const r = removeFunctionParameter(activeGraph, selectedFunctionNode.id, pId);
    if (r) applyScoped(() => r.doc);
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
</script>

<div class="gcn-workspace" hidden={!active} inert={!active} {onkeydown} role="presentation">
  <div class="gcn-toolbar" role="toolbar" aria-label="Geometry Code tools">
    <button bind:this={addButton} onclick={() => openMenu(true)} aria-haspopup="dialog">+ Add Node</button>
    <button onclick={() => setEditor(undo(editor))} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
    <button onclick={() => setEditor(redo(editor))} disabled={!canRedo} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">Redo</button>
    <button onclick={() => flow.fitView({ padding: 0.2, maxZoom: 1.25, duration: 200 })}>Fit View</button>

    {#if canEnterSelected}
      <button class="gcn-enter-toolbar-btn" onclick={() => enterScope(selectedNode.id)} title="Enter Graph (Enter)">
        เข้าไปแก้ไข ⏎
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
    <span class="gcn-notice" class:error={notice.error} role="status" aria-live="polite">{notice.text}</span>
  </div>

  <!-- Breadcrumbs navigation -->
  <nav class="gcn-breadcrumbs" aria-label="Graph hierarchy">
    <button type="button" class="gcn-crumb" class:active={scopeStack.length === 0} onclick={() => exitTo(0)}>
      Module
    </button>
    {#each scopeStack as item, idx}
      <span class="gcn-crumb-sep">/</span>
      <button type="button" class="gcn-crumb" class:active={idx === scopeStack.length - 1} onclick={() => exitTo(idx + 1)}>
        {item.label}
      </button>
    {/each}
  </nav>

  <div class="gcn-body">
    <div class="gcn-canvas" bind:this={canvasEl} tabindex="-1" aria-label="Geometry Code graph canvas" role="application"
      onpointerdowncapture={(e) => { if (!typing(e.target)) canvasEl.focus({ preventScroll: true }); }}
      onpointermove={(e) => (pointer = { x: e.clientX, y: e.clientY })}
      onpointerleave={() => (pointer = null)}>
      <SvelteFlow bind:nodes bind:edges {nodeTypes} colorMode={theme === 'cream' ? 'light' : 'dark'}
        deleteKey={[]} minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }} edgesReconnectable={false} autoPanOnNodeFocus={false}
        isValidConnection={(c) => checkConnection(activeGraph, c).ok} onbeforeconnect={connect} onconnectend={connectEnd}
        onnodedragstop={({ nodes: dragged }) => commitPositions(dragged)}
        onselectiondragstop={(_e, dragged) => commitPositions(dragged)}
        onmoveend={(_e, viewport) => applyScoped((g) => ({ ...g, viewport }))}>
        <Background />
      </SvelteFlow>
    </div>

    <aside class="gcn-side" aria-label="Geometry Code panels">
      {#if selectedFunctionNode}
        <section aria-labelledby="gcn-params">
          <div class="gcn-section-head">
            <h3 id="gcn-params">Parameters ({selectedFunctionNode.data?.name || 'func'})</h3>
            <button onclick={addParam}>+ Parameter</button>
          </div>
          {#each (selectedFunctionNode.data?.parameters || []) as p (p.id)}
            <div class="gcn-param-row">
              <input value={p.name} placeholder="param_name" spellcheck="false"
                oninput={(e) => updateParam(p.id, { name: e.currentTarget.value })} />
              <select value={p.type || 'any'} onchange={(e) => updateParam(p.id, { type: e.currentTarget.value })}>
                <option value="any">any</option>
                <option value="int">int</option>
                <option value="float">float</option>
                <option value="string">string</option>
                <option value="bool">bool</option>
              </select>
              <button onclick={() => removeParam(p.id)} aria-label={`Remove parameter ${p.name}`}>×</button>
            </div>
          {:else}
            <p class="gcn-empty">No parameters.</p>
          {/each}
        </section>
      {/if}

      <section aria-labelledby="gcn-vars">
        <div class="gcn-section-head">
          <h3 id="gcn-vars">Variables</h3>
          <button onclick={() => applyScoped((g) => addVariable(g).doc)}>+ Variable</button>
        </div>
        {#each activeGraph.variables as variable (variable.id)}
          <div class="gcn-var">
            <div class="gcn-var-row">
              <input aria-label="Variable name" value={variable.name} spellcheck="false"
                oninput={(e) => applyScoped((g) => updateVariable(g, variable.id, { name: e.currentTarget.value }), true)} onblur={finishEdit} />
              <select aria-label="Variable type" value={variable.type} onchange={(e) => applyScoped((g) => updateVariable(g, variable.id, { type: e.currentTarget.value }))}>
                {#each ['int', 'float', 'string', 'bool'] as type}<option value={type}>{type}</option>{/each}
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
              {:else}
                <label class="gcn-check"><input type="checkbox" checked={variable.initialValue}
                  onchange={(e) => applyScoped((g) => updateVariable(g, variable.id, { initialValue: e.currentTarget.checked }))} /> {variable.initialValue ? 'true' : 'false'}</label>
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
      </section>

      <section aria-labelledby="gcn-diag">
        <div class="gcn-section-head">
          <h3 id="gcn-diag">Diagnostics</h3>
          <span class="gcn-count">{errors.length} error{errors.length === 1 ? '' : 's'}</span>
        </div>
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
      </section>

      <section aria-labelledby="gcn-code" class="gcn-preview">
        <div class="gcn-section-head">
          <h3 id="gcn-code">Code Preview</h3>
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
  </div>

  {#if menu}
    <GeometryAddMenu x={menu.x} y={menu.y} onpick={pick} onclose={closeMenu} />
  {/if}
</div>
