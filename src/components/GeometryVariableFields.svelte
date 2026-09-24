<script>
  import GeometryField from './GeometryField.svelte';

  let { variable, onupdate, onendedit, ondraft, children } = $props();
</script>

<div class="gcn-var-row">
  <input aria-label="Variable name" value={variable?.name ?? ''} spellcheck="false"
    oninput={(e) => onupdate?.({ name: e.currentTarget.value }, true)} onblur={onendedit} />
  <select aria-label="Variable type" value={variable?.type ?? 'int'}
    onchange={(e) => onupdate?.({ type: e.currentTarget.value }, false)}>
    {#each ['int', 'float', 'string', 'bool', 'list', 'dict'] as type}
      <option value={type}>{type}</option>
    {/each}
  </select>
  {#if children}
    {@render children()}
  {/if}
</div>

<div class="gcn-var-row">
  <span class="gcn-label">=</span>
  {#if variable?.type === 'int' || variable?.type === 'float'}
    <GeometryField kind={variable.type} value={variable.initialValue} fieldKey={`var:${variable.id}`} label="Initial value"
      oncommit={(value) => onupdate?.({ initialValue: value }, true)} onblur={onendedit} ondraft={ondraft} />
  {:else if variable?.type === 'string'}
    <input aria-label="Initial value" value={variable.initialValue ?? ''} spellcheck="false"
      oninput={(e) => onupdate?.({ initialValue: e.currentTarget.value }, true)} onblur={onendedit} />
  {:else if variable?.type === 'bool'}
    <label class="gcn-check"><input type="checkbox" checked={variable.initialValue}
      onchange={(e) => onupdate?.({ initialValue: e.currentTarget.checked }, false)} /> {variable.initialValue ? 'true' : 'false'}</label>
  {:else if variable?.type === 'list'}
    <input aria-label="Initial value" value="[]" readonly disabled style="opacity: 0.7;" />
  {:else if variable?.type === 'dict'}
    <input aria-label="Initial value" value="{'{}'}" readonly disabled style="opacity: 0.7;" />
  {/if}
</div>
