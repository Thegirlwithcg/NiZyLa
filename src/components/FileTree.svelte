<script>
  import { createEventDispatcher } from 'svelte';

  export let entry;
  export let activeFile = null;
  export let depth = 0;

  const dispatch = createEventDispatcher();
  let expanded = depth < 2;

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
</script>

<div class="tree-row {entry.type} {activeFile?.path === entry.path ? 'active' : ''}" style="padding-left: {depth * 14 + 8}px" role="button" tabindex="0" on:click={select} on:contextmenu={onContextMenu} on:keydown={onKeydown}>
  <span class="twisty">{entry.type === 'folder' ? (expanded ? '▾' : '▸') : '·'}</span>
  <span class="icon">{entry.type === 'folder' ? '📁' : '📄'}</span>
  <span class="name">{entry.name}</span>
</div>

{#if entry.type === 'folder' && expanded}
  {#each entry.children as child (child.path)}
    <svelte:self entry={child} {activeFile} depth={depth + 1} on:select={(event) => dispatch('select', event.detail)} on:context={(event) => dispatch('context', event.detail)} />
  {/each}
{/if}
