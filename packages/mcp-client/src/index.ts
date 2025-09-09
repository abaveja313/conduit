// Main worker client exports  
export { ConduitWorkerClient, ConduitWorkerClientTransport } from './client.js';
export type * from './types.js';

// Re-export useful MCP SDK types for convenience
export type { 
  Tool, 
  Resource, 
  Prompt,
  CallToolResult,
  ListToolsResult,
  ListResourcesResult,
  ListPromptsResult 
} from '@modelcontextprotocol/sdk/types.js';

// Create logger for this package
import { createLogger } from '@conduit/shared';
export const logger = createLogger('worker-client');
