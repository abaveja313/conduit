// Main worker server exports
export { ConduitWorkerServer, ConduitWorkerServerTransport } from './server.js';
export type * from './types.js';

// Re-export useful MCP SDK types for convenience
export type {
    Tool,
    Resource,
    Prompt,
    CallToolResult,
    GetPromptResult,
    ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js';

// Create logger for this package
import { createLogger } from '@conduit/shared';
export const logger = createLogger('worker-server')