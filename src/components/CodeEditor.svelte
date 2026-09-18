<script>
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
  import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
  import { javascript } from '@codemirror/lang-javascript';
  import { markdown } from '@codemirror/lang-markdown';
  import { json } from '@codemirror/lang-json';
  import { css } from '@codemirror/lang-css';
  import { html } from '@codemirror/lang-html';
  import { python } from '@codemirror/lang-python';
  import { vim } from '@replit/codemirror-vim';

  export let file = null;
  export let content = '';
  export let vimMode = false;

  const dispatch = createEventDispatcher();
  let host;
  let view;
  let lastFilePath = null;
  let lastVimMode = false;

  $: if (view && (file?.path !== lastFilePath || vimMode !== lastVimMode)) {
    lastFilePath = file?.path ?? null;
    lastVimMode = vimMode;
    view.setState(createState(content));
  } else if (view && content !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content }
    });
  }

  onMount(() => {
    lastFilePath = file?.path ?? null;
    lastVimMode = vimMode;
    view = new EditorView({
      parent: host,
      state: createState(content)
    });
  });

  onDestroy(() => view?.destroy());

  function createState(doc) {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(file?.name),
        vimMode ? vim() : [],
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
          '.cm-scroller': { fontFamily: 'var(--mono-font)', fontSize: '14px' },
          '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--muted)', border: 'none' },
          '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
          '.cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) dispatch('change', update.state.doc.toString());
        })
      ]
    });
  }

  function languageExtension(name = '') {
    const lower = name.toLowerCase();
    if (/\.(js|jsx|ts|tsx|mjs|cjs|svelte)$/.test(lower)) return javascript({ jsx: true, typescript: /\.(ts|tsx|svelte)$/.test(lower) });
    if (lower.endsWith('.md')) return markdown();
    if (lower.endsWith('.json')) return json();
    if (/\.(css|scss)$/.test(lower)) return css();
    if (/\.(html|xml)$/.test(lower)) return html();
    if (lower.endsWith('.py')) return python();
    return [];
  }
</script>

<div class="editor-host" class:hidden={!file} bind:this={host}></div>
{#if !file}
  <div class="editor-empty">
    <h1>NiZyLa</h1>
    <p>Open a folder, select a file, and explore relationships in the project graph.</p>
  </div>
{/if}
