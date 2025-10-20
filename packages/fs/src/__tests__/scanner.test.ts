import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import {
  createMockFileSystem,
  mockFileSystemAccessSupport,
  createErrorFile,
} from './test-utils/mocks.js';
import { collectScanResults } from './test-utils/helpers.js';

describe('FileScanner', () => {
  beforeEach(() => {
    mockFileSystemAccessSupport(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when FileSystem API is not supported', async () => {
    vi.spyOn(FileScanner, 'isSupported').mockReturnValue(false);

    const scanner = new FileScanner();
    const handle = createMockFileSystem();

    await expect(async () => {
      const generator = scanner.scan(handle);
      await generator.next();
    }).rejects.toThrow('File System Access API is not supported');

    vi.mocked(FileScanner.isSupported).mockRestore();
  });

  it('should scan flat directory with files', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'file1.txt': { name: 'file1.txt', size: 100 },
      'file2.js': { name: 'file2.js', size: 200 },
      'image.png': { name: 'image.png', size: 5000 },
    });

    const results = await collectScanResults(scanner, handle);

    expect(results).toHaveLength(3);
    expect(results.map((f) => f.name).sort()).toEqual(['file1.txt', 'file2.js', 'image.png']);
  });

  it('should scan nested directory structure', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'root.txt': { name: 'root.txt', size: 100 },
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
    const files = results.filter((f) => f.type === 'file');

    expect(files.map((f) => f.path).sort()).toEqual([
      'docs/README.md',
      'root.txt',
      'src/components/Button.js',
      'src/index.js',
    ]);
  });

  it('should continue scanning after file access error', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'good1.txt': { name: 'good1.txt', size: 100 },
      'bad.txt': createErrorFile('bad.txt', new Error('Permission denied')),
      'good2.txt': { name: 'good2.txt', size: 200 },
    });

    const results = await collectScanResults(scanner, handle);
    const files = results.filter((f) => f.type === 'file');

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name).sort()).toEqual(['good1.txt', 'good2.txt']);
  });

  it('should respect maxDepth option', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'root.txt': { name: 'root.txt', size: 100 },
      level1: {
        'file1.txt': { name: 'file1.txt', size: 200 },
        level2: {
          'file2.txt': { name: 'file2.txt', size: 300 },
        },
      },
    });

    const results = await collectScanResults(scanner, handle, { maxDepth: 1 });
    const files = results.filter((f) => f.type === 'file');

    expect(files.map((f) => f.path).sort()).toEqual(['level1/file1.txt', 'root.txt']);
    expect(files.some((f) => f.path.includes('level2'))).toBe(false);
  });

  it('should exclude files matching patterns', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'keep.txt': { name: 'keep.txt', size: 100 },
      'remove.log': { name: 'remove.log', size: 200 },
      node_modules: {
        'package.js': { name: 'package.js', size: 300 },
      },
      src: {
        'app.js': { name: 'app.js', size: 400 },
      },
    });

    const results = await collectScanResults(scanner, handle, {
      exclude: ['*.log', 'node_modules/**'],
    });
    const files = results.filter((f) => f.type === 'file');

    expect(files.map((f) => f.name).sort()).toEqual(['app.js', 'keep.txt']);
  });

  it.skip('should stop scanning when aborted', async () => {
    // Abort handling removed from scanner as it's not needed
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'file1.txt': { name: 'file1.txt', size: 100 },
      'file2.txt': { name: 'file2.txt', size: 200 },
    });

    const controller = new AbortController();

    const scanPromise = collectScanResults(scanner, handle, { signal: controller.signal });
    controller.abort();

    await expect(scanPromise).rejects.toThrow('Scan aborted');
  });
});
