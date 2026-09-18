<script>
  import { createEventDispatcher } from 'svelte';

  export let graph;
  export let activePath = null;
  export let fullscreen = false;

  const dispatch = createEventDispatcher();
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;
  let customPositions = new Map();
  let currentFolderId = null;
  let contextMenu = null;

  $: layout = makeLayout(graph, customPositions, currentFolderId);

  function makeLayout(input, positions, folderId) {
    if (!input) return { nodes: [], edges: [], width: 640, height: 640, folder: null, parentId: null };

    const byId = new Map(input.nodes.map((node) => [node.id, node]));
    const parentById = new Map(input.edges.filter((edge) => edge.type === 'contains').map((edge) => [edge.target, edge.source]));
    const root = input.nodes.find((node) => node.type === 'folder' && !parentById.has(node.id));
    const activeFolderId = folderId && byId.has(folderId) ? folderId : root?.id;
    const folder = byId.get(activeFolderId) ?? null;

    // Drill-down view: show only this folder's immediate contents.  This keeps
    // hierarchy clear and avoids meaningless lines between unrelated nodes.
    const visibleNodes = input.nodes
      .filter((node) => parentById.get(node.id) === activeFolderId && (node.type === 'folder' || node.type === 'file'))

    const nodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = input.edges.filter((edge) => edge.type !== 'contains' && nodeIds.has(edge.source) && nodeIds.has(edge.target));

    const width = fullscreen ? 1400 : 760;
    const height = fullscreen ? 900 : 680;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;

    const nodes = visibleNodes.map((node, index) => {
      const saved = positions.get(node.id);
      const angle = (Math.PI * 2 * index) / Math.max(visibleNodes.length, 1);
      const importCount = visibleEdges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
      return {
        ...node,
        x: saved?.x ?? centerX + Math.cos(angle) * (radius + importCount * 5),
        y: saved?.y ?? centerY + Math.sin(angle) * (radius + importCount * 5),
        vx: 0,
        vy: 0,
        z: saved?.z ?? Math.sin(index * 2.399) * 48,
        pinned: Boolean(saved),
        size: node.type === 'folder' ? 18 : Math.min(18, 7 + importCount * 2)
      };
    });

    const positionedById = new Map(nodes.map((node) => [node.id, node]));
    const edges = visibleEdges.map((edge) => ({ ...edge, sourceNode: positionedById.get(edge.source), targetNode: positionedById.get(edge.target) })).filter((edge) => edge.sourceNode && edge.targetNode);

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
        const target = edge.type === 'defines' ? 48 : 132;
        const force = (distance - target) * 0.011;
        if (!a.pinned) { a.vx += (dx / distance) * force; a.vy += (dy / distance) * force; }
        if (!b.pinned) { b.vx -= (dx / distance) * force; b.vy -= (dy / distance) * force; }
      }

      for (const node of nodes) {
        if (node.pinned) continue;
        node.vx += (centerX - node.x) * 0.0008;
        node.vy += (centerY - node.y) * 0.0008;
        // The graph is a canvas, not a bounded diagram: nodes may travel beyond
        // the initial viewport and remain reachable through pan/zoom.
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.84;
        node.vy *= 0.84;
      }
    }

    return { nodes, edges, width, height, folder, parentId: parentById.get(activeFolderId) ?? null };
  }

  function colorFor(edge) {
    if (edge.type === 'contains') return 'var(--border-strong)';
    if (edge.type === 'imports') return 'var(--graph-imports)';
    if (edge.type === 'links') return 'var(--graph-links)';
    if (edge.type === 'defines') return 'var(--graph-defines)';
    return 'var(--border-strong)';
  }

  function activateNode(node) { dispatch('node', node); }

  function enterFolder(node) {
    if (node.type !== 'folder') return;
    currentFolderId = node.id;
    customPositions = new Map();
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  function goUp() {
    if (!layout.parentId) return;
    currentFolderId = layout.parentId;
    customPositions = new Map();
    panX = 0;
    panY = 0;
    zoom = 1;
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
    event.stopPropagation();
    graphHost?.focus({ preventScroll: true });
    const point = svgPoint(event);
    drag = { type: 'node', id: node.id, dx: node.x - point.x, dy: node.y - point.y, z: node.z, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function startPan(event) {
    contextMenu = null;
    graphHost?.focus({ preventScroll: true });
    drag = { type: 'pan', x: event.clientX, y: event.clientY, panX, panY };
  }

  function move(event) {
    if (!drag) return;
    if (drag.type === 'pan') {
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      return;
    }
    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    const point = svgPoint(event);
    customPositions = new Map(customPositions).set(drag.id, { x: point.x + drag.dx, y: point.y + drag.dy, z: drag.z });
  }

  function endDrag(event) {
    const finishedDrag = drag;
    drag = null;
    if (finishedDrag?.type === 'node' && event) {
      const source = layout.nodes.find((node) => node.id === finishedDrag.id);
      if (!finishedDrag.moved && source?.type === 'folder') enterFolder(source);
      if (finishedDrag.moved) {
        const point = svgPoint(event);
        const target = layout.nodes.find((node) => node.type === 'folder' && node.id !== finishedDrag.id && Math.hypot(node.x - point.x, node.y - point.y) < node.size + 18);
        if (source && target && source.type === 'file') dispatch('move', { source, target });
      }
    }
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
  }
</script>

<div class="graph-wrap" class:fullscreen role="button" tabindex="0" aria-label="Interactive project graph. Click a folder to enter it; press Backspace to go up." bind:this={graphHost} on:mousedown={startPan} on:mousemove={move} on:mouseup={endDrag} on:mouseleave={endDrag} on:wheel={wheel} on:keydown={graphKeydown}>
  <div class="graph-tools">
    {#if layout.parentId}<button on:click={goUp} aria-label="Go to parent folder">↑</button>{/if}
    <button on:click={() => (zoom = Math.min(8, zoom * 1.18))}>+</button>
    <button on:click={() => (zoom = Math.max(0.1, zoom / 1.18))}>−</button>
    <button on:click={resetView}>Reset</button>
  </div>

  <svg bind:this={svgEl} viewBox="0 0 {layout.width} {layout.height}" role="img" aria-label={`Project graph: ${layout.folder?.relativePath ?? ''}`}> 
    <defs>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <g class="graph-camera" transform="translate({panX}, {panY}) scale({zoom})">
      {#each layout.edges as edge (edge.id)}
        <line x1={edge.sourceNode.x} y1={edge.sourceNode.y} x2={edge.targetNode.x} y2={edge.targetNode.y} stroke={colorFor(edge)} stroke-width={1 + ((edge.sourceNode.z + edge.targetNode.z + 96) / 192) * 1.1} stroke-opacity={0.34 + ((edge.sourceNode.z + edge.targetNode.z + 96) / 192) * 0.42} />
      {/each}

      {#each layout.nodes as node (node.id)}
        <g class="graph-node" class:active={activePath === node.path} class:symbol={node.type === 'symbol'} class:folder={node.type === 'folder'} transform="translate({node.x}, {node.y}) scale({1 + node.z * 0.0012})" role="button" tabindex="0" on:mousedown={(event) => startNodeDrag(event, node)} on:contextmenu={(event) => openNodeMenu(event, node)} on:dblclick={() => node.type !== 'folder' && activateNode(node)} on:keydown={(event) => nodeKeydown(event, node)}>
          {#if node.type === 'folder'}
            <text class="folder-icon" x="0" y="1" text-anchor="middle" aria-hidden="true">📁</text>
          {:else}
            <circle r={node.type === 'symbol' ? Math.max(4, node.size - 3) : node.size} filter="url(#glow)" />
          {/if}
          <text x={node.size + 6} y="4">{node.label}</text>
        </g>
      {/each}
    </g>
  </svg>

  {#if contextMenu}
    <div class="graph-context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px" role="menu" tabindex="-1" on:mousedown|stopPropagation>
      {#if contextMenu.node.type === 'folder'}
        <button on:click={openFolderFromMenu}>Open folder</button>
      {:else}
        <span>Drag this file onto a folder to move it</span>
      {/if}
    </div>
  {/if}

  <div class="legend">
    <span><i class="imports"></i> imports</span>
    <span><i class="links"></i> markdown links</span>
    <span><i class="defines"></i> symbols</span>
  </div>
</div>
