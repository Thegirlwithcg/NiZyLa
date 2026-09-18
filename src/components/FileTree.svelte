<script>
  import { createEventDispatcher } from 'svelte';

  export let entry;
  export let activeFile = null;
  export let depth = 0;

  const dispatch = createEventDispatcher();
  let expanded = depth < 2;
  let dragOver = false;

  function select() {
    if (entry.type === 'folder') {
      expanded = !expanded;
    } else {
      dispatch('select', entry);
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
    dispatch('context', { entry, x: event.clientX, y: event.clientY });
  }

  function onKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  }

  function startDrag(event) {
    if (entry.type !== 'file' && (entry.type !== 'folder' || depth === 0)) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-nizyla-file', JSON.stringify(entry));
  }

  function dragOverFolder(event) {
    if (entry.type !== 'folder' || !event.dataTransfer.types.includes('application/x-nizyla-file')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dragOver = true;
  }

  function dropOnFolder(event) {
    event.preventDefault();
    dragOver = false;
    if (entry.type !== 'folder') return;

    try {
      const source = JSON.parse(event.dataTransfer.getData('application/x-nizyla-file'));
      if ((source?.type === 'file' || source?.type === 'folder') && source.path && source.path !== entry.path) dispatch('move', { source, target: entry });
    } catch {
      // Ignore drops that did not originate from this file tree.
    }
  }
</script>

<div class="tree-row {entry.type} {activeFile?.path === entry.path ? 'active' : ''}" class:drag-over={dragOver} style="padding-left: {depth * 14 + 8}px" role="button" tabindex="0" draggable={entry.type === 'file' || (entry.type === 'folder' && depth > 0)} on:click={select} on:contextmenu={onContextMenu} on:keydown={onKeydown} on:dragstart={startDrag} on:dragover={dragOverFolder} on:dragleave={() => (dragOver = false)} on:drop={dropOnFolder}>
  <span class="twisty">{entry.type === 'folder' ? (expanded ? '▾' : '▸') : '·'}</span>
  <span class="icon">{entry.type === 'folder' ? '📁' : '📄'}</span>
  <span class="name">{entry.name}</span>
</div>

{#if entry.type === 'folder' && expanded}
  {#each entry.children as child (child.path)}
    <svelte:self entry={child} {activeFile} depth={depth + 1} on:select={(event) => dispatch('select', event.detail)} on:context={(event) => dispatch('context', event.detail)} on:move={(event) => dispatch('move', event.detail)} />
  {/each}
{/if}
