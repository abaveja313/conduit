import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import {
    createMockFileSystem,
    mockFileSystemAccessSupport,
    createErrorFile,
} from './test-utils/mocks.js';
import { collectScanResults, assertFileMetadataEqual } from './test-utils/helpers.js';

describe('FileScanner - Core', () => {
    beforeEach(() => {
        mockFileSystemAccessSupport(true);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('API Contract', () => {
        it('should create scanner instance', () => {
            const scanner = new FileScanner();
            expect(scanner).toBeInstanceOf(FileScanner);
        });

        it('should throw when FileSystem API is not supported', async () => {
            mockFileSystemAccessSupport(false);
            const scanner = new FileScanner();
            const handle = createMockFileSystem();

            await expect(async () => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                for await (const _ of scanner.scan(handle)) {
                    // Should not reach here
                }
            }).rejects.toThrow('File System Access API is not supported');
        });

        it('should return AsyncGenerator from scan()', () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem();
            const generator = scanner.scan(handle);

            expect(generator).toHaveProperty('next');
            expect(generator).toHaveProperty('return');
            expect(generator).toHaveProperty('throw');
        });

        it('should check isSupported() static method', () => {
            mockFileSystemAccessSupport(true);
            expect(FileScanner.isSupported()).toBe(true);

            mockFileSystemAccessSupport(false);
            expect(FileScanner.isSupported()).toBe(false);
        });
    });

    describe('Basic Scanning', () => {
        it('should scan empty directory', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem();

            const results = await collectScanResults(scanner, handle);
            expect(results).toEqual([]);
        });

        it('should scan flat directory with files', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'file1.txt': { name: 'file1.txt', size: 100, type: 'text/plain' },
                'file2.js': { name: 'file2.js', size: 200, type: 'application/javascript' },
                'image.png': { name: 'image.png', size: 5000, type: 'image/png' },
            });

            const results = await collectScanResults(scanner, handle);

            expect(results).toHaveLength(3);
            expect(results.map((f) => f.name).sort()).toEqual(['file1.txt', 'file2.js', 'image.png']);

            // Check file metadata
            const file1 = results.find((f) => f.name === 'file1.txt')!;
            assertFileMetadataEqual(file1, {
                name: 'file1.txt',
                path: 'file1.txt',
                size: 100,
                type: 'file',
                mimeType: 'text/plain',
            });
        });

        it('should scan nested directory structure', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'file1.txt': { name: 'file1.txt', size: 100 },
                src: {
                    'index.js': { name: 'index.js', size: 300 },
                    components: {
                        'Button.js': { name: 'Button.js', size: 400 },
                    },
                },
                docs: {
                    'README.md': { name: 'README.md', size: 500 },
                },
            });

            const results = await collectScanResults(scanner, handle);

            expect(results).toHaveLength(7); // 3 files + 3 directories + root

            // Check files
            const files = results.filter((f) => f.type === 'file');
            expect(files).toHaveLength(4);
            expect(files.map((f) => f.path).sort()).toEqual([
                'docs/README.md',
                'file1.txt',
                'src/components/Button.js',
                'src/index.js',
            ]);

            // Check directories
            const dirs = results.filter((f) => f.type === 'directory');
            expect(dirs).toHaveLength(3);
            expect(dirs.map((f) => f.path).sort()).toEqual(['docs', 'src', 'src/components']);
        });

        it('should yield correct metadata for files', async () => {
            const scanner = new FileScanner();
            const now = Date.now();
            const handle = createMockFileSystem({
                'test.pdf': {
                    name: 'test.pdf',
                    size: 1024 * 1024, // 1MB
                    type: 'application/pdf',
                    lastModified: now,
                },
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(1);

            const file = results[0];
            expect(file).toMatchObject({
                name: 'test.pdf',
                path: 'test.pdf',
                size: 1024 * 1024,
                type: 'file',
                lastModified: now,
                mimeType: 'application/pdf',
            });
        });

        it('should yield correct metadata for directories', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'empty-dir': {},
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(1);

            const dir = results[0];
            expect(dir).toMatchObject({
                name: 'empty-dir',
                path: 'empty-dir',
                size: 0,
                type: 'directory',
            });
            expect(dir.lastModified).toBeGreaterThan(0);
            expect(dir.mimeType).toBeUndefined();
        });

        it('should build correct paths using forward slashes', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                level1: {
                    level2: {
                        level3: {
                            'deep.file': { name: 'deep.file', size: 100 },
                        },
                    },
                },
            });

            const results = await collectScanResults(scanner, handle);
            const deepFile = results.find((f) => f.name === 'deep.file');

            expect(deepFile).toBeDefined();
            expect(deepFile!.path).toBe('level1/level2/level3/deep.file');
            // Ensure no backslashes (Windows style)
            expect(deepFile!.path).not.toContain('\\');
        });
    });

    describe('Error Recovery', () => {
        it('should continue scanning after file access error', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'good1.txt': { name: 'good1.txt', size: 100 },
                'bad.txt': createErrorFile('bad.txt', new Error('Permission denied')),
                'good2.txt': { name: 'good2.txt', size: 200 },
            });

            const results = await collectScanResults(scanner, handle);

            // Should get 2 good files, bad file is skipped
            const files = results.filter((f) => f.type === 'file');
            expect(files).toHaveLength(2);
            expect(files.map((f) => f.name).sort()).toEqual(['good1.txt', 'good2.txt']);
        });

        it('should emit error event and continue on permission denied', async () => {
            const scanner = new FileScanner();
            const errorEvents: { path: string; error: Error }[] = [];
            const unsubscribe = scanner.on('error', (e) => errorEvents.push(e));

            const handle = createMockFileSystem({
                'file1.txt': { name: 'file1.txt', size: 100 },
                'blocked.txt': createErrorFile('blocked.txt', new Error('Permission denied')),
                'file2.txt': { name: 'file2.txt', size: 200 },
            });

            const results = await collectScanResults(scanner, handle);
            unsubscribe();

            // Check results
            expect(results.filter((f) => f.type === 'file')).toHaveLength(2);

            // Check error event
            expect(errorEvents).toHaveLength(1);
            expect(errorEvents[0]).toMatchObject({
                path: 'blocked.txt',
                error: expect.objectContaining({
                    message: 'Permission denied',
                }),
            });
        });

        it('should handle errors in deeply nested directories', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                level1: {
                    'good.txt': { name: 'good.txt', size: 100 },
                    level2: {
                        'bad.txt': createErrorFile('bad.txt', new Error('Access denied')),
                        level3: {
                            'deep.txt': { name: 'deep.txt', size: 200 },
                        },
                    },
                },
            });

            const results = await collectScanResults(scanner, handle);
            const files = results.filter((f) => f.type === 'file');

            // Should still get the good files
            expect(files.map((f) => f.path).sort()).toEqual([
                'level1/good.txt',
                'level1/level2/level3/deep.txt',
            ]);
        });

        it('should handle directory access errors', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                accessible: {
                    'file.txt': { name: 'file.txt', size: 100 },
                },
            });

            // Add a directory that throws on iteration
            const badDir = handle.addDirectory('bad-dir');
            badDir.setError(new DOMException('Not allowed', 'NotAllowedError'));

            // Should complete scan despite error
            await expect(collectScanResults(scanner, handle)).resolves.toBeTruthy();
        });
    });

    describe('Edge Cases', () => {
        it('should handle very long filenames', async () => {
            const scanner = new FileScanner();
            const longName = 'a'.repeat(200) + '.txt';
            const handle = createMockFileSystem({
                [longName]: { name: longName, size: 100 },
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe(longName);
            expect(results[0].path).toBe(longName);
        });

        it('should handle Unicode filenames and paths', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                '你好.txt': { name: '你好.txt', size: 100 },
                émojis: {
                    '😀🎉.md': { name: '😀🎉.md', size: 200 },
                },
            });

            const results = await collectScanResults(scanner, handle);
            const files = results.filter((f) => f.type === 'file');

            expect(files.map((f) => f.path).sort()).toEqual(['émojis/😀🎉.md', '你好.txt']);
        });

        it('should handle special characters in filenames', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'file with spaces.txt': { name: 'file with spaces.txt', size: 100 },
                'file-with-dashes.js': { name: 'file-with-dashes.js', size: 200 },
                'file_with_underscores.py': { name: 'file_with_underscores.py', size: 300 },
                'file.multiple.dots.txt': { name: 'file.multiple.dots.txt', size: 400 },
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(4);
            expect(results.every((f) => f.type === 'file')).toBe(true);
        });

        it('should handle files with no extension', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                README: { name: 'README', size: 100 },
                Makefile: { name: 'Makefile', size: 200 },
                LICENSE: { name: 'LICENSE', size: 300 },
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(3);
            expect(results.every((f) => f.name.indexOf('.') === -1)).toBe(true);
        });

        it('should handle files with empty mimetype', async () => {
            const scanner = new FileScanner();
            const handle = createMockFileSystem({
                'unknown.xyz': { name: 'unknown.xyz', size: 100, type: '' },
                'binary.bin': { name: 'binary.bin', size: 200 }, // No type specified
            });

            const results = await collectScanResults(scanner, handle);
            expect(results).toHaveLength(2);
            expect(results[0].mimeType).toBeUndefined();
            expect(results[1].mimeType).toBeUndefined();
        });
    });
});
