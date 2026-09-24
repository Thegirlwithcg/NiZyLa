<script>
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import GeometryWorkspaceInner from './GeometryWorkspaceInner.svelte';

  // Public component. Props:
  //   document      plain .gcn document (never mutated; loaded once per documentKey)
  //   documentKey   identity of the document; a new key reloads it and resets history/selection
  //   active        false while the workspace is hidden: shortcuts and interaction are disabled
  //   theme, preferences, showLineNumbers   passed to the code preview
  //   onchange(nextDocument)   called with a fresh plain .gcn document after every edit or viewport move
  // Svelte Flow hooks need a provider ancestor, hence this thin wrapper.
  let props = $props();
</script>

<SvelteFlowProvider>
  {#key props.documentKey}
    <GeometryWorkspaceInner {...props} />
  {/key}
</SvelteFlowProvider>
