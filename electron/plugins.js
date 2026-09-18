import fs from 'node:fs/promises';
import path from 'node:path';

export async function discoverPlugins(rootPaths) {
  const plugins = [];
  for (const rootPath of rootPaths) {
    const pluginDir = path.join(rootPath, '.nizyla', 'plugins');
    let entries = [];
    try {
      entries = await fs.readdir(pluginDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(pluginDir, entry.name, 'plugin.json');
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        plugins.push({
          id: manifest.id ?? entry.name,
          name: manifest.name ?? entry.name,
          version: manifest.version ?? '0.0.0',
          description: manifest.description ?? '',
          rootPath: path.join(pluginDir, entry.name)
        });
      } catch {
        plugins.push({ id: entry.name, name: entry.name, version: 'broken', description: 'Invalid plugin.json', rootPath: path.join(pluginDir, entry.name) });
      }
    }
  }
  return plugins;
}
