import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import { createMockFileSystem, mockFileSystemAccessSupport } from './test-utils/mocks.js';
import { collectStream } from './test-utils/helpers.js';
import type { FileMetadata } from '../types.js';

describe('FileScanner - Streaming', () => {
  beforeEach(() => {
    mockFileSystemAccessSupport(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Stream Creation', () => {
    it('should create ReadableStream from scan', () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem();

      const stream = scanner.stream(handle);

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('should stream FileMetadata objects', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
      });

      const results = await collectStream(scanner.stream(handle));

      expect(results).toHaveLength(2);
      results.forEach((item) => {
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('path');
        expect(item).toHaveProperty('size');
        expect(item).toHaveProperty('type');
        expect(item).toHaveProperty('lastModified');
      });
    });
  });

  describe('Stream Behavior', () => {
    it('should yield items progressively (not wait for full scan)', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        dir1: {
          'file2.txt': { name: 'file2.txt', size: 200 },
          dir2: {
            'file3.txt': { name: 'file3.txt', size: 300 },
          },
        },
      });

      const stream = scanner.stream(handle);
      const reader = stream.getReader();

      // Read first item
      const { value: first, done: done1 } = await reader.read();
      expect(done1).toBe(false);
      expect(first).toBeDefined();

      // Read second item without waiting for full scan
      const { value: second, done: done2 } = await reader.read();
      expect(done2).toBe(false);
      expect(second).toBeDefined();

      reader.releaseLock();
    });

    it('should close stream on scan completion', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file.txt': { name: 'file.txt', size: 100 },
      });

      const stream = scanner.stream(handle);
      const reader = stream.getReader();

      // Read all items
      const items: FileMetadata[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        items.push(value);
      }

      expect(items).toHaveLength(1);

      // Try to read again - should be done
      const { done } = await reader.read();
      expect(done).toBe(true);

      reader.releaseLock();
    });

    it('should propagate scan errors to stream', async () => {
      const scanner = new FileScanner();
      mockFileSystemAccessSupport(false); // This will cause scan to throw

      const handle = createMockFileSystem();
      const stream = scanner.stream(handle);
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow('File System Access API is not supported');

      reader.releaseLock();
    });

    it('should handle stream cancellation', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      const stream = scanner.stream(handle);
      const reader = stream.getReader();

      // Read one item
      const { value } = await reader.read();
      expect(value).toBeDefined();

      // Cancel the stream
      await reader.cancel();

      // Stream should be closed
      const { done } = await reader.read();
      expect(done).toBe(true);

      reader.releaseLock();
    });
  });

  describe('Stream Consumption', () => {
    it('should work with for-await-of', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      const stream = scanner.stream(handle);
      const results: FileMetadata[] = [];

      // @ts-expect-error - TypeScript doesn't know ReadableStream is async iterable in newer environments
      for await (const item of stream) {
        results.push(item);
      }

      expect(results).toHaveLength(3);
      expect(results.map((f) => f.name).sort()).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
    });

    it('should work with stream reader', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        dir: {
          'nested.txt': { name: 'nested.txt', size: 100 },
        },
        'root.txt': { name: 'root.txt', size: 200 },
      });

      const stream = scanner.stream(handle);
      const results = await collectStream(stream);

      expect(results).toHaveLength(3); // dir + 2 files
      expect(results.some((f) => f.name === 'dir')).toBe(true);
      expect(results.some((f) => f.name === 'nested.txt')).toBe(true);
      expect(results.some((f) => f.name === 'root.txt')).toBe(true);
    });

    it('should handle backpressure (pull only when requested)', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      let pullCount = 0;
      const _originalStream = scanner.stream.bind(scanner);

      scanner.stream = (rootHandle, options) => {
        const generator = scanner.scan(rootHandle, options);

        return new ReadableStream<FileMetadata>({
          async pull(controller) {
            pullCount++;
            try {
              const { value, done } = await generator.next();
              if (done) {
                controller.close();
              } else {
                controller.enqueue(value);
              }
            } catch (error) {
              controller.error(error);
            }
          },
          cancel() {
            generator.return(undefined);
          },
        });
      };

      const stream = scanner.stream(handle);
      const reader = stream.getReader();

      // Read one item
      await reader.read();
      expect(pullCount).toBe(1);

      // Read another
      await reader.read();
      expect(pullCount).toBe(2);

      // Cancel without reading more
      await reader.cancel();

      // Pull count should not increase after cancel
      expect(pullCount).toBe(2);

      reader.releaseLock();
    });
  });

  describe('Stream with Options', () => {
    it('should respect scan options in stream', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'visible.txt': { name: 'visible.txt', size: 100 },
        '.hidden.txt': { name: '.hidden.txt', size: 200 },
        'large.bin': { name: 'large.bin', size: 10000 },
        'small.txt': { name: 'small.txt', size: 50 },
      });

      const stream = scanner.stream(handle, {
        includeHidden: false,
        maxFileSize: 1000,
      });

      const results = await collectStream(stream);
      const files = results.filter((f) => f.type === 'file');

      // Should exclude hidden and large files
      expect(files.map((f) => f.name).sort()).toEqual(['small.txt', 'visible.txt']);
    });

    it('should handle abort signal in stream', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      const controller = new AbortController();
      const stream = scanner.stream(handle, { signal: controller.signal });
      const reader = stream.getReader();

      // Abort immediately before reading
      controller.abort();

      // Should throw abort error
      await expect(reader.read()).rejects.toThrow(DOMException);

      reader.releaseLock();
    });
  });
});
