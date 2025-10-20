import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest';
import { FileService } from '../file-service';
import * as wasm from '@conduit/wasm';
import type { FileMetadata } from '../types';

vi.mock('@conduit/wasm', () => ({
    default: vi.fn(),
    init: vi.fn(),
    ping: vi.fn(),
    is_initialized: vi.fn(),
    begin_index_staging: vi.fn(),
    commit_index_staging: vi.fn(),
    move_files: vi.fn(),
    list_files_from_wasm: vi.fn(),
    search_files: vi.fn(),
    delete_file: vi.fn(),
    create_file: vi.fn(),
}));

interface MockFileManager {
    getMetadata: MockedFunction<(path: string) => FileMetadata | null>;
    removeFile: MockedFunction<(path: string) => Promise<void>>;
    writeModifiedFiles: MockedFunction<(files: Array<{ path: string; content: Uint8Array }>) => Promise<number>>;
}

describe('FileService - Move File Handling', () => {
    let fileService: FileService;
    let mockFileManager: MockFileManager;

    beforeEach(() => {
        vi.clearAllMocks();

        mockFileManager = {
            getMetadata: vi.fn(),
            removeFile: vi.fn(),
            writeModifiedFiles: vi.fn().mockResolvedValue(0),
        } as MockFileManager;

        vi.mocked(wasm.is_initialized).mockReturnValue(true);
        vi.mocked(wasm.begin_index_staging).mockImplementation(() => undefined);

        fileService = new FileService();
        const fs = fileService as { fileManager: MockFileManager; wasmInitialized: boolean };
        fs.fileManager = mockFileManager;
        fs.wasmInitialized = true;
    });

    describe('commitChanges', () => {
        it('should skip deletion for files created and moved in staging (never existed on disk)', async () => {
            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 1,
                modified: [{ path: 'new-location.txt', content: new Uint8Array([72, 101, 108, 108, 111]) }],
                deleted: ['old-location.txt'],
            });

            mockFileManager.getMetadata.mockImplementation((path: string) => {
                if (path === 'old-location.txt') {
                    return null;
                }
                return { path, handle: {} };
            });

            const result = await fileService.commitChanges();

            expect(mockFileManager.writeModifiedFiles).toHaveBeenCalledWith([
                { path: 'new-location.txt', content: new Uint8Array([72, 101, 108, 108, 111]) }
            ]);

            expect(mockFileManager.removeFile).not.toHaveBeenCalled();

            expect(result.modified).toEqual([{ path: 'new-location.txt', content: 'Hello' }]);
            expect(result.deleted).toEqual(['old-location.txt']);
        });

        it('should delete source file when existing file is renamed', async () => {
            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 2,
                modified: [{ path: 'renamed.txt', content: new Uint8Array([72, 105]) }],
                deleted: ['original.txt'],
            });

            mockFileManager.getMetadata.mockImplementation((path: string) => {
                return { path, handle: {} };
            });

            await fileService.commitChanges();

            expect(mockFileManager.writeModifiedFiles).toHaveBeenCalled();
            expect(mockFileManager.removeFile).toHaveBeenCalledWith('original.txt');
        });

        it('should handle multiple moves (A→B→C) by only writing final destination', async () => {
            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 1,
                modified: [{ path: 'final.txt', content: new Uint8Array([65]) }],
                deleted: ['first.txt', 'second.txt'],
            });

            mockFileManager.getMetadata.mockImplementation((path: string) => {
                if (path === 'first.txt' || path === 'second.txt') {
                    return null;
                }
                return { path, handle: {} };
            });

            await fileService.commitChanges();

            expect(mockFileManager.writeModifiedFiles).toHaveBeenCalledWith([
                { path: 'final.txt', content: new Uint8Array([65]) }
            ]);

            expect(mockFileManager.removeFile).not.toHaveBeenCalled();
        });

        it('should handle move with modification', async () => {
            const modifiedContent = new Uint8Array([77, 111, 100]);

            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 2,
                modified: [{ path: 'moved.txt', content: modifiedContent }],
                deleted: ['original.txt'],
            });

            mockFileManager.getMetadata.mockImplementation((path: string) => {
                if (path === 'original.txt') {
                    return { path, handle: {} };
                }
                return null;
            });

            const result = await fileService.commitChanges();

            expect(mockFileManager.writeModifiedFiles).toHaveBeenCalledWith([
                { path: 'moved.txt', content: modifiedContent }
            ]);

            expect(mockFileManager.removeFile).toHaveBeenCalledWith('original.txt');

            expect(result.modified[0].content).toBe('Mod');
        });

        it('should handle deletion errors gracefully', async () => {
            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 1,
                modified: [],
                deleted: ['to-delete.txt'],
            });

            mockFileManager.getMetadata.mockReturnValue({ path: 'to-delete.txt', handle: {} });
            mockFileManager.removeFile.mockRejectedValue(new Error('Permission denied'));

            await expect(fileService.commitChanges()).resolves.not.toThrow();
        });

        it('should handle mixed operations: create, move, and delete', async () => {
            vi.mocked(wasm.commit_index_staging).mockReturnValue({
                fileCount: 3,
                modified: [
                    { path: 'new-file.txt', content: new Uint8Array([78]) },
                    { path: 'renamed-file.txt', content: new Uint8Array([82]) },
                ],
                deleted: ['old-file.txt', 'deleted-file.txt'],
            });

            mockFileManager.getMetadata.mockImplementation((path: string) => {
                if (path === 'old-file.txt') {
                    return null;
                }
                if (path === 'deleted-file.txt') {
                    return { path, handle: {} };
                }
                return null;
            });

            await fileService.commitChanges();

            expect(mockFileManager.writeModifiedFiles).toHaveBeenCalled();

            expect(mockFileManager.removeFile).toHaveBeenCalledTimes(1);
            expect(mockFileManager.removeFile).toHaveBeenCalledWith('deleted-file.txt');
            expect(mockFileManager.removeFile).not.toHaveBeenCalledWith('old-file.txt');
        });
    });

    describe('moveFiles', () => {
        it('should successfully move files', async () => {
            vi.mocked(wasm.move_files).mockReturnValue({ count: 1 });

            const result = await fileService.moveFiles({
                operations: [
                    { src: 'old-path.txt', dst: 'new-path.txt' }
                ]
            });

            expect(wasm.move_files).toHaveBeenCalledWith([
                { src: 'old-path.txt', dst: 'new-path.txt' }
            ]);
            expect(result.count).toBe(1);
        });

        it('should handle move errors', async () => {
            vi.mocked(wasm.move_files).mockImplementation(() => {
                throw new Error('File not found');
            });

            await expect(fileService.moveFiles({
                operations: [
                    { src: 'non-existent.txt', dst: 'new.txt' }
                ]
            })).rejects.toThrow();
        });
    });
});