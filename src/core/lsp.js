// NiZyLa LSP boundary.
// This module intentionally keeps the UI independent from language-server transports.
// Future adapters can implement this shape with vscode-languageserver-protocol.

export class LspRegistry {
  servers = new Map();

  register(languageId, factory) {
    this.servers.set(languageId, factory);
  }

  has(languageId) {
    return this.servers.has(languageId);
  }

  async start(languageId, context) {
    const factory = this.servers.get(languageId);
    if (!factory) return null;
    return factory(context);
  }
}

export const lspRegistry = new LspRegistry();
