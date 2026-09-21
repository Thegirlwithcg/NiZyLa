<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';

  export let cwd = '';
  export let api;
  export let onLastTabClose = null;

  let tabs = [];
  let activeKey = null;
  let resizeObserver;
  let removeDataListener;
  let removeExitListener;
  let nextTabNumber = 1;
  let deck;
  let destroyed = false;

  $: activeTab = tabs.find((tab) => tab.key === activeKey) ?? tabs[0] ?? null;

  function makeTerminal() {
    return new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, JetBrainsMono Nerd Font, Cascadia Mono, Consolas, Noto Sans Thai, Leelawadee UI, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      customGlyphs: false,
      letterSpacing: 0,
      theme: {
        background: '#000000',
        foreground: '#c0c0c0',
        cursor: '#52d273',
        selectionBackground: '#3d5a80aa',
        black: '#000000',
        brightBlack: '#808080',
        green: '#52d273',
        brightGreen: '#7ee787'
      }
    });
  }

  async function createTab() {
    if (!api || destroyed) return;
    const targetCwd = cwd || '';

    const key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const number = nextTabNumber++;
    const tab = {
      key,
      title: `cmd.exe`,
      terminal: makeTerminal(),
      terminalId: null,
      host: null,
      isStarting: true,
      sessionActive: false
    };

    tabs = [...tabs, tab];
    activeKey = key;
    await tick();

    if (destroyed || !tabs.some((item) => item.key === key) || !tab.host) {
      tab.terminal?.dispose();
      return;
    }

    tab.terminal.open(tab.host);
    tab.inputDisposable = tab.terminal.onData((data) => {
      if (tab.terminalId && tab.sessionActive) api?.terminalInput(tab.terminalId, data);
    });

    try {
      const created = await api.createTerminal(targetCwd);
      if (destroyed || !tabs.some((item) => item.key === key)) {
        const createdId = typeof created === 'string' ? created : created?.id;
        if (createdId) api?.closeTerminal(createdId);
        return;
      }

      tab.terminalId = typeof created === 'string' ? created : created.id;
      tab.title = typeof created === 'string' ? `cmd.exe` : (created.title || `cmd.exe`);
      tab.sessionActive = true;
      tab.terminal.writeln(targetCwd ? `\x1b[90mNiZyLa terminal tab ${number} · ${targetCwd}\x1b[0m` : `\x1b[90mNiZyLa terminal tab ${number}\x1b[0m`);
      tabs = [...tabs];
      resize(tab);
      tab.terminal.focus();
    } catch (error) {
      if (!destroyed && tabs.some((item) => item.key === key)) {
        tab.title = 'Terminal unavailable';
        tab.terminal.writeln(`\r\n\x1b[31m${error.message}\x1b[0m`);
        tab.terminal.writeln('\x1b[33mClose this tab and open a new one after fixing the terminal issue.\x1b[0m');
        tabs = [...tabs];
      }
    } finally {
      if (!destroyed && tabs.some((item) => item.key === key)) {
        tab.isStarting = false;
        tabs = [...tabs];
      }
    }
  }

  function activateTab(key) {
    activeKey = key;
    tick().then(() => {
      resize(activeTab);
      activeTab?.terminal?.focus();
    });
  }

  function closeTab(key) {
    const closing = tabs.find((tab) => tab.key === key);
    if (!closing) return;

    closing.sessionActive = false;
    const terminalId = closing.terminalId;
    closing.terminalId = null;
    closing.inputDisposable?.dispose();
    if (terminalId) api?.closeTerminal(terminalId);
    closing.terminal?.dispose();

    const index = tabs.findIndex((tab) => tab.key === key);
    const remaining = tabs.filter((tab) => tab.key !== key);
    tabs = remaining;
    if (activeKey === key) activeKey = remaining[Math.max(0, index - 1)]?.key ?? remaining[0]?.key ?? null;
    if (remaining.length === 0) onLastTabClose?.();
  }

  onMount(async () => {
    destroyed = false;
    removeDataListener = api?.onTerminalData((id, data) => {
      const tab = tabs.find((item) => item.terminalId === id);
      tab?.terminal?.write(data);
    });
    removeExitListener = api?.onTerminalExit((id) => {
      const tab = tabs.find((item) => item.terminalId === id);
      if (tab) {
        tab.terminal.writeln('\r\n\x1b[90mTerminal session ended. Close this tab or open a new tab.\x1b[0m');
        tab.terminalId = null;
        tab.sessionActive = false;
        tabs = [...tabs];
      }
    });

    await createTab();

    resizeObserver = new ResizeObserver(() => resize(activeTab));
    if (deck) resizeObserver.observe(deck);
  });

  onDestroy(() => {
    destroyed = true;
    resizeObserver?.disconnect();
    removeDataListener?.();
    removeExitListener?.();
    for (const tab of tabs) {
      tab.sessionActive = false;
      const terminalId = tab.terminalId;
      tab.terminalId = null;
      tab.inputDisposable?.dispose();
      if (terminalId) api?.closeTerminal(terminalId);
      tab.terminal?.dispose();
    }
    tabs = [];
    activeKey = null;
  });

  function resize(tab = activeTab) {
    if (!tab?.terminal || !tab.host) return;
    const cols = Math.max(20, Math.floor(tab.host.clientWidth / 8));
    const rows = Math.max(4, Math.floor((tab.host.clientHeight - 18) / 18));
    tab.terminal.resize(cols, rows);
    if (tab.terminalId) api.terminalResize(tab.terminalId, cols, rows);
  }
</script>

<div class="terminal-panel system-terminal-shell">
  <div class="terminal-tabbar" aria-label="Terminal tabs">
    {#each tabs as tab (tab.key)}
      <div class="terminal-tab" class:active={tab.key === activeKey}>
        <button class="terminal-tab-label" on:click={() => activateTab(tab.key)}>{tab.title}{tab.isStarting ? '…' : ''}</button>
        <button class="terminal-tab-close" aria-label="Close terminal tab" on:click={() => closeTab(tab.key)}>×</button>
      </div>
    {/each}
    <button class="terminal-new-tab" title="New terminal tab" on:click={createTab}>+</button>
  </div>

  <div class="terminal-deck" bind:this={deck}>
    {#if tabs.length === 0}
      <div class="terminal-empty">
        <span>No terminal tabs open.</span>
        <button on:click={createTab}>New terminal</button>
      </div>
    {:else}
      {#each tabs as tab (tab.key)}
        <div class="terminal-pane" class:active={tab.key === activeKey} bind:this={tab.host}></div>
      {/each}
    {/if}
  </div>
</div>
