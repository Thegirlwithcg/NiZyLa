<script>
  import { onDestroy, untrack } from 'svelte';

  // Numeric input with a UI-only draft: invalid text ("", "-", "1e999") never reaches the document.
  let { kind = 'int', value, fieldKey, label = 'Value', oncommit, onblur, ondraft } = $props();

  const intPattern = /^[+-]?\d+$/;
  const floatPattern = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  function parse(text) {
    const trimmed = text.trim();
    if (!(kind === 'int' ? intPattern : floatPattern).test(trimmed)) {
      return { ok: false, message: kind === 'int' ? 'Enter a whole number.' : 'Enter a number.' };
    }
    const number = Number(trimmed);
    if (kind === 'int' && !Number.isSafeInteger(number)) return { ok: false, message: 'Integer is too large.' };
    if (!Number.isFinite(number)) return { ok: false, message: 'Number is too large.' };
    return { ok: true, value: number === 0 ? 0 : number };
  }

  let draft = $state(String(untrack(() => value)));
  let error = $state('');

  function oninput(event) {
    draft = event.currentTarget.value;
    const result = parse(draft);
    error = result.ok ? '' : result.message;
    ondraft?.(fieldKey, result.ok ? null : result.message);
    if (result.ok) oncommit(result.value);
  }

  // Undo/Redo or another edit changed the stored value: drop a stale draft.
  $effect(() => {
    const current = value;
    untrack(() => {
      const result = parse(draft);
      if (!result.ok || result.value !== current) {
        draft = String(current);
        error = '';
        ondraft?.(fieldKey, null);
      }
    });
  });

  onDestroy(() => ondraft?.(fieldKey, null));
</script>

<span class="gcn-field">
  <input class="nodrag nopan" type="text" inputmode="decimal" spellcheck="false" aria-label={label}
    aria-invalid={error ? 'true' : undefined} value={draft} {oninput} {onblur} />
  {#if error}<span class="gcn-field-error" role="alert">{error}</span>{/if}
</span>
