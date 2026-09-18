<script>
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
  import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
  import { vim } from '@replit/codemirror-vim';
  import { languageExtension } from '../core/languages.js';
  import logoUrl from '../../resource/Logo NiZyLa.svg';

  export let file = null;
  export let content = '';
  export let vimMode = false;
  export let showLineNumbers = true;

  const dispatch = createEventDispatcher();
  let host;
  let view;
  let lastFilePath = null;
  let lastVimMode = false;
  let lastShowLineNumbers = true;
  let markdownMenu = null;
  let tablePicker = false;
  let tableSize = { columns: 2, rows: 2 };
  let insertingTableDivider = false;
  $: isMarkdown = file?.name?.toLowerCase().endsWith('.md');

  $: if (view && (file?.path !== lastFilePath || vimMode !== lastVimMode || showLineNumbers !== lastShowLineNumbers)) {
    lastFilePath = file?.path ?? null;
    lastVimMode = vimMode;
    lastShowLineNumbers = showLineNumbers;
    view.setState(createState(content));
  } else if (view && content !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content }
    });
  }

  onMount(() => {
    const onContextMenu = (event) => {
      if (!isMarkdown) return;
      event.preventDefault();
      tablePicker = false;
      markdownMenu = { x: event.clientX, y: event.clientY, section: null }; 
    };
    const closeMenu = () => { markdownMenu = null; tablePicker = false; }; 
    host.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerdown', closeMenu);
    lastFilePath = file?.path ?? null;
    lastVimMode = vimMode;
    lastShowLineNumbers = showLineNumbers;
    view = new EditorView({
      parent: host,
      state: createState(content)
    });
    return () => {
      host?.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerdown', closeMenu);
    };
  });

  onDestroy(() => view?.destroy());

  function selectedText() {
    const selection = view.state.selection.main;
    return view.state.doc.sliceString(selection.from, selection.to) || 'text';
  }

  function replaceSelection(text) {
    const selection = view.state.selection.main;
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from, head: selection.from + text.length } });
    markdownMenu = null;
    view.focus();
  }

  function wrapSelection(before, after = before) {
    replaceSelection(`${before}${selectedText()}${after}`);
  }

  function insertSnippet(snippet) { replaceSelection(snippet); }

  function insertTable(columns, rows) {
    const header = `| ${Array.from({ length: columns }, (_, index) => `Column ${index + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rows }, () => `| ${Array.from({ length: columns }, () => 'Value').join(' | ')} |`).join('\n');
    tablePicker = false;
    insertSnippet(`${header}\n${divider}\n${body}`);
  }

  async function clipboard(action) {
    const selection = view.state.selection.main;
    const text = view.state.doc.sliceString(selection.from, selection.to);
    if (action === 'copy' || action === 'cut') await navigator.clipboard?.writeText(text);
    if (action === 'cut' && text) replaceSelection('');
    if (action === 'paste') replaceSelection(await navigator.clipboard?.readText() || '');
    if (action === 'select') view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    markdownMenu = null;
  }

  function maybeInsertTableDivider(update) {
    if (insertingTableDivider || !isMarkdown || !update.transactions.some((transaction) => transaction.isUserEvent('input'))) return;
    const cursor = update.state.selection.main.head;
    const current = update.state.doc.lineAt(cursor);
    if (current.text.trim()) return;
    const previous = update.state.doc.lineAt(Math.max(0, current.from - 1));
    const values = previous.text.trim().replace(/^\||\|$/g, '').split('|').map((value) => value.trim());
    if (!previous.text.trim().startsWith('|') || !previous.text.trim().endsWith('|') || values.length < 1 || values.some((value) => !value)) return;
    insertingTableDivider = true;
    queueMicrotask(() => {
      const position = view.state.selection.main.head;
      const emptyLine = view.state.doc.lineAt(position);
      if (!emptyLine.text.trim()) view.dispatch({ changes: { from: emptyLine.from, insert: `| ${values.map(() => '---').join(' | ')} |\n` } });
      insertingTableDivider = false;
    });
  }

  function heading(level) {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const value = view.state.doc.sliceString(line.from, line.to).replace(/^#{1,6}\s+/, '');
    replaceSelection(`${'#'.repeat(level)} ${value}`);
  }

  function createState(doc) {
    return EditorState.create({
      doc,
      extensions: [
        ...(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
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
          if (!update.docChanged) return;
          dispatch('change', update.state.doc.toString());
          maybeInsertTableDivider(update);
        })
      ]
    });
  }

</script>

<div class="editor-host" class:hidden={!file} bind:this={host}></div>
{#if markdownMenu}
  <div class="markdown-context-menu" role="menu" tabindex="-1" style="left: {markdownMenu.x}px; top: {markdownMenu.y}px" on:pointerdown|stopPropagation>
    <button on:click={() => insertSnippet(`[${selectedText()}](url)`)}>Add link</button>
    <button on:click={() => insertSnippet(`[${selectedText()}](https://)`)}>Add external link</button>
    <div class="menu-group">
      <span>Format</span>
      <button on:click={() => wrapSelection('**')}>Bold</button><button on:click={() => wrapSelection('*')}>Italic</button><button on:click={() => wrapSelection('~~')}>Strikethrough</button><button on:click={() => wrapSelection('==')}>Highlight</button><button on:click={() => wrapSelection('`')}>Code</button><button on:click={() => wrapSelection('$')}>Math</button>
    </div>
    <div class="menu-group">
      <span>Paragraph</span>
      <button on:click={() => heading(1)}>Heading 1</button><button on:click={() => heading(2)}>Heading 2</button><button on:click={() => heading(3)}>Heading 3</button><button on:click={() => insertSnippet('- ')}>Bullet list</button><button on:click={() => insertSnippet('- [ ] ')}>Task</button><button on:click={() => insertSnippet('> ')}>Quote</button>
    </div>
    <div class="menu-group">
      <span>Insert</span>
      <button on:click={() => insertSnippet('[^1]')}>Footnote</button><button on:click={() => (tablePicker = !tablePicker)}>Table…</button>
      {#if tablePicker}
        <div class="table-picker" aria-label="Table size">
          <strong>{tableSize.columns} × {tableSize.rows} table</strong>
          <div class="table-grid">
            {#each Array(8) as _, row}
              {#each Array(10) as _, column}
                <button class:active={column < tableSize.columns && row < tableSize.rows} aria-label={`${column + 1} columns, ${row + 1} rows`} on:mouseenter={() => (tableSize = { columns: column + 1, rows: row + 1 })} on:click={() => insertTable(column + 1, row + 1)}></button>
              {/each}
            {/each}
          </div>
        </div>
      {/if}<button on:click={() => insertSnippet('> [!NOTE]\n> Note text')}>Callout</button><button on:click={() => insertSnippet('\n---\n')}>Horizontal rule</button><button on:click={() => insertSnippet('```\ncode\n```')}>Code block</button><button on:click={() => insertSnippet('$$\nmath\n$$')}>Math block</button>
    </div>
    <div class="menu-group menu-actions"><button on:click={() => clipboard('cut')}>Cut</button><button on:click={() => clipboard('copy')}>Copy</button><button on:click={() => clipboard('paste')}>Paste</button><button on:click={() => clipboard('select')}>Select all</button></div>
  </div>
{/if}
{#if !file}
  <div class="editor-empty">
    <img src={logoUrl} alt="NiZyLa logo" />
    <h1>NiZyLa</h1>
    <p>Open a folder, select a file, and explore relationships in the project graph.</p>
  </div>
{/if}
