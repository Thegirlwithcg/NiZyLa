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
  let removeRunStdout;
  let removeRunStderr;
  let removeRunExit;
  let nextTabNumber = 1;
  let deck;
  let destroyed = false;
  let runInputText = '';

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

  export async function openRunTab(runId = 'pending') {
    let runTab = tabs.find((t) => t.type === 'run');
    if (runTab) {
      runTab.runId = runId;
      runTab.sessionActive = true;
      runTab.terminal.writeln(`\r\n\x1b[32m=== Starting Python Run ===\x1b[0m\r\n`);
      activeKey = runTab.key;
      tabs = [...tabs];
      await tick();
      resize(runTab);
      return;
    }

    const key = 'run-session';
    runTab = {
      key,
      title: 'Python Run',
      type: 'run',
      runId,
      terminal: makeTerminal(),
      terminalId: null,
      host: null,
      isStarting: false,
      sessionActive: true
    };

    tabs = [...tabs, runTab];
    activeKey = key;
    await tick();

    if (destroyed || !runTab.host) return;
    runTab.terminal.open(runTab.host);
    runTab.terminal.writeln(`\x1b[32m=== Starting Python Run ===\x1b[0m\r\n`);
    resize(runTab);
  }

  async function createTab() {
    if (!api || destroyed) return;
    const targetCwd = cwd || '';

    const key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const number = nextTabNumber++;
    const tab = {
      key,
      title: `cmd.exe`,
      type: 'pty',
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

  function findRunTab(runId) {
    const exact = tabs.find((t) => t.type === 'run' && t.runId === runId);
    if (exact) return exact;
    const pending = tabs.find((t) => t.type === 'run' && t.runId === 'pending');
    if (pending && runId) {
      pending.runId = runId;
      return pending;
    }
    return null;
  }

  function sendRunInput() {
    const runTab = tabs.find((t) => t.type === 'run' && t.key === activeKey) || tabs.find((t) => t.type === 'run');
    if (!runTab || !runTab.runId || !runTab.sessionActive) return;
    const text = runInputText;
    runInputText = '';
    runTab.terminal.writeln(`\x1b[36m${text}\x1b[0m`);
    api?.inputPython(runTab.runId, text);
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

    removeRunStdout = api?.onRunStdout(({ runId, text }) => {
      const runTab = findRunTab(runId);
      if (runTab) {
        runTab.terminal.write(text.replace(/\r?\n/g, '\r\n'));
        tabs = [...tabs];
      }
    });

    removeRunStderr = api?.onRunStderr(({ runId, text }) => {
      const runTab = findRunTab(runId);
      if (runTab) {
        runTab.terminal.write(`\x1b[31m${text.replace(/\r?\n/g, '\r\n')}\x1b[0m`);
        tabs = [...tabs];
      }
    });

    removeRunExit = api?.onRunExit(({ runId, exitCode, signal }) => {
      const runTab = findRunTab(runId);
      if (runTab) {
        runTab.terminal.writeln(`\r\n\x1b[90m[Process finished with exit code ${exitCode}${signal ? ` (${signal})` : ''}]\x1b[0m\r\n`);
        runTab.sessionActive = false;
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
    removeRunStdout?.();
    removeRunStderr?.();
    removeRunExit?.();
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
    const rows = Math.max(4, Math.floor((tab.host.clientHeight - (tab.type === 'run' ? 50 : 18)) / 18));
    tab.terminal.resize(cols, rows);
    if (tab.terminalId) api.terminalResize(tab.terminalId, cols, rows);
  }
</script>

<div class="terminal-panel system-terminal-shell">
  <div class="terminal-tabbar" aria-label="Terminal tabs">
    {#each tabs as tab (tab.key)}
      <div class="terminal-tab" class:active={tab.key === activeKey} class:run-tab={tab.type === 'run'}>
        <button class="terminal-tab-label" on:click={() => activateTab(tab.key)}>
          {#if tab.type === 'run'}
            ▶ {tab.title} {tab.sessionActive ? '(Running)' : ''}
          {:else}
            {tab.title}{tab.isStarting ? '…' : ''}
          {/if}
        </button>
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
        <div class="terminal-pane-wrapper" class:active={tab.key === activeKey}>
          <div class="terminal-pane" class:active={tab.key === activeKey} bind:this={tab.host}></div>
          {#if tab.type === 'run'}
            <form class="terminal-run-input-bar" on:submit|preventDefault={sendRunInput}>
              <input bind:value={runInputText} aria-label="Send Input" placeholder="Send Input" spellcheck="false" disabled={!tab.sessionActive} />
              <button type="submit" disabled={!tab.sessionActive}>Send Input</button>
            </form>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
