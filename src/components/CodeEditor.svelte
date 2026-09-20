<script>
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter, Decoration, ViewPlugin, MatchDecorator } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
  import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
  import { tags } from '@lezer/highlight';
  import { languageExtension } from '../core/languages.js';
  import { getLanguageFromFile, getSyntaxStyleString } from '../core/preferences.js';
  import logoUrl from '../../resource/Logo NiZyLa.svg';

  export let file = null;
  export let content = '';
  export let showLineNumbers = true;
  export let theme = 'structs';
  export let preferences = null;
  export let searchHighlight = '';
  export let searchLine = null;
  export let readOnly = false;

  const dispatch = createEventDispatcher();
  let host;
  let view;
  let lastFilePath = null;
  let lastShowLineNumbers = true;
  let lastSearchHighlight = '';
  let lastSearchLine = null;
  let markdownMenu = null;
  let tablePicker = false;
  let tableSize = { columns: 2, rows: 2 };
  let insertingTableDivider = false;

  $: isMarkdown = file?.name?.toLowerCase().endsWith('.md');
  $: currentLang = getLanguageFromFile(file?.name);
  $: syntaxStyle = getSyntaxStyleString(currentLang, theme, preferences);

  $: if (view && (file?.path !== lastFilePath || showLineNumbers !== lastShowLineNumbers || searchHighlight !== lastSearchHighlight || searchLine !== lastSearchLine)) {
    const fileChanged = file?.path !== lastFilePath || showLineNumbers !== lastShowLineNumbers || searchHighlight !== lastSearchHighlight;
    lastFilePath = file?.path ?? null;
    lastShowLineNumbers = showLineNumbers;
    lastSearchHighlight = searchHighlight;
    lastSearchLine = searchLine;
    if (fileChanged) {
      view.setState(createState(content));
    }
    revealSearchTarget();
  } else if (view && content !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content }
    });
  }

  const customHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syntax-keyword)' },
    { tag: tags.controlKeyword, color: 'var(--syntax-keyword)' },
    { tag: tags.definitionKeyword, color: 'var(--syntax-keyword)' },
    { tag: tags.moduleKeyword, color: 'var(--syntax-keyword)' },
    { tag: tags.operatorKeyword, color: 'var(--syntax-keyword)' },
    { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
    { tag: tags.function(tags.propertyName), color: 'var(--syntax-function)' },
    { tag: tags.className, color: 'var(--syntax-class)' },
    { tag: tags.typeName, color: 'var(--syntax-class)' },
    { tag: tags.definition(tags.typeName), color: 'var(--syntax-class)' },
    { tag: tags.definition(tags.className), color: 'var(--syntax-class)' },
    { tag: tags.variableName, color: 'var(--syntax-variable)' },
    { tag: tags.definition(tags.variableName), color: 'var(--syntax-variable)' },
    { tag: tags.string, color: 'var(--syntax-string)' },
    { tag: tags.special(tags.string), color: 'var(--syntax-string)' },
    { tag: tags.number, color: 'var(--syntax-number)' },
    { tag: tags.bool, color: 'var(--syntax-number)' },
    { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.lineComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.blockComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.meta, color: 'var(--syntax-class)' },
    { tag: tags.heading, color: 'var(--accent)', fontWeight: 'bold' }
  ]);

  onMount(() => {
    const onContextMenu = (event) => {
      if (!isMarkdown) return;
      event.preventDefault();
      tablePicker = false;
      markdownMenu = { x: event.clientX, y: event.clientY, section: null }; 
    };
    const closeMenu = () => { markdownMenu = null; tablePicker = false; }; 
    const clearSearchHighlightOnPointer = () => {
      if (searchHighlight) dispatch('clearSearchHighlight');
    };
    const onWheel = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY < 0 ? 1 : -1;
        dispatch('zoom', delta);
      }
    };
    host.addEventListener('contextmenu', onContextMenu);
    host.addEventListener('pointerdown', clearSearchHighlightOnPointer);
    host.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointerdown', closeMenu);
    lastFilePath = file?.path ?? null;
    lastShowLineNumbers = showLineNumbers;
    view = new EditorView({
      parent: host,
      state: createState(content)
    });
    return () => {
      host?.removeEventListener('contextmenu', onContextMenu);
      host?.removeEventListener('pointerdown', clearSearchHighlightOnPointer);
      host?.removeEventListener('wheel', onWheel);
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

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function searchHighlightExtension(term) {
    const value = term?.trim();
    if (!value) return [];
    const matcher = new MatchDecorator({
      regexp: new RegExp(escapeRegExp(value), 'gi'),
      decoration: Decoration.mark({ class: 'cm-search-hit' })
    });
    return ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = matcher.createDeco(view); }
      update(update) { this.decorations = matcher.updateDeco(update, this.decorations); }
    }, {
      decorations: (plugin) => plugin.decorations
    });
  }

  function revealSearchTarget() {
    if (!view) return;
    const value = searchHighlight?.trim();
    const doc = view.state.doc;
    const targetLine = Number(searchLine);
    let index = -1;

    if (Number.isFinite(targetLine) && targetLine > 0 && targetLine <= doc.lines) {
      const line = doc.line(targetLine);
      if (value) {
        const local = line.text.toLowerCase().indexOf(value.toLowerCase());
        index = local >= 0 ? line.from + local : line.from;
      } else {
        index = line.from;
      }
    } else if (value) {
      index = doc.toString().toLowerCase().indexOf(value.toLowerCase());
    }

    if (index < 0) return;
    const head = value && doc.sliceString(index, Math.min(doc.length, index + value.length)).toLowerCase() === value.toLowerCase()
      ? index + value.length
      : index;
    view.dispatch({
      selection: { anchor: index, head },
      effects: EditorView.scrollIntoView(index, { y: 'center' })
    });
  }

  function createState(doc) {
    return EditorState.create({
      doc,
      extensions: [
        ...(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
        drawSelection(),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        history(),
        indentOnInput(),
        bracketMatching(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(customHighlightStyle, { fallback: true }),
        languageExtension(file?.name),
        searchHighlightExtension(searchHighlight),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
          '.cm-scroller': { fontFamily: 'var(--mono-font)', fontSize: 'var(--editor-font-size, 14px)' },
          '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--muted)', border: 'none' },
          '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
          '.cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
          '.cm-search-hit': { backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', outline: '1px solid var(--accent)', borderRadius: '2px' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
          '.cm-tooltip': {
            backgroundColor: 'color-mix(in srgb, var(--panel-solid, #141628) 82%, transparent) !important',
            backdropFilter: 'blur(14px)',
            border: '1px solid var(--border-strong, #424675) !important',
            borderRadius: '7px !important',
            boxShadow: '0 10px 28px var(--shadow, rgba(0, 0, 0, 0.5)), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent) !important',
            color: 'var(--text) !important'
          },
          '.cm-tooltip.cm-tooltip-autocomplete': {
            border: '1px solid var(--border-strong, #424675) !important',
            borderRadius: '7px !important'
          },
          '.cm-tooltip-autocomplete > ul': {
            fontFamily: 'var(--mono-font) !important',
            fontSize: 'var(--editor-font-size, 13px) !important',
            padding: '4px !important'
          },
          '.cm-tooltip-autocomplete > ul > li': {
            padding: '4px 8px !important',
            borderRadius: '4px !important',
            color: 'var(--text) !important',
            lineHeight: '1.35 !important'
          },
          '.cm-tooltip-autocomplete > ul > li[aria-selected="true"]': {
            backgroundColor: 'color-mix(in srgb, var(--accent) 30%, var(--button-hover, #2a2a2a)) !important',
            color: '#ffffff !important',
            outline: '1px solid color-mix(in srgb, var(--accent) 65%, transparent) !important'
          },
          '.cm-completionMatchedText': {
            color: 'var(--accent) !important',
            fontWeight: 'bold !important',
            textDecoration: 'underline !important'
          },
          '.cm-completionDetail': {
            color: 'var(--muted) !important',
            fontStyle: 'italic !important'
          }
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || readOnly) return;
          dispatch('change', update.state.doc.toString());
          maybeInsertTableDivider(update);
        })
      ]
    });
  }

</script>

<div class="editor-host" class:hidden={!file} style="{syntaxStyle}" bind:this={host}></div>
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
