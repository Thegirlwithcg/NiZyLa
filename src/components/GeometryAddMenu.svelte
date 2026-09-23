<script>
  import { onMount, tick } from 'svelte';
  import { nodePresets } from '../core/geometry-editor.js';

  let { x, y, onpick, onclose } = $props();
  const uid = $props.id();
  let query = $state('');
  let input;
  let menu;
  let flyoutEl = $state();
  let left = $state(0);
  let top = $state(0);

  // Categories in order of first appearance
  const categories = $derived.by(() => {
    const seen = new Set();
    const list = [];
    for (const p of nodePresets) {
      if (!seen.has(p.category)) {
        seen.add(p.category);
        list.push(p.category);
      }
    }
    return list;
  });

  // Flat matches when query is non-empty
  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return nodePresets.filter((p) => words.every((w) => `${p.label} ${p.category}`.toLowerCase().includes(w)));
  });

  // State for empty-query category navigation
  let categoryIndex = $state(-1);
  let activeCategory = $state(null);
  let flyoutActive = $state(false);
  let presetIndex = $state(-1);
  let flyoutTop = $state(0);

  // State for non-empty query flat list navigation
  let flatIndex = $state(0);

  const categoryPresets = $derived.by(() => {
    if (!activeCategory) return [];
    return nodePresets.filter((p) => p.category === activeCategory);
  });

  const isFlipped = $derived(left + 250 + 200 > (typeof window !== 'undefined' ? window.innerWidth - 4 : 1000));

  $effect(() => {
    if (query.trim() !== '') {
      flatIndex = 0;
      activeCategory = null;
      flyoutActive = false;
      categoryIndex = -1;
      presetIndex = -1;
    } else {
      categoryIndex = -1;
      activeCategory = null;
      flyoutActive = false;
      presetIndex = -1;
    }
  });

  onMount(() => {
    // Keep the menu inside the window.
    const box = menu.getBoundingClientRect();
    left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
    top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));
    input.focus();
  });

  function updateFlyoutPosition(catIdx) {
    if (catIdx < 0 || !menu) return;
    const rows = menu.querySelectorAll('.gcn-category-list > li');
    const row = rows[catIdx];
    if (!row) return;
    const rowBox = row.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const flyoutH = flyoutEl?.offsetHeight || (categoryPresets.length * 30 + 10);
    const desiredTop = rowBox.top;
    const clampedTop = Math.max(4, Math.min(desiredTop, window.innerHeight - flyoutH - 4));
    flyoutTop = Math.round(clampedTop - menuBox.top);
  }

  function openCategory(catIdx, activateFlyout = false) {
    if (catIdx < 0 || catIdx >= categories.length) return;
    categoryIndex = catIdx;
    activeCategory = categories[catIdx];
    flyoutActive = activateFlyout;
    presetIndex = activateFlyout ? 0 : -1;
    tick().then(() => updateFlyoutPosition(catIdx));
  }

  function closeFlyout() {
    activeCategory = null;
    flyoutActive = false;
    presetIndex = -1;
  }

  function scrollIntoViewHelper() {
    queueMicrotask(() => {
      if (query.trim() !== '') {
        menu?.querySelector('.gcn-flat-list .active')?.scrollIntoView({ block: 'nearest' });
      } else if (flyoutActive) {
        flyoutEl?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
      } else {
        menu?.querySelector('.gcn-category-list .active')?.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function onkeydown(event) {
    const isFlat = query.trim() !== '';

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!isFlat && activeCategory) {
        closeFlyout();
      } else {
        onclose();
      }
      return;
    }

    if (isFlat) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Keep moving text caret in input
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        flatIndex = matches.length ? (flatIndex + 1) % matches.length : 0;
        scrollIntoViewHelper();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        flatIndex = matches.length ? (flatIndex - 1 + matches.length) % matches.length : 0;
        scrollIntoViewHelper();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (matches[flatIndex]) onpick(matches[flatIndex].id);
      }
      return;
    }

    // Category / Flyout mode (query === '')
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flyoutActive && activeCategory && categoryPresets.length) {
        presetIndex = (presetIndex + 1) % categoryPresets.length;
      } else {
        const nextIdx = categoryIndex < 0 ? 0 : (categoryIndex + 1) % categories.length;
        if (activeCategory) {
          openCategory(nextIdx, false);
        } else {
          categoryIndex = nextIdx;
        }
      }
      scrollIntoViewHelper();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flyoutActive && activeCategory && categoryPresets.length) {
        presetIndex = (presetIndex - 1 + categoryPresets.length) % categoryPresets.length;
      } else {
        const prevIdx = categoryIndex <= 0 ? categories.length - 1 : categoryIndex - 1;
        if (activeCategory) {
          openCategory(prevIdx, false);
        } else {
          categoryIndex = prevIdx;
        }
      }
      scrollIntoViewHelper();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (!flyoutActive) {
        if (categoryIndex < 0) categoryIndex = 0;
        openCategory(categoryIndex, true);
        scrollIntoViewHelper();
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (flyoutActive || activeCategory) {
        closeFlyout();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (flyoutActive && activeCategory && categoryPresets[presetIndex]) {
        onpick(categoryPresets[presetIndex].id);
      } else if (!flyoutActive && categoryIndex >= 0) {
        openCategory(categoryIndex, true);
        scrollIntoViewHelper();
      }
    }
  }
</script>

<svelte:window
  onpointerdowncapture={(event) => { if (menu && !menu.contains(event.target)) onclose(); }}
  onkeydown={onkeydown}
/>

<div class="gcn-menu" role="dialog" aria-label="Add node" tabindex="-1" bind:this={menu} style="left:{left}px;top:{top}px">
  <input bind:this={input} bind:value={query} type="search" placeholder="Search nodes…" aria-label="Search nodes"
    role="combobox" aria-expanded="true" aria-controls={`gcn-menu-list-${uid}`} spellcheck="false" autocomplete="off" />

  {#if query.trim() !== ''}
    <ul id={`gcn-menu-list-${uid}`} class="gcn-flat-list" role="listbox">
      {#each matches as item, i (item.id)}
        <li role="option" aria-selected={i === flatIndex} class:active={i === flatIndex}>
          <button type="button" tabindex="-1" onpointerenter={() => (flatIndex = i)} onclick={() => onpick(item.id)}>
            <span>{item.label}</span><small>{item.category}</small>
          </button>
        </li>
      {:else}
        <li class="gcn-menu-empty">No matching nodes</li>
      {/each}
    </ul>
  {:else}
    <ul id={`gcn-menu-list-${uid}`} class="gcn-category-list" role="menu">
      {#each categories as cat, i (cat)}
        <li role="none" class:active={i === categoryIndex}>
          <button type="button" tabindex="-1" role="menuitem"
            aria-haspopup="true" aria-expanded={activeCategory === cat}
            onpointerenter={() => openCategory(i, false)}
            onclick={() => openCategory(i, true)}>
            <span>{cat}</span>
            <span class="gcn-menu-arrow" aria-hidden="true">▸</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if activeCategory && categoryPresets.length}
      <div
        class="gcn-flyout"
        class:flipped={isFlipped}
        bind:this={flyoutEl}
        style="top:{flyoutTop}px"
        role="listbox"
        aria-label="{activeCategory} nodes"
      >
        <ul>
          {#each categoryPresets as item, j (item.id)}
            <li role="option" aria-selected={j === presetIndex && flyoutActive} class:active={j === presetIndex && flyoutActive}>
              <button
                type="button"
                tabindex="-1"
                onpointerenter={() => { flyoutActive = true; presetIndex = j; }}
                onclick={() => onpick(item.id)}
              >
                <span>{item.label}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>
