<script>
  import { onMount } from 'svelte';
  import { nodePresets } from '../core/geometry-editor.js';

  let { x, y, onpick, onclose } = $props();
  const uid = $props.id();
  let query = $state('');
  let index = $state(0);
  let input;
  let menu;
  let left = $state(0);
  let top = $state(0);

  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return nodePresets.filter((p) => words.every((w) => `${p.label} ${p.category}`.toLowerCase().includes(w)));
  });
  $effect(() => { void query; index = 0; });

  onMount(() => {
    // Keep the menu inside the window.
    const box = menu.getBoundingClientRect();
    left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
    top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));
    input.focus();
  });

  function onkeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); index = matches.length ? (index + 1) % matches.length : 0; }
    else if (event.key === 'ArrowUp') { event.preventDefault(); index = matches.length ? (index - 1 + matches.length) % matches.length : 0; }
    else if (event.key === 'Enter') { event.preventDefault(); if (matches[index]) onpick(matches[index].id); }
    else return;
    queueMicrotask(() => menu?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

<svelte:window onpointerdowncapture={(event) => { if (!menu.contains(event.target)) onclose(); }} />

<div class="gcn-menu" role="dialog" aria-label="Add node" tabindex="-1" bind:this={menu} style="left:{left}px;top:{top}px" {onkeydown}>
  <input bind:this={input} bind:value={query} type="search" placeholder="Search nodes…" aria-label="Search nodes"
    role="combobox" aria-expanded="true" aria-controls={`gcn-menu-list-${uid}`} spellcheck="false" autocomplete="off" />
  <ul id={`gcn-menu-list-${uid}`} role="listbox">
    {#each matches as item, i (item.id)}
      <li role="option" aria-selected={i === index} class:active={i === index}>
        <button type="button" tabindex="-1" onpointerenter={() => (index = i)} onclick={() => onpick(item.id)}>
          <span>{item.label}</span><small>{item.category}</small>
        </button>
      </li>
    {:else}
      <li class="gcn-menu-empty">No matching nodes</li>
    {/each}
  </ul>
</div>
