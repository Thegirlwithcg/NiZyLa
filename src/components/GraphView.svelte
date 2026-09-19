<script>
  import { createEventDispatcher } from 'svelte';

  export let graph;
  export let activePath = null;
  export let fullscreen = false;
  export let currentFolderId = null;
  export let viewMode = 'folder'; // 'folder' | 'all'

  const dispatch = createEventDispatcher();
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;
  let customPositions = new Map();
  let customEdgeOffsets = new Map(); // edge.id -> { dx, dy }
  let contextMenu = null;

  $: layout = makeLayout(graph, customPositions, currentFolderId, viewMode, customEdgeOffsets);

  function toggleViewMode() {
    viewMode = viewMode === 'folder' ? 'all' : 'folder';
    customPositions = new Map();
    customEdgeOffsets = new Map();
    panX = 0;
    panY = 0;
    zoom = 1;
    dispatch('viewmode', viewMode);
  }

  function isExternalRef(srcId, tgtId) {
    if (!srcId || !tgtId) return false;
    const s = srcId.replace(/\\/g, '/');
    const t = tgtId.replace(/\\/g, '/');
    const sDir = s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : '';
    const tDir = t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : '';
    return sDir !== tDir;
  }

  function makeLayout(input, positions, folderId, mode = 'folder', edgeOffsets = new Map()) {
    if (!input) return { nodes: [], edges: [], width: 640, height: 640, folder: null, parentId: null };

    const byId = new Map(input.nodes.map((node) => [node.id, node]));
    const parentById = new Map(input.edges.filter((edge) => edge.type === 'contains').map((edge) => [edge.target, edge.source]));
    const root = input.nodes.find((node) => node.type === 'folder' && !parentById.has(node.id));
    const activeFolderId = folderId && byId.has(folderId) ? folderId : root?.id;
    const folder = byId.get(activeFolderId) ?? null;

    let visibleNodes;
    if (mode === 'all') {
      // Show all files to display full project inter-file relationships
      visibleNodes = input.nodes.filter((node) => node.type === 'file');
      if (visibleNodes.length === 0) {
        visibleNodes = input.nodes.filter((node) => node.type === 'folder' || node.type === 'file');
      }
    } else {
      // Drill-down view: show this folder's immediate contents
      visibleNodes = input.nodes.filter((node) => parentById.get(node.id) === activeFolderId && (node.type === 'folder' || node.type === 'file'));
    }

    const nodeIds = new Set(visibleNodes.map((node) => node.id));

    // Map descendants to visible node in current folder view
    const visibleAncestor = new Map();
    for (const vNode of visibleNodes) {
      visibleAncestor.set(vNode.id, vNode.id);
    }
    for (const node of input.nodes) {
      if (visibleAncestor.has(node.id)) continue;
      let curr = parentById.get(node.id);
      while (curr && !visibleAncestor.has(curr) && curr !== activeFolderId && parentById.has(curr)) {
        curr = parentById.get(curr);
      }
      if (curr && visibleAncestor.has(curr)) {
        visibleAncestor.set(node.id, curr);
      }
    }

    const visibleEdges = [];
    const seenEdgeKeys = new Set();
    for (const edge of input.edges) {
      if (edge.type === 'contains' || edge.type === 'defines') continue;
      const s = mode === 'all' ? edge.source : (visibleAncestor.get(edge.source) || edge.source);
      const t = mode === 'all' ? edge.target : (visibleAncestor.get(edge.target) || edge.target);
      if (s && t && s !== t && nodeIds.has(s) && nodeIds.has(t)) {
        const dedupKey = `${s}->${t}:${edge.type}:${edge.label || ''}`;
        const isExternal = isExternalRef(edge.source, edge.target);
        if (!seenEdgeKeys.has(dedupKey)) {
          seenEdgeKeys.add(dedupKey);
          visibleEdges.push({
            ...edge,
            source: s,
            target: t,
            isExternal
          });
        }
      }
    }

    const width = fullscreen ? 1400 : 760;
    const height = fullscreen ? 900 : 680;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;

    const nodes = visibleNodes.map((node, index) => {
      const saved = positions.get(node.id);
      const angle = (Math.PI * 2 * index) / Math.max(visibleNodes.length, 1);
      const relCount = visibleEdges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
      return {
        ...node,
        x: saved?.x ?? centerX + Math.cos(angle) * (radius + relCount * 5),
        y: saved?.y ?? centerY + Math.sin(angle) * (radius + relCount * 5),
        vx: 0,
        vy: 0,
        z: saved?.z ?? Math.sin(index * 2.399) * 48,
        pinned: Boolean(saved),
        size: node.type === 'folder' ? 20 : Math.min(18, 7 + relCount * 2)
      };
    });

    const positionedById = new Map(nodes.map((node) => [node.id, node]));

    // In folder mode, detect external relationships from outside this folder
    // and create external dashed stubs pointing into the receiving nodes
    if (mode === 'folder') {
      const extIncomingByTarget = new Map();

      for (const edge of input.edges) {
        if (edge.type === 'contains' || edge.type === 'defines') continue;
        if (!nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
          if (!extIncomingByTarget.has(edge.target)) extIncomingByTarget.set(edge.target, []);
          extIncomingByTarget.get(edge.target).push(edge);
        }
      }

      for (const [targetId, extEdges] of extIncomingByTarget.entries()) {
        const targetNode = positionedById.get(targetId);
        if (!targetNode) continue;

        extEdges.forEach((edge, extIdx) => {
          const sourceEntry = byId.get(edge.source);
          const sourceName = sourceEntry?.label || (edge.source ? edge.source.replace(/\\/g, '/').split('/').pop() : 'External');
          const stubId = `ext-stub:${edge.source}->${edge.target}:${edge.type}`;
          const dedupKey = `${stubId}:${edge.label || ''}`;
          if (seenEdgeKeys.has(dedupKey)) return;
          seenEdgeKeys.add(dedupKey);

          // Position the external stub node to the left, fanning out nicely
          const savedStub = positions.get(stubId);
          const stubX = savedStub?.x ?? (targetNode.x - 175 - (extIdx % 2) * 20);
          const stubY = savedStub?.y ?? (targetNode.y - 40 + (extIdx - (extEdges.length - 1) / 2) * 54);

          const stubNode = {
            id: stubId,
            label: `📁 ${sourceName}`,
            type: 'external-stub',
            path: edge.source,
            x: stubX,
            y: stubY,
            vx: 0,
            vy: 0,
            z: 0,
            pinned: Boolean(savedStub) || true,
            size: 14
          };

          nodes.push(stubNode);
          positionedById.set(stubId, stubNode);

          visibleEdges.push({
            ...edge,
            id: `ext:${edge.id || `${edge.source}->${edge.target}:${edge.type}`}`,
            source: stubId,
            target: targetId,
            sourceNode: stubNode,
            targetNode,
            label: `${sourceName}: ${edge.label || edge.type}`,
            isExternal: true,
            isExternalStub: true
          });
        });
      }
    }

    const edges = visibleEdges
      .map((edge) => ({
        ...edge,
        sourceNode: edge.sourceNode || positionedById.get(edge.source),
        targetNode: edge.targetNode || positionedById.get(edge.target)
      }))
      .filter((edge) => edge.sourceNode && edge.targetNode);

    // Group edges between node pairs for curved rendering
    const pairKey = (a, b) => (a < b ? `${a}--${b}` : `${b}--${a}`);
    const edgeGroups = new Map();
    for (const edge of edges) {
      const key = pairKey(edge.source, edge.target);
      if (!edgeGroups.has(key)) edgeGroups.set(key, []);
      edgeGroups.get(key).push(edge);
    }
    for (const group of edgeGroups.values()) {
      group.forEach((edge, idx) => {
        edge.groupIndex = idx;
        edge.groupTotal = group.length;
      });
    }

    for (let step = 0; step < 70; step += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const distSq = dx * dx + dy * dy;
          const force = Math.min(4, 1900 / distSq);
          if (!a.pinned) { a.vx += dx * force * 0.01; a.vy += dy * force * 0.01; }
          if (!b.pinned) { b.vx -= dx * force * 0.01; b.vy -= dy * force * 0.01; }
        }
      }

      for (const edge of edges) {
        const a = edge.sourceNode;
        const b = edge.targetNode;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = edge.type === 'defines' ? 48 : 140;
        const force = (distance - target) * 0.011;
        if (!a.pinned) { a.vx += (dx / distance) * force; a.vy += (dy / distance) * force; }
        if (!b.pinned) { b.vx -= (dx / distance) * force; b.vy -= (dy / distance) * force; }
      }

      for (const node of nodes) {
        if (node.pinned) continue;
        node.vx += (centerX - node.x) * 0.0008;
        node.vy += (centerY - node.y) * 0.0008;
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.84;
        node.vy *= 0.84;
      }
    }

    return { nodes, edges, width, height, folder, parentId: parentById.get(activeFolderId) ?? null };
  }

  function edgePath(edge) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    if (!a || !b) return '';
    const total = edge.groupTotal || 1;
    const index = edge.groupIndex || 0;
    const targetRadius = (b.size || 14) + 6;
    const customOffset = customEdgeOffsets.get(edge.id) || { dx: 0, dy: 0 };

    if (total <= 1 && customOffset.dx === 0 && customOffset.dy === 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const endX = b.x - (dx / dist) * targetRadius;
      const endY = b.y - (dy / dist) * targetRadius;
      return `M ${a.x} ${a.y} L ${endX} ${endY}`;
    }

    // Wide separation between parallel curves so labels never clash
    const curveOffset = (index - (total - 1) / 2) * 52;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;

    const cx = midX + nx * curveOffset + customOffset.dx;
    const cy = midY + ny * curveOffset + customOffset.dy;

    const endDx = b.x - cx;
    const endDy = b.y - cy;
    const endDist = Math.hypot(endDx, endDy) || 1;
    const endX = b.x - (endDx / endDist) * targetRadius;
    const endY = b.y - (endDy / endDist) * targetRadius;

    return `M ${a.x} ${a.y} Q ${cx} ${cy} ${endX} ${endY}`;
  }

  function edgeMidpoint(edge) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    if (!a || !b) return { x: 0, y: 0 };

    const total = edge.groupTotal || 1;
    const index = edge.groupIndex || 0;
    const customOffset = customEdgeOffsets.get(edge.id) || { dx: 0, dy: 0 };

    if (total <= 1 && customOffset.dx === 0 && customOffset.dy === 0) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    const curveOffset = (index - (total - 1) / 2) * 52;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;

    const cx = midX + nx * curveOffset + customOffset.dx;
    const cy = midY + ny * curveOffset + customOffset.dy;

    // Stagger t along the curve so parallel badges are placed at different lengths along the path
    let t = 0.5;
    if (total === 2) {
      t = index === 0 ? 0.35 : 0.65;
    } else if (total > 2) {
      t = 0.26 + (index / (total - 1)) * 0.48;
    }

    const oneMinusT = 1 - t;
    const px = oneMinusT * oneMinusT * a.x + 2 * oneMinusT * t * cx + t * t * b.x;
    const py = oneMinusT * oneMinusT * a.y + 2 * oneMinusT * t * cy + t * t * b.y;

    return { x: px, y: py };
  }

  function badgeWidth(label) {
    const text = String(label || '');
    return Math.max(50, Math.min(220, text.length * 7.5 + 24));
  }

  function edgeTooltip(edge) {
    const typeLabel = edge.type === 'class' ? 'Class' : edge.type === 'function' ? 'Function' : edge.type === 'variable' ? 'Global Variable' : edge.type;
    const extNotice = edge.isExternal ? ' [External Folder]' : '';
    return `${typeLabel}${extNotice}: ${edge.label || edge.type}\nSender: ${edge.sourceNode.label} ➔ Receiver: ${edge.targetNode.label}\n(Drag badge or line to adjust curvature)`;
  }

  function colorFor(edge) {
    if (edge.type === 'class') return 'var(--graph-class)';
    if (edge.type === 'function') return 'var(--graph-function)';
    if (edge.type === 'variable') return 'var(--graph-variable)';
    if (edge.type === 'imports') return 'var(--graph-imports)';
    if (edge.type === 'links') return 'var(--graph-links)';
    if (edge.type === 'defines') return 'var(--graph-defines)';
    return 'var(--border-strong)';
  }

  function activateNode(node) { dispatch('node', node); }

  function enterFolder(node) {
    if (node.type !== 'folder') return;
    viewMode = 'folder';
    currentFolderId = node.id;
    customPositions = new Map();
    customEdgeOffsets = new Map();
    panX = 0;
    panY = 0;
    zoom = 1;
    dispatch('folder', currentFolderId);
    dispatch('viewmode', viewMode);
  }

  function goUp() {
    if (!layout.parentId) return;
    viewMode = 'folder';
    currentFolderId = layout.parentId;
    customPositions = new Map();
    customEdgeOffsets = new Map();
    panX = 0;
    panY = 0;
    zoom = 1;
    dispatch('folder', currentFolderId);
    dispatch('viewmode', viewMode);
  }

  function nodeKeydown(event, node) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (node.type === 'folder') enterFolder(node);
      else activateNode(node);
    }
  }

  let svgEl;
  let graphHost;

  function viewportPoint(event) {
    const rect = svgEl.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * layout.width,
      y: ((event.clientY - rect.top) / rect.height) * layout.height
    };
  }

  function svgPoint(event) {
    const point = viewportPoint(event);
    return {
      x: (point.x - panX) / zoom,
      y: (point.y - panY) / zoom
    };
  }

  function startNodeDrag(event, node) {
    if (event.button !== 0) return; // Only left click drags
    event.stopPropagation();
    graphHost?.focus({ preventScroll: true });
    const point = svgPoint(event);
    drag = {
      type: 'node',
      id: node.id,
      node,
      dx: node.x - point.x,
      dy: node.y - point.y,
      z: node.z,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp, { once: true });
  }

  function startEdgeDrag(event, edge) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    graphHost?.focus({ preventScroll: true });
    const current = customEdgeOffsets.get(edge.id) || { dx: 0, dy: 0 };
    drag = {
      type: 'edge',
      id: edge.id,
      startX: event.clientX,
      startY: event.clientY,
      initDx: current.dx,
      initDy: current.dy
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp, { once: true });
  }

  function onWindowPointerMove(event) {
    if (!drag) return;
    if (drag.type === 'edge') {
      const mouseDx = (event.clientX - drag.startX) / zoom;
      const mouseDy = (event.clientY - drag.startY) / zoom;
      customEdgeOffsets = new Map(customEdgeOffsets).set(drag.id, {
        dx: drag.initDx + mouseDx,
        dy: drag.initDy + mouseDy
      });
      return;
    }
    if (drag.type === 'node') {
      const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (dist > 5) {
        drag.moved = true;
      }
      const point = svgPoint(event);
      customPositions = new Map(customPositions).set(drag.id, {
        x: point.x + drag.dx,
        y: point.y + drag.dy,
        z: drag.z
      });
    }
  }

  function onWindowPointerUp(event) {
    window.removeEventListener('pointermove', onWindowPointerMove);
    const finishedDrag = drag;
    drag = null;

    if (finishedDrag?.type === 'node' && event) {
      if (!finishedDrag.moved) {
        if (finishedDrag.node.type === 'folder') {
          enterFolder(finishedDrag.node);
        } else if (finishedDrag.node.type === 'file' || finishedDrag.node.type === 'symbol' || finishedDrag.node.type === 'external-stub') {
          activateNode(finishedDrag.node);
        }
      }
    }
  }

  function startPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest('.graph-node') || event.target.closest('.edge-badge') || event.target.closest('.graph-tools')) return;
    contextMenu = null;
    graphHost?.focus({ preventScroll: true });
    drag = { type: 'pan', x: event.clientX, y: event.clientY, panX, panY };
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp, { once: true });
  }

  function onPanMove(event) {
    if (drag?.type !== 'pan') return;
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
  }

  function onPanUp() {
    window.removeEventListener('pointermove', onPanMove);
    if (drag?.type === 'pan') drag = null;
  }

  function openNodeMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = { x: event.clientX, y: event.clientY, node };
  }

  function openFolderFromMenu() {
    if (contextMenu?.node.type === 'folder') enterFolder(contextMenu.node);
    contextMenu = null;
  }

  function wheel(event) {
    event.preventDefault();
    const pointer = viewportPoint(event);
    const graphX = (pointer.x - panX) / zoom;
    const graphY = (pointer.y - panY) / zoom;
    const next = Math.max(0.1, Math.min(8, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    panX = pointer.x - graphX * next;
    panY = pointer.y - graphY * next;
    zoom = next;
  }

  function graphKeydown(event) {
    if (event.key !== 'Backspace' || event.target.closest?.('button, input, select, textarea')) return;
    event.preventDefault();
    goUp();
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    customPositions = new Map();
    customEdgeOffsets = new Map();
  }
</script>

<div class="graph-wrap" class:fullscreen role="button" tabindex="0" aria-label="Interactive project graph. Double-click a folder to enter it; click and hold to drag nodes and expand layout." bind:this={graphHost} on:mousedown={startPan} on:wheel={wheel} on:keydown={graphKeydown}>
  <div class="graph-tools">
    {#if layout.parentId && viewMode === 'folder'}<button on:click={goUp} aria-label="Go to parent folder">↑</button>{/if}
    <button class:active={viewMode === 'all'} on:click={toggleViewMode} title="Toggle between All Files and Folder view">{viewMode === 'all' ? 'All Files' : 'Folder'}</button>
    <button on:click={() => (zoom = Math.min(8, zoom * 1.18))}>+</button>
    <button on:click={() => (zoom = Math.max(0.1, zoom / 1.18))}>−</button>
    <button on:click={resetView}>Reset</button>
  </div>

  <svg bind:this={svgEl} viewBox="0 0 {layout.width} {layout.height}" role="img" aria-label={`Project graph: ${viewMode === 'all' ? 'All Files' : layout.folder?.relativePath ?? ''}`}> 
    <defs>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>

      <!-- Arrow markers pointing to receiver node -->
      <marker id="arrow-class" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-class)" />
      </marker>
      <marker id="arrow-function" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-function)" />
      </marker>
      <marker id="arrow-variable" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-variable)" />
      </marker>
      <marker id="arrow-imports" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-imports)" />
      </marker>
      <marker id="arrow-links" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-links)" />
      </marker>
      <marker id="arrow-defines" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M 1 2 L 10 6 L 1 10 L 3 6 Z" fill="var(--graph-defines)" />
      </marker>
    </defs>

    <g class="graph-camera" transform="translate({panX}, {panY}) scale({zoom})">
      {#each layout.edges as edge (edge.id)}
        {@const pathD = edgePath(edge)}
        <!-- Base line: solid if internal, dashed with long tail if external folder -->
        <path
          role="button"
          tabindex="0"
          aria-label={edgeTooltip(edge)}
          d={pathD}
          fill="none"
          stroke={colorFor(edge)}
          stroke-width={1.6 + ((edge.sourceNode.z + edge.targetNode.z + 96) / 192) * 1.2}
          stroke-opacity={0.6 + ((edge.sourceNode.z + edge.targetNode.z + 96) / 192) * 0.35}
          stroke-dasharray={edge.isExternal ? '14 7' : 'none'}
          marker-end="url(#arrow-{edge.type})"
          class="graph-edge edge-{edge.type}"
          class:is-external={edge.isExternal}
          on:pointerdown={(e) => startEdgeDrag(e, edge)}
          on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && activateNode(edge.sourceNode)}
        >
          <title>{edgeTooltip(edge)}</title>
        </path>

        <!-- Traveling arrow animation flowing towards receiver node -->
        {#if edge.type === 'class' || edge.type === 'function' || edge.type === 'variable' || edge.type === 'imports'}
          <path
            d="M -5 -3 L 4 0 L -5 3 L -3 0 Z"
            fill={colorFor(edge)}
            class="traveling-arrow-head"
            pointer-events="none"
            opacity="0.9"
          >
            <animateMotion
              path={pathD}
              dur={edge.isExternal ? '3.0s' : '1.8s'}
              repeatCount="indefinite"
              rotate="auto"
            />
          </path>
        {/if}

        <!-- Label showing Class / Function / Variable name on edge (draggable) -->
        {#if edge.label}
          {@const mid = edgeMidpoint(edge)}
          {@const bw = badgeWidth(edge.label)}
          <g
            role="button"
            tabindex="0"
            aria-label={edgeTooltip(edge)}
            class="edge-badge"
            transform="translate({mid.x}, {mid.y})"
            on:pointerdown={(e) => startEdgeDrag(e, edge)}
            on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && activateNode(edge.sourceNode)}
          >
            <rect
              x={-bw / 2}
              y="-10"
              width={bw}
              height="20"
              rx="4"
              class="edge-badge-rect edge-badge-{edge.type}"
              class:is-external={edge.isExternal}
              stroke={colorFor(edge)}
            />
            <text
              x="0"
              y="3.8"
              text-anchor="middle"
              class="edge-badge-text edge-badge-{edge.type}"
              fill={colorFor(edge)}
            >
              {edge.label} {edge.isExternal ? '⇥' : '→'}
            </text>
            <title>{edgeTooltip(edge)}</title>
          </g>
        {/if}
      {/each}

      {#each layout.nodes as node (node.id)}
        {#if node.type === 'external-stub'}
          <!-- External Folder Origin Stub (Click and hold to drag, double click to open) -->
          <g
            class="graph-node external-stub-node"
            transform="translate({node.x}, {node.y})"
            role="button"
            tabindex="0"
            on:dblclick={() => activateNode(node)}
            on:pointerdown={(event) => startNodeDrag(event, node)}
          >
            <rect x="-65" y="-12" width="130" height="24" rx="5" class="external-stub-rect" />
            <text x="0" y="4" text-anchor="middle" class="external-stub-text">{node.label}</text>
          </g>
        {:else}
          <!-- Node: Folder or File (Click and hold to drag anywhere; Double-click to enter folder or open file) -->
          <g
            class="graph-node"
            class:active={activePath === node.path}
            class:symbol={node.type === 'symbol'}
            class:folder={node.type === 'folder'}
            class:kind-class={node.kind === 'class'}
            class:kind-function={node.kind === 'function'}
            class:kind-variable={node.kind === 'variable'}
            transform="translate({node.x}, {node.y}) scale({1 + node.z * 0.0012})"
            role="button"
            tabindex="0"
            on:pointerdown={(event) => startNodeDrag(event, node)}
            on:contextmenu={(event) => openNodeMenu(event, node)}
            on:dblclick={() => {
              if (node.type === 'folder') enterFolder(node);
              else activateNode(node);
            }}
            on:keydown={(event) => nodeKeydown(event, node)}
          >
            {#if node.type === 'folder'}
              <circle r={node.size + 4} fill="transparent" />
              <text class="folder-icon" x="0" y="1" text-anchor="middle" aria-hidden="true">📁</text>
            {:else}
              <circle r={node.type === 'symbol' ? Math.max(4, node.size - 3) : node.size} filter="url(#glow)" />
            {/if}
            <text x={node.size + 6} y="4">{node.label}</text>
          </g>
        {/if}
      {/each}
    </g>
  </svg>

  {#if contextMenu}
    <div class="graph-context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px" role="menu" tabindex="-1" on:mousedown|stopPropagation>
      {#if contextMenu.node.type === 'folder'}
        <button on:click={openFolderFromMenu}>Open folder</button>
      {:else}
        <span>Double-click to open file; drag to reposition</span>
      {/if}
    </div>
  {/if}

  <div class="legend">
    <span><i class="class"></i> Class</span>
    <span><i class="function"></i> Function</span>
    <span><i class="variable"></i> Variable</span>
    <span><i class="imports"></i> Imports</span>
    <span><i class="external-legend"></i> External Folder (Dashed ⇥)</span>
    <span><i class="links"></i> Markdown</span>
  </div>
</div>
