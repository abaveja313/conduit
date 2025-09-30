import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock WASM module before any other imports
vi.mock('@conduit/wasm', () => ({
    default: vi.fn(() => Promise.resolve()),
    init: vi.fn(),
    ping: vi.fn(() => 'pong'),
    file_count: vi.fn(() => 0),
    get_index_stats: vi.fn(() => ({ files: 0 })),
    begin_file_load: vi.fn(),
    load_file_batch: vi.fn(),
    commit_file_load: vi.fn(),
    abort_file_load: vi.fn(),
}));

import { FileService } from '../file-service.js';
import { FileScanner } from '../scanner.js';
import { ConduitError } from '@conduit/shared';
import type { FileMetadata } from '../types.js';

vi.mock('../scanner.js');
vi.mock('@conduit/shared', async () => {
    const actual = await vi.importActual('@conduit/shared');
    return {
        ...actual,
        createLogger: () => ({
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
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

    describe('getMetadata', () => {
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

        it('should return metadata for existing files', () => {
            const metadata = fileService.getMetadata('file1.ts');
            expect(metadata).toBeDefined();
            expect(metadata?.size).toBe(100);
            expect(metadata?.name).toBe('file1.ts');
        });

        it('should return undefined for non-existent files', () => {
            const metadata = fileService.getMetadata('missing.ts');
            expect(metadata).toBeUndefined();
        });
    });

    describe('hasFile', () => {
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

        it('should return true for existing files', () => {
            expect(fileService.hasFile('file1.ts')).toBe(true);
            expect(fileService.hasFile('file2.ts')).toBe(true);
        });

        it('should return false for non-existent files', () => {
            expect(fileService.hasFile('missing.ts')).toBe(false);
        });
    });

    describe('getAllMetadata and fileCount', () => {
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

        it('should return all file metadata', () => {
            const allMetadata = fileService.getAllMetadata();
            expect(allMetadata).toHaveLength(2);
            expect(allMetadata.map(m => m.path).sort()).toEqual(['src/index.ts', 'src/utils.ts']);
        });

        it('should return correct file count', () => {
            expect(fileService.fileCount).toBe(2);
        });

        it('should retrieve individual file metadata', () => {
            expect(fileService.getMetadata('src/index.ts')?.size).toBe(1000);
            expect(fileService.getMetadata('missing.ts')).toBeUndefined();
        });
    });
});