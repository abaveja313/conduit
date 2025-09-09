// Shared types across Conduit packages

/**
 * Configuration for the MCP bridge
 */
export interface MCPBridgeConfig {
    workerScriptPath: string; // worker script path
    timeoutMs?: number; // timeout for MCP operations in ms
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
    code: string;
    message: string;
    details?: unknown;
}
