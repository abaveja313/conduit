import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "@conduit/shared";

/**
 * Configuration for Conduit Worker Client
 */
export interface WorkerClientConfig {
    // Worker configuration
    workerScriptPath: string;

    // Client identification
    name: string;
    version: string;

    // Logging
    logger?: Logger;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';

    // Connection management
    connectionTimeout?: number;
    reconnectAttempts?: number;
    reconnectDelay?: number;

    // Performance
    enableMetrics?: boolean;
    toolTimeout?: number;
}

/**
 * Client-side metrics
 */
export interface WorkerClientMetrics {
    connectionAttempts: number;
    successfulConnections: number;
    failedConnections: number;

    toolCalls: Map<string, {
        count: number;
        totalTime: number;
        averageTime: number;
        errors: number;
        timeouts: number;
    }>;

    workerRestarts: number;
    lastConnectionTime?: number;
}

/**
 * Connection states
 */
export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'failed';

/**
 * Events emitted by worker client
 */
export interface WorkerClientEvents {
    'connection:state': { state: ConnectionState; previousState: ConnectionState };
    'connection:error': { error: Error; attempt: number };
    'worker:created': { workerScriptPath: string };
    'worker:terminated': { reason: string };
    'tool:call': { toolName: string; params: unknown; startTime: number };
    'tool:result': { toolName: string; duration: number; success: boolean };
    'tool:timeout': { toolName: string; timeout: number };
    'metrics:update': { metrics: Partial<WorkerClientMetrics> };
}

/**
 * Tool call options
 */
export interface ToolCallOptions {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
}
