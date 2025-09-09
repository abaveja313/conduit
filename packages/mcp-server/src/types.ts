import { Tool, Resource, CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "@conduit/shared";

/**
 * Configuration for Conduit Worker Server
 */
export interface WorkerServerConfig {
  name: string;
  version: string;
  
  // Logging configuration
  logger?: Logger;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  
  // Performance monitoring
  enableMetrics?: boolean;
  metricsPrefix?: string;
  
  // WASM integration (future)
  wasmModulePath?: string;
  
  // Initial tool registration - using pure MCP Tool interface
  tools?: ToolRegistration[];
  resources?: ResourceRegistration[];
}

/**
 * Tool registration with handler function
 * Uses pure MCP Tool interface + handler
 */
export interface ToolRegistration {
  definition: Tool;
  handler: (request: CallToolRequest['params']) => Promise<any>;
  
  // Optional Conduit-specific metadata (not part of MCP protocol)
  metadata?: {
    estimatedExecutionTime?: number;
    memoryUsage?: 'low' | 'medium' | 'high';
    wasmFunction?: string;
    cacheable?: boolean;
    cacheTTL?: number;
  };
}

/**
 * Resource registration with handler function
 * Uses pure MCP Resource interface + handler
 */
export interface ResourceRegistration {
  definition: Resource;
  handler: (uri: string) => Promise<any>;
  
  // Optional Conduit-specific metadata
  metadata?: {
    readOnly?: boolean;
    requiresPermission?: string;
    cacheable?: boolean;
    cacheTTL?: number;
  };
}

/**
 * Metrics collected by the worker server
 */
export interface WorkerMetrics {
    toolExecutions: Map<string, {
        count: number;
        totalTime: number;
        averageTime: number;
        errors: number;
    }>;

    memoryUsage: {
        heapUsed: number;
        heapTotal: number;
        external: number;
    };

    wasmMetrics?: {
        moduleSize: number;
        compilationTime: number;
        instantiationTime: number;
    };
}

/**
 * Events emitted by the worker server
 */
export interface WorkerServerEvents {
    'tool:execute': { toolName: string; params: unknown; startTime: number };
    'tool:complete': { toolName: string; duration: number; success: boolean };
    'tool:error': { toolName: string; error: Error; params: unknown };
    'metrics:update': { metrics: Partial<WorkerMetrics> };
    'wasm:loaded': { moduleSize: number; loadTime: number };
    'wasm:error': { error: Error; context: string };
}
