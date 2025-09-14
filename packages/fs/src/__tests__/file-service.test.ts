import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from '../file-service.js';
import { FileScanner } from '../scanner.js';
import { ConduitError } from '@conduit/shared';
import type { FileMetadata } from '../types.js';

// Mock dependencies
vi.mock('../scanner.js');
vi.mock('@conduit/shared', async () => {
  const actual = await vi.importActual('@conduit/shared');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('p-limit', () => ({
  default: () => <T>(fn: () => Promise<T>) => fn(),
}));

describe('FileService', () => {
  let fileService: FileService;
  
  const createMockFileMetadata = (path: string, size = 1000): FileMetadata => ({
    path,
    name: path.split('/').pop() || '',
    size,
    type: 'file',
    lastModified: Date.now(),
    handle: createMockFileHandle(path, size),
  });
  
  const createMockFileHandle = (path: string, size = 1000): FileSystemFileHandle => {
    const mockFile = {
      size,
      lastModified: Date.now(),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(size)),
    };
    
    const mockWritable = {
      write: vi.fn(),
      close: vi.fn(),
    };
    
    return {
      kind: 'file' as const,
      name: path.split('/').pop() || '',
      getFile: vi.fn().mockResolvedValue(mockFile),
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    } as unknown as FileSystemFileHandle;
  };

  beforeEach(() => {
    fileService = new FileService();
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should scan and store file metadata', async () => {
      const mockFiles = [
        createMockFileMetadata('src/index.ts', 1000),
        createMockFileMetadata('src/utils.ts', 2000),
      ];
      
      const mockScan = vi.fn().mockImplementation(async function* () {
        for (const file of mockFiles) {
          yield file;
        }
      });
      
      vi.mocked(FileScanner.prototype.scan).mockImplementation(mockScan);
      
      const handle = {} as FileSystemDirectoryHandle;
      const stats = await fileService.initialize(handle);
      
      expect(stats.filesScanned).toBe(2);
      expect(stats.totalSize).toBe(3000);
      expect(fileService.fileCount).toBe(2);
    });

    it('should handle scan errors', async () => {
      const mockScan = vi.fn().mockRejectedValue(new Error('Scan failed'));
      
      vi.mocked(FileScanner.prototype.scan).mockImplementation(mockScan);
      
      const handle = { name: 'test' } as FileSystemDirectoryHandle;
      
      await expect(fileService.initialize(handle)).rejects.toThrow(ConduitError);
    });
  });

  describe('loadFiles', () => {
    beforeEach(async () => {
      const mockFiles = [
        createMockFileMetadata('file1.ts', 100),
        createMockFileMetadata('file2.ts', 200),
      ];
      
      const mockScan = vi.fn().mockImplementation(async function* () {
        for (const file of mockFiles) {
          yield file;
        }
      });
      
      vi.mocked(FileScanner.prototype.scan).mockImplementation(mockScan);
      
      await fileService.initialize({} as FileSystemDirectoryHandle);
    });

    it('should load files and return buffers', async () => {
      const buffers = await fileService.loadFiles(['file1.ts', 'file2.ts']);
      
      expect(buffers).toHaveLength(2);
      expect(buffers[0]).toBeInstanceOf(ArrayBuffer);
      expect(buffers[0].byteLength).toBe(100);
      expect(buffers[1].byteLength).toBe(200);
    });

    it('should return empty buffer for missing files', async () => {
      const buffers = await fileService.loadFiles(['file1.ts', 'missing.ts']);
      
      expect(buffers[0].byteLength).toBe(100);
      expect(buffers[1].byteLength).toBe(0);
    });
  });

  describe('writeFiles', () => {
    let mockFileHandle: FileSystemFileHandle;
    
    beforeEach(async () => {
      mockFileHandle = createMockFileHandle('file1.ts', 100);
      const mockFile = createMockFileMetadata('file1.ts', 100);
      mockFile.handle = mockFileHandle;
      
      const mockScan = vi.fn().mockImplementation(async function* () {
        yield mockFile;
      });
      
      vi.mocked(FileScanner.prototype.scan).mockImplementation(mockScan);
      
      await fileService.initialize({} as FileSystemDirectoryHandle);
    });

    it('should write files and update metadata', async () => {
      // Mock the handle to return updated file info after write
      const getFileMock = vi.mocked(mockFileHandle.getFile);
      getFileMock.mockResolvedValueOnce({
        size: 150,
        lastModified: Date.now(),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(150)),
      } as File);
      
      const newContent = new ArrayBuffer(150);
      await fileService.writeFiles([{ path: 'file1.ts', content: newContent }]);
      
      const meta = fileService.getMetadata('file1.ts');
      expect(meta?.size).toBe(150);
    });

    it('should throw for non-existent files', async () => {
      await expect(
        fileService.writeFiles([{ path: 'missing.ts', content: new ArrayBuffer(100) }])
      ).rejects.toThrow(ConduitError);
    });
  });

  describe('metadata access', () => {
    beforeEach(async () => {
      const mockFiles = [
        createMockFileMetadata('src/index.ts', 1000),
        createMockFileMetadata('src/utils.ts', 2000),
      ];
      
      const mockScan = vi.fn().mockImplementation(async function* () {
        for (const file of mockFiles) {
          yield file;
        }
      });
      
      vi.mocked(FileScanner.prototype.scan).mockImplementation(mockScan);
      
      await fileService.initialize({} as FileSystemDirectoryHandle);
    });

    it('should provide metadata for WASM', () => {
      const metadata = fileService.getMetadataForWASM();
      
      expect(metadata.paths).toEqual(['src/index.ts', 'src/utils.ts']);
      expect(Array.from(metadata.sizes)).toEqual([1000, 2000]);
      expect(metadata.extensions).toEqual(['ts', 'ts']);
    });

    it('should retrieve individual file metadata', () => {
      expect(fileService.getMetadata('src/index.ts')?.size).toBe(1000);
      expect(fileService.getMetadata('missing.ts')).toBeUndefined();
    });
  });
});