import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import { ToolRegistry } from './tool-registry';
import { WASMManager } from './wasm-manager';
import type { ServerConfig } from './types';

export class ConduitServer {
  private server: McpServer;
  private registry: ToolRegistry;
  private wasmManager: WASMManager;
  private abortController = new AbortController();

  constructor(config: ServerConfig) {
    this.server = new McpServer({
      name: config.name,
      version: config.version,
    });

    this.wasmManager = new WASMManager();
    this.registry = new ToolRegistry(this.server, this.wasmManager);
  }

  async initialize(): Promise<void> {
    await this.registry.registerAll(this.abortController.signal);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
    this.registry.setTransport(transport);
  }

  dispose(): void {
    this.abortController.abort();
    this.wasmManager.dispose();
  }
}
