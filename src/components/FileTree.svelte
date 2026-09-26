<script>
  import { createEventDispatcher, tick } from 'svelte';

  export let entry;
  export let activeFile = null;
  export let activeFolderPath = null;
  export let depth = 0;
  export let renamePath = null;

  const dispatch = createEventDispatcher();
  let expanded = depth < 2;
  let dragOver = false;
  let editing = false;
  let renameValue = '';
  let renameInput;

  function normalizePath(p) {
    return p ? p.replace(/\\/g, '/').toLowerCase() : '';
  }

  $: isFolderActive = entry.type === 'folder' && activeFolderPath && normalizePath(entry.path) === normalizePath(activeFolderPath);
  $: isDescendantActive = entry.type === 'folder' && activeFolderPath && normalizePath(activeFolderPath).startsWith(normalizePath(entry.path) + '/');

  $: if (isFolderActive || isDescendantActive) {
    expanded = true;
  }

  function select() {
    if (entry.type === 'folder') {
      expanded = !expanded;
      dispatch('folder', entry);
    } else {
      dispatch('select', entry);
    }
  }

  $: if (renamePath === entry.path && !editing) {
    editing = true;
    renameValue = entry.type === 'file' ? entry.name.replace(/\.[^.]+$/, '') : entry.name;
    tick().then(() => { renameInput?.focus(); renameInput?.select(); });
  }

  function finishRename(commit) {
    if (!editing) return;
    const value = renameValue.trim();
    editing = false;
    if (commit && value) dispatch('rename', { entry, newName: value });
    else dispatch('rename-cancel');
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

<div
  class="tree-row {entry.type}"
  class:active={activeFile?.path === entry.path || isFolderActive}
  class:folder-highlight={isFolderActive}
  class:drag-over={dragOver}
  style="padding-left: {depth * 14 + 8}px"
  role="button"
  tabindex="0"
  draggable={entry.type === 'file' || (entry.type === 'folder' && depth > 0)}
  on:click={select}
  on:contextmenu={onContextMenu}
  on:keydown={onKeydown}
  on:focus={() => dispatch('focus', entry)}
  on:dragstart={startDrag}
  on:dragover={dragOverFolder}
  on:dragleave={() => (dragOver = false)}
  on:drop={dropOnFolder}
>
  <span class="twisty">{entry.type === 'folder' ? (expanded ? '▾' : '▸') : '·'}</span>
  <span class="icon" class:folder-icon={entry.type === 'folder'} class:file-icon={entry.type !== 'folder'} aria-hidden="true"></span>
  {#if editing}
    <input class="name rename-input" bind:this={renameInput} bind:value={renameValue} on:click|stopPropagation on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishRename(true); } else if (event.key === 'Escape') { event.preventDefault(); finishRename(false); } }} on:blur={() => finishRename(Boolean(renameValue.trim()))} />
  {:else}
    <span class="name">{entry.name}</span>
  {/if}
</div>

{#if entry.type === 'folder' && expanded}
  {#each entry.children as child (child.path)}
    <svelte:self
      entry={child}
      {activeFile}
      {activeFolderPath}
      depth={depth + 1}
      {renamePath}
      on:select={(event) => dispatch('select', event.detail)}
      on:folder={(event) => dispatch('folder', event.detail)}
      on:context={(event) => dispatch('context', event.detail)}
      on:move={(event) => dispatch('move', event.detail)}
      on:rename={(event) => dispatch('rename', event.detail)}
      on:rename-cancel={() => dispatch('rename-cancel')}
      on:focus={(event) => dispatch('focus', event.detail)}
    />
  {/each}
{/if}
