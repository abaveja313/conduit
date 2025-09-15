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

export interface ToolDefinition<TParams = unknown, TResult = unknown> {
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
    handler: (params: TParams, context: ToolContext) => Promise<TResult> | AsyncGenerator<TResult>;
}
