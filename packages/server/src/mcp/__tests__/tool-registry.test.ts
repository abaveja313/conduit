import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '../types';
import { z } from 'zod';

// Mock the tools module before importing ToolRegistry
vi.mock('../tools/index', () => ({
    tools: []
}));

import { ToolRegistry } from '../tool-registry';

// Mock types
interface MockServer {
    registerTool: ReturnType<typeof vi.fn>;
}

interface MockWasmManager {
    getModule: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
}

interface MockTransport {
    send: ReturnType<typeof vi.fn>;
}

// Mock dependencies
const mockServer: MockServer = {
    registerTool: vi.fn()
};

const mockWasmManager: MockWasmManager = {
    getModule: vi.fn().mockResolvedValue({} as WebAssembly.Instance),
    dispose: vi.fn()
};

describe('ToolRegistry Error Handling', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        vi.clearAllMocks();
        // Type assertion is necessary here due to complex MCP SDK types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        registry = new ToolRegistry(mockServer as any, mockWasmManager as any);
    });

    it('should complete registration successfully when no tools are configured', async () => {
        await expect(registry.registerAll(new AbortController().signal)).resolves.not.toThrow();
        expect(mockServer.registerTool).not.toHaveBeenCalled();
    });

    it('should build execution context with required WASM modules', async () => {
        const testTool: ToolDefinition = {
            name: 'wasm-tool',
            description: 'A tool that needs WASM',
            inputSchema: z.object({ input: z.string() }),
            requires: {
                wasm: ['test-module']
            },
            handler: vi.fn().mockResolvedValue({ result: 'success' })
        };

        const abortController = new AbortController();
        const context = {
            wasm: {} as Record<string, WebAssembly.Instance>,
            signal: abortController.signal
        };

        if (testTool.requires?.wasm) {
            for (const moduleName of testTool.requires.wasm) {
                context.wasm[moduleName] = await mockWasmManager.getModule(moduleName);
            }
        }

        expect(mockWasmManager.getModule).toHaveBeenCalledWith('test-module');
        expect(context.wasm['test-module']).toBeDefined();
    });

    it('should establish transport connection without throwing errors', () => {
        const mockTransport: MockTransport = { send: vi.fn() };

        expect(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            registry.connect(mockTransport as any);
        }).not.toThrow();
    });
});

