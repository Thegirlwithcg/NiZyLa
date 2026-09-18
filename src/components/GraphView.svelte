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

  $: layout = makeLayout(graph, customPositions);

  function makeLayout(input, positions) {
    if (!input) return { nodes: [], edges: [], width: 640, height: 640 };

    const importantEdges = input.edges.filter((edge) => edge.type !== 'contains');
    const connected = new Set(importantEdges.flatMap((edge) => [edge.source, edge.target]));
    const visibleNodes = input.nodes
      .filter((node) => (node.type === 'file' || node.type === 'symbol') && (connected.has(node.id) || input.nodes.length < 100))
      .slice(0, fullscreen ? 320 : 180);

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
        pinned: Boolean(saved),
        size: Math.min(18, 7 + importCount * 2)
      };
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = visibleEdges.map((edge) => ({ ...edge, sourceNode: byId.get(edge.source), targetNode: byId.get(edge.target) })).filter((edge) => edge.sourceNode && edge.targetNode);

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
        node.x = Math.max(20, Math.min(width - 140, node.x + node.vx));
        node.y = Math.max(20, Math.min(height - 20, node.y + node.vy));
        node.vx *= 0.84;
        node.vy *= 0.84;
      }
    }

    return { nodes, edges, width, height };
  }

  function colorFor(edge) {
    if (edge.type === 'imports') return 'var(--graph-imports)';
    if (edge.type === 'links') return 'var(--graph-links)';
    if (edge.type === 'defines') return 'var(--graph-defines)';
    return 'var(--border-strong)';
  }

  function activateNode(node) { dispatch('node', node); }

  function nodeKeydown(event, node) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateNode(node);
    }
  }

  let svgEl;

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
    const point = svgPoint(event);
    drag = { type: 'node', id: node.id, dx: node.x - point.x, dy: node.y - point.y };
  }

  function startPan(event) {
    drag = { type: 'pan', x: event.clientX, y: event.clientY, panX, panY };
  }

  function move(event) {
    if (!drag) return;
    if (drag.type === 'pan') {
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      return;
    }
    const point = svgPoint(event);
    customPositions = new Map(customPositions).set(drag.id, { x: point.x + drag.dx, y: point.y + drag.dy });
  }

  function endDrag() { drag = null; }

  function wheel(event) {
    event.preventDefault();
    const pointer = viewportPoint(event);
    const graphX = (pointer.x - panX) / zoom;
    const graphY = (pointer.y - panY) / zoom;
    const next = Math.max(0.28, Math.min(3, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    panX = pointer.x - graphX * next;
    panY = pointer.y - graphY * next;
    zoom = next;
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    customPositions = new Map();
  }
</script>

<div class="graph-wrap" class:fullscreen role="presentation" on:mousedown={startPan} on:mousemove={move} on:mouseup={endDrag} on:mouseleave={endDrag} on:wheel={wheel}>
  <div class="graph-tools">
    <button on:click={() => (zoom = Math.min(3, zoom * 1.18))}>+</button>
    <button on:click={() => (zoom = Math.max(0.28, zoom / 1.18))}>−</button>
    <button on:click={resetView}>Reset</button>
  </div>

  <svg bind:this={svgEl} viewBox="0 0 {layout.width} {layout.height}" role="img" aria-label="Project graph">
    <defs>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <g class="graph-camera" transform="translate({panX}, {panY}) scale({zoom})">
      {#each layout.edges as edge (edge.id)}
        <line x1={edge.sourceNode.x} y1={edge.sourceNode.y} x2={edge.targetNode.x} y2={edge.targetNode.y} stroke={colorFor(edge)} stroke-width="1.3" stroke-opacity="0.68" />
      {/each}

      {#each layout.nodes as node (node.id)}
        <g class="graph-node" class:active={activePath === node.path} class:symbol={node.type === 'symbol'} transform="translate({node.x}, {node.y})" role="button" tabindex="0" on:mousedown={(event) => startNodeDrag(event, node)} on:dblclick={() => activateNode(node)} on:keydown={(event) => nodeKeydown(event, node)}>
          <circle r={node.type === 'symbol' ? Math.max(4, node.size - 3) : node.size} filter="url(#glow)" />
          <text x={node.size + 6} y="4">{node.label}</text>
        </g>
      {/each}
    </g>
  </svg>

  <div class="legend">
    <span><i class="imports"></i> imports</span>
    <span><i class="links"></i> markdown links</span>
    <span><i class="defines"></i> symbols</span>
  </div>
</div>
