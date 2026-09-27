export function pointInRect(point, rect) {
  return !!point
    && point.x > rect.left && point.x < rect.left + rect.width
    && point.y > rect.top && point.y < rect.top + rect.height;
}

export function addMenuAnchor({ pointer, canvasRect }) {
  const center = { x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + canvasRect.height / 2 };
  return pointInRect(pointer, canvasRect) ? pointer : center;
}

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
