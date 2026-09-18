<script>
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';

  export let cwd = '';
  export let api;

  let host;
  let terminal;
  let terminalId;
  let resizeObserver;
  let removeDataListener;
  let removeExitListener;

  onMount(async () => {
    terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, JetBrainsMono Nerd Font, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: '#1c1b19',
        foreground: '#e9e2d4',
        cursor: '#d5a950',
        selectionBackground: '#6b5a3d88',
        black: '#1c1b19',
        brightBlack: '#80796f',
        green: '#b9d49a',
        brightGreen: '#cbe7ad'
      }
    });
    terminal.open(host);
    terminal.writeln(cwd ? `\x1b[90mNiZyLa terminal · ${cwd}\x1b[0m` : '\x1b[33mOpen a workspace to start the terminal.\x1b[0m');

    if (!api || !cwd) return;
    try {
      terminalId = await api.createTerminal(cwd);
    } catch (error) {
      terminal.writeln(`\r\n\x1b[31m${error.message}\x1b[0m`);
      return;
    }
    removeDataListener = api.onTerminalData((id, data) => {
      if (id === terminalId) terminal.write(data);
    });
    removeExitListener = api.onTerminalExit((id) => {
      if (id === terminalId) terminal.writeln('\r\n\x1b[90mTerminal session ended.\x1b[0m');
    });
    terminal.onData((data) => api.terminalInput(terminalId, data));

    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(host);
    resize();
    terminal.focus();
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    removeDataListener?.();
    removeExitListener?.();
    if (terminalId) api?.closeTerminal(terminalId);
    terminal?.dispose();
  });

  function resize() {
    if (!terminal || !host) return;
    const cols = Math.max(20, Math.floor(host.clientWidth / 8));
    const rows = Math.max(4, Math.floor(host.clientHeight / 18));
    terminal.resize(cols, rows);
    if (terminalId) api.terminalResize(terminalId, cols, rows);
  }
</script>

<div class="terminal-panel terminal-shell" bind:this={host}></div>
