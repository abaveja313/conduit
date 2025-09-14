import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { tools } from './tools/index';
import type { ToolDefinition, ToolContext } from './types';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import { WASMManager } from './wasm-manager';
import { ErrorCodes, isAbortError, createCancelledError, wrapError } from '@conduit/shared';

// Type guard for async iterable
function isAsyncIterable<T>(obj: unknown): obj is AsyncIterable<T> {
    return obj !== null &&
        obj !== undefined &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (obj as any)[Symbol.asyncIterator] === 'function';
}

export class ToolRegistry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private tools = new Map<string, ToolDefinition<any, any>>();
    private transport?: Transport;

    constructor(
        private server: McpServer,
        private wasmManager: WASMManager
    ) { }

    setTransport(transport: Transport): void {
        this.transport = transport;
    }

    async registerAll(signal: AbortSignal): Promise<void> {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
            this.registerTool(tool, signal);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private registerTool(tool: ToolDefinition<any, any>, signal: AbortSignal): void {
        this.server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: (tool.inputSchema as z.ZodObject<z.ZodRawShape>)._def.shape() || {}
            },
            async (params: Record<string, unknown>) => {
                const context = await this.buildContext(tool, params, signal);

                try {
                    const result = await tool.handler(params, context);

                    // Check if result is an async generator
                    if (isAsyncIterable(result)) {
                        // For streaming tools, collect all results
                        const chunks: unknown[] = [];
                        for await (const chunk of result) {
                            if (signal.aborted) {
                                throw createCancelledError({ tool: tool.name, stage: 'streaming' });
                            }
                            chunks.push(chunk);
                        }
                        return {
                            content: [{
                                type: 'text' as const,
                                text: JSON.stringify(chunks)
                            }]
                        };
                    }

                    // For standard tools
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify(result)
                        }]
                    };
                } catch (error) {
                    if (signal.aborted || isAbortError(error)) {
                        throw createCancelledError({ tool: tool.name });
                    }

                    throw wrapError(error, ErrorCodes.TOOL_EXECUTION_ERROR, {
                        tool: tool.name
                    });
                }
            }
        );
    }


    private async buildContext(
        tool: ToolDefinition,
        params: Record<string, unknown>,
        signal: AbortSignal
    ): Promise<ToolContext> {
        const context: ToolContext = {
            wasm: {},
            signal
        };

        if (tool.requires?.wasm) {
            for (const moduleName of tool.requires.wasm) {
                context.wasm[moduleName] = await this.wasmManager.getModule(moduleName);
            }
        }

        const meta = params._meta as { progressToken?: string | number } | undefined;
        if (tool.capabilities?.progressive && meta?.progressToken) {
            let lastEmit = 0;
            const progressToken = meta.progressToken;
            context.progress = (current: number, total?: number, message?: string) => {
                const now = Date.now();
                if (now - lastEmit < 100) return;
                lastEmit = now;

                this.transport?.send({
                    jsonrpc: "2.0",
                    method: "notifications/progress",
                    params: {
                        progressToken,
                        progress: current,
                        total: total || 100,
                        message
                    }
                });
            };
        }

        return context;
    }

    connect(transport: Transport): void {
        this.transport = transport;
    }
}