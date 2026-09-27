export const GEOMETRY_FILE_RE = /\.(?:gcpy|gcgd|gcn)$/i;

export function isGeometryPath(path) {
  return typeof path === 'string' && GEOMETRY_FILE_RE.test(path);
}

export function targetForGeometryPath(path) {
  if (typeof path !== 'string') return null;
  if (/\.gcpy$/i.test(path)) return 'python';
  if (/\.gcgd$/i.test(path)) return 'gdscript';
  return null;
}

export function geometryExtension(target) {
  return target === 'gdscript' ? '.gcgd' : '.gcpy';
}

export function withGeometryExtension(name, target) {
  const extension = geometryExtension(target);
  const value = String(name || '');
  return isGeometryPath(value) ? value.replace(GEOMETRY_FILE_RE, extension) : `${value}${extension}`;
}
