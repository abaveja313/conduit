/**
 * Configuration for the MCP bridge
 */
export interface MCPBridgeConfig {
  workerScriptPath: string;
  timeoutMs?: number;
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}
