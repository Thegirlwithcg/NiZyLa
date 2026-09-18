// Renderer-side plugin API contract for NiZyLa.
// Desktop discovery currently reads .nizyla/plugins/*/plugin.json from opened workspaces.

export class PluginHost {
  plugins = [];
  commands = new Map();

  loadManifests(manifests) {
    this.plugins = manifests;
  }

  registerCommand(id, handler) {
    this.commands.set(id, handler);
  }

  async runCommand(id, context) {
    const handler = this.commands.get(id);
    if (!handler) throw new Error(`Unknown command: ${id}`);
    return handler(context);
  }
}

export const pluginHost = new PluginHost();
