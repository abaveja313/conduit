import type { z } from 'zod';

export interface ServerConfig {
    name: string;
    version: string;
}

export type ProgressCallback = (current: number, total?: number, message?: string) => void;

export interface ToolContext {
    wasm: Record<string, WebAssembly.Instance>;
    progress?: ProgressCallback;
    signal?: AbortSignal;
}

export interface ToolDefinition<TParams = unknown> {
    name: string;
    description: string;
    inputSchema: z.ZodSchema<TParams>;
    requires?: {
        wasm?: string[];
    };
    capabilities?: {
        streaming?: boolean;
        progressive?: boolean;
    };
    handler: (params: TParams, context: ToolContext) => Promise<unknown> | AsyncGenerator<unknown>;
}

export const ErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,

    WASM_LOAD_ERROR: -32000,
    TOOL_EXECUTION_ERROR: -32001,
    CANCELLED: -32002,
} as const;

export class ConduitError extends Error {
    constructor(message: string, public code: number) {
        super(message);
        this.name = 'ConduitError';
    }
}
