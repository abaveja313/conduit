import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WASMManager } from '../wasm-manager';
import { ConduitError, ErrorCodes } from '@conduit/shared';

// Mock fetch globally for this test suite
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('WASMManager', () => {
  let manager: WASMManager;
  let mockWebAssemblyInstantiate: ReturnType<typeof vi.spyOn>;

  const MOCK_BUFFER_SIZE = 8;
  const createMockInstance = () => ({}) as WebAssembly.Instance;
  const createMockModule = () => ({}) as WebAssembly.Module;

  beforeEach(() => {
    manager = new WASMManager();
    mockWebAssemblyInstantiate = vi.spyOn(WebAssembly, 'instantiate');
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.dispose();
    mockWebAssemblyInstantiate.mockRestore();
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
        'module\\name',
      ];

      for (const name of invalidNames) {
        await expect(manager.getModule(name)).rejects.toThrow(ConduitError);
        await expect(manager.getModule(name)).rejects.toMatchObject({
          code: ErrorCodes.WASM_LOAD_ERROR,
          message: expect.stringMatching(/invalid module name/i),
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
        'module/../../etc',
      ];

      for (const name of maliciousNames) {
        await expect(manager.getModule(name)).rejects.toThrow(ConduitError);
        await expect(manager.getModule(name)).rejects.toMatchObject({
          code: ErrorCodes.WASM_LOAD_ERROR,
          message: expect.stringMatching(/Invalid module name|cannot contain path characters/),
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
        'MixedCase123',
      ];

      const mockInstance = createMockInstance();
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(MOCK_BUFFER_SIZE),
      } as Response);

      mockWebAssemblyInstantiate.mockResolvedValue({
        instance: mockInstance,
        module: createMockModule(),
      });

      for (const name of validNames) {
        await expect(manager.getModule(name)).resolves.toBe(mockInstance);
      }
    });
  });

  describe('loadModule', () => {
    it('should successfully load and cache modules', async () => {
      const mockInstance = createMockInstance();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(MOCK_BUFFER_SIZE),
      } as Response);

      mockWebAssemblyInstantiate.mockResolvedValue({
        instance: mockInstance,
        module: createMockModule(),
      });

      const result1 = await manager.getModule('test-module');
      const result2 = await manager.getModule('test-module');

      expect(result1).toBe(mockInstance);
      expect(result2).toBe(mockInstance);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle HTTP fetch failures with appropriate error codes', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } as Response);

      await expect(manager.getModule('missing-module')).rejects.toThrow(ConduitError);
      await expect(manager.getModule('missing-module')).rejects.toMatchObject({
        code: ErrorCodes.WASM_LOAD_ERROR,
        message: expect.stringMatching(/failed to load wasm module.*missing-module.*not found/i),
      });
    });

    it('should wrap network errors in ConduitError with proper context', async () => {
      const networkError = new Error('Network error');
      mockFetch.mockRejectedValue(networkError);

      await expect(manager.getModule('test-module')).rejects.toMatchObject({
        code: ErrorCodes.WASM_LOAD_ERROR,
        context: {
          module: 'test-module',
          operation: 'load',
          originalError: 'Error',
        },
      });
    });

    it('should preserve existing ConduitError without double-wrapping', async () => {
      const customError = new ConduitError('Custom error', ErrorCodes.PERMISSION_DENIED);
      mockFetch.mockRejectedValue(customError);

      await expect(manager.getModule('test-module')).rejects.toThrow(customError);
    });

    it('should wrap WebAssembly instantiation failures with context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(MOCK_BUFFER_SIZE),
      } as Response);

      mockWebAssemblyInstantiate.mockRejectedValue(new Error('Invalid WASM module'));

      await expect(manager.getModule('invalid-module')).rejects.toThrow(ConduitError);
      await expect(manager.getModule('invalid-module')).rejects.toMatchObject({
        code: ErrorCodes.WASM_LOAD_ERROR,
        context: {
          module: 'invalid-module',
          operation: 'load',
        },
      });
    });
  });

  describe('dispose', () => {
    it('should clear all cached modules', async () => {
      const mockInstance = createMockInstance();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(MOCK_BUFFER_SIZE),
      } as Response);

      mockWebAssemblyInstantiate.mockResolvedValue({
        instance: mockInstance,
        module: createMockModule(),
      });

      await manager.getModule('module1');
      await manager.getModule('module2');

      manager.dispose();

      await manager.getModule('module1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
