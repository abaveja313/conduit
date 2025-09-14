import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WASMManager } from '../wasm-manager';
import { ConduitError, ErrorCodes } from '@conduit/shared';

// Mock fetch
global.fetch = vi.fn();

describe('WASMManager', () => {
    let manager: WASMManager;

    beforeEach(() => {
        manager = new WASMManager();
        vi.clearAllMocks();
    });

    afterEach(() => {
        manager.dispose();
    });

    describe('validateModuleName', () => {
        it('should reject module names containing invalid characters', async () => {
            const invalidNames = [
                'module@name',
                'module#name',
                'module$name',
                'module!name',
                'module name',
                'module/name',
                'module\\name'
            ];

            for (const name of invalidNames) {
                await expect(manager.getModule(name)).rejects.toThrow(ConduitError);
                await expect(manager.getModule(name)).rejects.toMatchObject({
                    code: ErrorCodes.WASM_LOAD_ERROR,
                    message: expect.stringMatching(/invalid module name/i)
                });
            }
        });

        it('should reject module names with path traversal attempts', async () => {
            const maliciousNames = [
                '../module',
                '..\\module',
                'module/../other',
                'module\\..\\other',
                '..',
                '....',
                'module/../../etc'
            ];

            for (const name of maliciousNames) {
                await expect(manager.getModule(name)).rejects.toThrow(ConduitError);
                await expect(manager.getModule(name)).rejects.toMatchObject({
                    code: ErrorCodes.WASM_LOAD_ERROR,
                    message: expect.stringMatching(/Invalid module name|cannot contain path characters/)
                });
            }
        });

        it('should successfully validate and process valid module names', async () => {
            const validNames = [
                'module',
                'module-name',
                'module_name',
                'module123',
                'UPPERCASE',
                'MixedCase123'
            ];

            // Mock successful responses
            const mockInstance = {} as WebAssembly.Instance;
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8)
            } as Response);

            // Mock WebAssembly.instantiate
            vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
                instance: mockInstance,
                module: {} as WebAssembly.Module
            });

            for (const name of validNames) {
                // Should not throw for valid names
                await expect(manager.getModule(name)).resolves.toBe(mockInstance);
            }
        });
    });

    describe('loadModule', () => {
        it('should successfully load and cache modules', async () => {
            const mockInstance = {} as WebAssembly.Instance;

            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8)
            } as Response);

            vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
                instance: mockInstance,
                module: {} as WebAssembly.Module
            });

            const result1 = await manager.getModule('test-module');
            const result2 = await manager.getModule('test-module');

            expect(result1).toBe(mockInstance);
            expect(result2).toBe(mockInstance); // Should return cached instance
            expect(fetch).toHaveBeenCalledTimes(1); // Only fetched once
        });

        it('should handle HTTP fetch failures with appropriate error codes', async () => {
            vi.mocked(global.fetch).mockResolvedValue({
                ok: false,
                statusText: 'Not Found'
            } as Response);

            await expect(manager.getModule('missing-module')).rejects.toThrow(ConduitError);
            await expect(manager.getModule('missing-module')).rejects.toMatchObject({
                code: ErrorCodes.WASM_LOAD_ERROR,
                message: expect.stringMatching(/failed to load wasm module.*missing-module.*not found/i)
            });
        });

        it('should wrap network errors in ConduitError with proper context', async () => {
            const networkError = new Error('Network error');
            vi.mocked(global.fetch).mockRejectedValue(networkError);

            try {
                await manager.getModule('test-module');
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(ConduitError);
                expect((error as ConduitError).code).toBe(ErrorCodes.WASM_LOAD_ERROR);
                expect((error as ConduitError).context).toMatchObject({
                    module: 'test-module',
                    operation: 'load',
                    originalError: 'Error'
                });
            }
        });

        it('should preserve existing ConduitError without double-wrapping', async () => {
            const customError = new ConduitError('Custom error', ErrorCodes.PERMISSION_DENIED);
            vi.mocked(global.fetch).mockRejectedValue(customError);

            await expect(manager.getModule('test-module')).rejects.toThrow(customError);
        });

        it('should wrap WebAssembly instantiation failures with context', async () => {
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8)
            } as Response);

            vi.spyOn(WebAssembly, 'instantiate').mockRejectedValue(
                new Error('Invalid WASM module')
            );

            await expect(manager.getModule('invalid-module')).rejects.toThrow(ConduitError);
            await expect(manager.getModule('invalid-module')).rejects.toMatchObject({
                code: ErrorCodes.WASM_LOAD_ERROR,
                context: {
                    module: 'invalid-module',
                    operation: 'load'
                }
            });
        });
    });

    describe('dispose', () => {
        it('should clear all cached modules', async () => {
            const mockInstance = {} as WebAssembly.Instance;

            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8)
            } as Response);

            vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
                instance: mockInstance,
                module: {} as WebAssembly.Module
            });

            // Load some modules
            await manager.getModule('module1');
            await manager.getModule('module2');

            // Dispose
            manager.dispose();

            // Should fetch again after dispose
            await manager.getModule('module1');
            expect(fetch).toHaveBeenCalledTimes(3); // 2 initial + 1 after dispose
        });
    });
});
