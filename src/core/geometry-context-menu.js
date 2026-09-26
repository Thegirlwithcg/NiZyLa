export function geometryContextMenuItems({ kind, selectedTypes = [] } = {}) {
  if (kind === 'empty') return [
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', enabled: true },
    { id: 'add', label: 'Add Node…', enabled: true }
  ];
  const startOnly = selectedTypes.length === 1 && selectedTypes[0] === 'start';
  return [
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', enabled: !startOnly && selectedTypes.length > 0 },
    { id: 'duplicate', label: 'Duplicate', shortcut: 'Shift+D', enabled: !startOnly && selectedTypes.length > 0 },
    { id: 'delete', label: 'Delete', shortcut: 'Del', enabled: !startOnly && selectedTypes.length > 0, danger: true },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', enabled: true }
  ];
}
