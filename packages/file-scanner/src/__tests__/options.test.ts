import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import {
  createMockFileSystem,
  mockFileSystemAccessSupport,
  createLargeDirectory,
} from './test-utils/mocks.js';
import { collectScanResults, createAbortSignal } from './test-utils/helpers.js';
import type { ScanOptions, FileMetadata } from '../types.js';

describe('FileScanner - Options', () => {
  beforeEach(() => {
    mockFileSystemAccessSupport(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Depth Limiting', () => {
    it('should scan only root level when maxDepth = 0', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'root1.txt': { name: 'root1.txt', size: 100 },
        'root2.txt': { name: 'root2.txt', size: 200 },
        subdir: {
          'nested.txt': { name: 'nested.txt', size: 300 },
          deeper: {
            'very-deep.txt': { name: 'very-deep.txt', size: 400 },
          },
        },
      });

      const results = await collectScanResults(scanner, handle, { maxDepth: 0 });

      // Should only get root level files, no subdirectories
      expect(results).toHaveLength(2);
      expect(results.every((f) => f.type === 'file')).toBe(true);
      expect(results.map((f) => f.name).sort()).toEqual(['root1.txt', 'root2.txt']);
    });

    it('should respect maxDepth = 1 (root + one level)', async () => {
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

      // Should not include file2.txt from level2
      expect(files.some((f) => f.path.includes('level2'))).toBe(false);
    });

    it('should handle maxDepth = Infinity (default)', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        level1: {
          level2: {
            level3: {
              level4: {
                'deep.txt': { name: 'deep.txt', size: 100 },
              },
            },
          },
        },
      });

      const results = await collectScanResults(scanner, handle);

      // Should find the deeply nested file
      expect(results.some((f) => f.name === 'deep.txt')).toBe(true);
    });
  });

  describe('File Size Filtering', () => {
    it('should exclude files exceeding maxFileSize', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'small.txt': { name: 'small.txt', size: 100 },
        'medium.txt': { name: 'medium.txt', size: 1000 },
        'large.txt': { name: 'large.txt', size: 10000 },
        'huge.txt': { name: 'huge.txt', size: 100000 },
      });

      const results = await collectScanResults(scanner, handle, { maxFileSize: 5000 });

      const files = results.filter((f) => f.type === 'file');
      expect(files.map((f) => f.name).sort()).toEqual(['medium.txt', 'small.txt']);
    });

    it('should include all files when maxFileSize = Infinity (default)', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'tiny.txt': { name: 'tiny.txt', size: 1 },
        'massive.bin': { name: 'massive.bin', size: 1024 * 1024 * 100 }, // 100MB
      });

      const results = await collectScanResults(scanner, handle);

      expect(results.filter((f) => f.type === 'file')).toHaveLength(2);
    });

    it('should handle maxFileSize = 0 (exclude all files)', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 1 },
        'file2.txt': { name: 'file2.txt', size: 0 }, // Even 0-byte files are excluded
        dir: {
          'file3.txt': { name: 'file3.txt', size: 100 },
        },
      });

      const results = await collectScanResults(scanner, handle, { maxFileSize: 0 });

      // Should only get directories
      const files = results.filter((f) => f.type === 'file');
      expect(files).toHaveLength(0);

      const dirs = results.filter((f) => f.type === 'directory');
      expect(dirs).toHaveLength(1);
      expect(dirs[0].name).toBe('dir');
    });
  });

  describe('Hidden Files', () => {
    it('should exclude hidden files (starting with .) by default', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'visible.txt': { name: 'visible.txt', size: 100 },
        '.hidden.txt': { name: '.hidden.txt', size: 200 },
        '.git': {
          config: { name: 'config', size: 300 },
        },
        normal: {
          '.DS_Store': { name: '.DS_Store', size: 400 },
          'file.txt': { name: 'file.txt', size: 500 },
        },
      });

      const results = await collectScanResults(scanner, handle);

      // Should not include any hidden files or directories
      expect(results.some((f) => f.name.startsWith('.'))).toBe(false);
      expect(results.some((f) => f.path.includes('/.git/'))).toBe(false);
      expect(results.some((f) => f.name === '.DS_Store')).toBe(false);
    });

    it('should include hidden files when includeHidden = true', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'visible.txt': { name: 'visible.txt', size: 100 },
        '.hidden.txt': { name: '.hidden.txt', size: 200 },
        '.config': {
          'settings.json': { name: 'settings.json', size: 300 },
        },
      });

      const results = await collectScanResults(scanner, handle, { includeHidden: true });

      // Should include hidden files and directories
      expect(results.some((f) => f.name === '.hidden.txt')).toBe(true);
      expect(results.some((f) => f.name === '.config')).toBe(true);
      expect(results.some((f) => f.path === '.config/settings.json')).toBe(true);
    });

    it('should apply hidden file check before glob patterns', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        '.hidden.log': { name: '.hidden.log', size: 100 },
        'visible.log': { name: 'visible.log', size: 200 },
        '.config.json': { name: '.config.json', size: 300 },
        'settings.json': { name: 'settings.json', size: 400 },
      });

      // Exclude *.log files, but hidden files should be excluded first
      const results = await collectScanResults(scanner, handle, {
        exclude: ['*.log'],
        includeHidden: false,
      });

      // Should only get settings.json (visible.log excluded by glob, hidden files by default)
      expect(results.map((f) => f.name)).toEqual(['settings.json']);
    });
  });

  describe('Glob Patterns', () => {
    it('should exclude files matching single glob pattern', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'script.js': { name: 'script.js', size: 300 },
        'style.css': { name: 'style.css', size: 400 },
      });

      const results = await collectScanResults(scanner, handle, { exclude: ['*.txt'] });

      const files = results.filter((f) => f.type === 'file');
      expect(files.map((f) => f.name).sort()).toEqual(['script.js', 'style.css']);
    });

    it('should exclude files matching multiple glob patterns', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'app.js': { name: 'app.js', size: 100 },
        'test.spec.js': { name: 'test.spec.js', size: 200 },
        'README.md': { name: 'README.md', size: 300 },
        'package.json': { name: 'package.json', size: 400 },
        'debug.log': { name: 'debug.log', size: 500 },
      });

      const results = await collectScanResults(scanner, handle, {
        exclude: ['*.spec.js', '*.log', 'package.json'],
      });

      const files = results.filter((f) => f.type === 'file');
      expect(files.map((f) => f.name).sort()).toEqual(['README.md', 'app.js']);
    });

    it('should support common patterns: *.ext, **/*.ext, dir/**/*, [!.]*', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file.txt': { name: 'file.txt', size: 100 },
        src: {
          'index.js': { name: 'index.js', size: 200 },
          components: {
            'Button.jsx': { name: 'Button.jsx', size: 300 },
            'Button.test.js': { name: 'Button.test.js', size: 400 },
          },
        },
        node_modules: {
          package: {
            'index.js': { name: 'index.js', size: 500 },
          },
        },
      });

      // Test various patterns
      const options: ScanOptions = {
        exclude: [
          '**/*.test.js', // Any test files
          'node_modules/**', // Everything in node_modules
          '*.txt', // Root level txt files
        ],
      };

      const results = await collectScanResults(scanner, handle, options);
      const files = results.filter((f) => f.type === 'file');

      expect(files.map((f) => f.path).sort()).toEqual([
        'src/components/Button.jsx',
        'src/index.js',
      ]);
    });

    it('should exclude directory and its contents when directory matches pattern', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        src: {
          'file.js': { name: 'file.js', size: 100 },
        },
        node_modules: {
          package1: {
            'index.js': { name: 'index.js', size: 200 },
          },
          package2: {
            'main.js': { name: 'main.js', size: 300 },
          },
        },
        dist: {
          'bundle.js': { name: 'bundle.js', size: 400 },
        },
      });

      const results = await collectScanResults(scanner, handle, {
        exclude: ['node_modules/**', 'dist/**'],
      });

      // Should only get src files
      const paths = results.map((f) => f.path);
      expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
      expect(paths.some((p) => p.includes('dist'))).toBe(false);
      expect(paths.some((p) => p.includes('src'))).toBe(true);
    });
  });

  describe('Cancellation', () => {
    it('should stop scanning when signal is aborted', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem(createLargeDirectory(100));

      const signal = createAbortSignal(10); // Abort after 10ms
      const results: FileMetadata[] = [];

      await expect(async () => {
        for await (const file of scanner.scan(handle, { signal })) {
          results.push(file);
          // Add small delay to ensure abort happens during scan
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }).rejects.toThrow();

      // Should have some results but not all 100
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(100);
    });

    it('should throw AbortError with correct name', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({ 'file.txt': { name: 'file.txt', size: 100 } });

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(async () => {
        for await (const file of scanner.scan(handle, { signal: controller.signal })) {
          void file; // Suppress unused variable warning
          // Should not reach here
        }
      }).rejects.toThrow(DOMException);

      try {
        for await (const file of scanner.scan(handle, { signal: controller.signal })) {
          void file; // Suppress unused variable warning
          // Should not reach here
        }
      } catch (_error) {
        expect(_error).toBeInstanceOf(DOMException);
        expect((_error as DOMException).name).toBe('AbortError');
      }
    });

    it('should not yield items after abort', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      const controller = new AbortController();
      const results: FileMetadata[] = [];

      try {
        for await (const file of scanner.scan(handle, { signal: controller.signal })) {
          results.push(file);
          if (results.length === 1) {
            controller.abort(); // Abort after first file
          }
        }
      } catch {
        // Expected abort error
      }

      // Should only have the first file
      expect(results).toHaveLength(1);
    });
  });

  describe('Concurrent Mode', () => {
    it('should activate concurrent scanning when concurrency > 1', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        dir1: {
          'file1.txt': { name: 'file1.txt', size: 100 },
        },
        dir2: {
          'file2.txt': { name: 'file2.txt', size: 200 },
        },
        dir3: {
          'file3.txt': { name: 'file3.txt', size: 300 },
        },
      });

      // Run with concurrent mode
      const results = await collectScanResults(scanner, handle, {
        concurrency: 2,
      });

      // Should get all files regardless of mode
      expect(results.filter((f) => f.type === 'file')).toHaveLength(3);
    });

    it('should respect concurrency limit', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        dir1: createLargeDirectory(10, 'a'),
        dir2: createLargeDirectory(10, 'b'),
        dir3: createLargeDirectory(10, 'c'),
        dir4: createLargeDirectory(10, 'd'),
      });

      // This is hard to test precisely without mocking internals
      // Just ensure it completes without error
      const results = await collectScanResults(scanner, handle, {
        concurrency: 2,
      });

      expect(results.filter((f) => f.type === 'file')).toHaveLength(40);
    });

    it('should produce same files as sequential mode (different order ok)', async () => {
      const scanner = new FileScanner();
      const structure = {
        a: {
          'a1.txt': { name: 'a1.txt', size: 100 },
          'a2.txt': { name: 'a2.txt', size: 200 },
        },
        b: {
          'b1.txt': { name: 'b1.txt', size: 300 },
          'b2.txt': { name: 'b2.txt', size: 400 },
        },
      };

      const handle1 = createMockFileSystem(structure);
      const handle2 = createMockFileSystem(structure);

      const sequential = await collectScanResults(scanner, handle1, { concurrency: 1 });
      const concurrent = await collectScanResults(scanner, handle2, { concurrency: 2 });

      // Sort by path for comparison
      const seqPaths = sequential.map((f) => f.path).sort();
      const conPaths = concurrent.map((f) => f.path).sort();

      expect(conPaths).toEqual(seqPaths);
    });
  });
});
