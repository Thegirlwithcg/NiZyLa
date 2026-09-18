<script>
  import { createEventDispatcher } from 'svelte';

  export let content = '';
  export let title = '';
  const dispatch = createEventDispatcher();

  $: html = renderMarkdown(content, title);

  function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(value) {
    return escapeHtml(value)
      .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\.\.?\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|([^\]]+))?\]\]/g, (_, path, label) => `<button class="wiki-link" data-wiki="${path.trim()}">${label || path.trim()}</button>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  function renderMarkdown(source, documentTitle = '') {
    let lines = source.replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    if (documentTitle && !lines.some((line) => /^#\s+/.test(line))) output.push(`<h1 class="document-title">${escapeHtml(documentTitle)}</h1>`);
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        const properties = lines.slice(1, end).filter((line) => line.includes(':'));
        if (properties.length) output.push(`<details class="note-properties"><summary>Properties</summary>${properties.map((line) => `<div>${inline(line)}</div>`).join('')}</details>`);
        lines = lines.slice(end + 1);
      }
    }
    let list = null;
    let table = false;
    let inCode = false;
    let code = [];

    const closeList = () => {
      if (list) output.push(`</${list}>`);
      list = null;
    };
    const closeTable = () => {
      if (table) output.push('</tbody></table>');
      table = false;
    };
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
    const divider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (table && !line.includes('|')) closeTable();
      if (!table && line.includes('|') && divider(lines[index + 1] || '')) {
        closeList();
        output.push(`<table><thead><tr>${cells(line).map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>`);
        table = true;
        index += 1;
        continue;
      }
      if (table && line.includes('|')) {
        output.push(`<tr>${cells(line).map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
        continue;
      }
      if (line.startsWith('```')) {
        closeList();
        if (inCode) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; }
        inCode = !inCode;
        continue;
      }
      if (inCode) { code.push(line); continue; }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (heading) { closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
      else if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { closeList(); output.push('<hr>'); }
      else if (line.startsWith('>')) { closeList(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
      else if (unordered || ordered) {
        const type = ordered ? 'ol' : 'ul';
        if (list !== type) { closeList(); list = type; output.push(`<${type}>`); }
        const item = (unordered || ordered)[1];
        const task = item.match(/^\[([ xX])\]\s+(.+)$/);
        output.push(`<li${task ? ' class="task"' : ''}>${task ? `<input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(task[2])}` : inline(item)}</li>`);
      } else if (!line.trim()) { closeList(); }
      else { closeList(); output.push(`<p>${inline(line)}</p>`); }
    }
    if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    closeList();
    closeTable();
    return output.join('\n');
  }

  function followWikiLink(event) {
    const link = event.target.closest('[data-wiki]');
    if (!link) return;
    event.preventDefault();
    dispatch('wiki', link.dataset.wiki);
  }
</script>

<svelte:window on:click={followWikiLink} />

<article class="markdown-preview">
  {@html html}
</article>
