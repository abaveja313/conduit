import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import {
  createMockFileSystem,
  mockFileSystemAccessSupport,
  createErrorFile,
} from './test-utils/mocks.js';
import { collectScanResults, runScanWithEvents } from './test-utils/helpers.js';
import type { ScannerEvents, FileMetadata } from '../types.js';

describe('FileScanner - Events', () => {
  beforeEach(() => {
    mockFileSystemAccessSupport(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Event Emission', () => {
    it('should emit file event for each file and directory', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        dir1: {
          'file2.txt': { name: 'file2.txt', size: 200 },
        },
      });

      const { fileEvents } = await runScanWithEvents(scanner, handle);

      // Should emit event for each file and directory
      expect(fileEvents).toHaveLength(3); // file1, dir1, file2
      expect(fileEvents.map((f) => f.name).sort()).toEqual(['dir1', 'file1.txt', 'file2.txt']);
    });

    it('should emit progress event periodically', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
        'file4.txt': { name: 'file4.txt', size: 400 },
        'file5.txt': { name: 'file5.txt', size: 500 },
      });

      const { progressEvents } = await runScanWithEvents(scanner, handle);

      // Should have multiple progress events
      expect(progressEvents.length).toBeGreaterThan(0);

      // Progress should increase
      const processedCounts = progressEvents.map((e) => e.processed);
      for (let i = 1; i < processedCounts.length; i++) {
        expect(processedCounts[i]).toBeGreaterThanOrEqual(processedCounts[i - 1]);
      }
    });

    it('should emit complete event when scan finishes', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
      });

      const { completeEvents } = await runScanWithEvents(scanner, handle);

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toMatchObject({
        processed: 2,
        duration: expect.any(Number),
      });
      expect(completeEvents[0].duration).toBeGreaterThan(0);
    });

    it('should emit error event on file access errors', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'good.txt': { name: 'good.txt', size: 100 },
        'bad.txt': createErrorFile('bad.txt', new Error('Access denied')),
      });

      const { errorEvents } = await runScanWithEvents(scanner, handle);

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        path: 'bad.txt',
        error: expect.objectContaining({
          message: 'Access denied',
        }),
      });
    });
  });

  describe('Event Data', () => {
    it('should emit file event with correct FileMetadata', async () => {
      const scanner = new FileScanner();
      const now = Date.now();
      const handle = createMockFileSystem({
        'test.pdf': {
          name: 'test.pdf',
          size: 1024,
          type: 'application/pdf',
          lastModified: now,
        },
      });

      const fileEvents: FileMetadata[] = [];
      const unsubscribe = scanner.on('file', (data) => fileEvents.push(data));

      await collectScanResults(scanner, handle);
      unsubscribe();

      expect(fileEvents).toHaveLength(1);
      expect(fileEvents[0]).toMatchObject({
        name: 'test.pdf',
        path: 'test.pdf',
        size: 1024,
        type: 'file',
        lastModified: now,
        mimeType: 'application/pdf',
      });
    });

    it('should emit progress event with processed count and currentPath', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        dir1: {
          'file1.txt': { name: 'file1.txt', size: 100 },
        },
        dir2: {
          'file2.txt': { name: 'file2.txt', size: 200 },
        },
      });

      const progressEvents: ScannerEvents['progress'][] = [];
      const unsubscribe = scanner.on('progress', (data) => progressEvents.push(data));

      await collectScanResults(scanner, handle);
      unsubscribe();

      // Check progress event structure
      expect(progressEvents.length).toBeGreaterThan(0);
      progressEvents.forEach((event) => {
        expect(event).toHaveProperty('processed');
        expect(event).toHaveProperty('currentPath');
        expect(typeof event.processed).toBe('number');
        expect(typeof event.currentPath).toBe('string');
      });
    });

    it('should emit complete event with final stats and duration', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      let completeEvent: ScannerEvents['complete'] | null = null;
      const unsubscribe = scanner.on('complete', (data) => {
        completeEvent = data;
      });

      const startTime = Date.now();
      await collectScanResults(scanner, handle);
      const endTime = Date.now();
      unsubscribe();

      expect(completeEvent).not.toBeNull();
      expect(completeEvent!.processed).toBe(3);
      expect(completeEvent!.duration).toBeGreaterThan(0);
      expect(completeEvent!.duration).toBeLessThanOrEqual(endTime - startTime + 10); // Allow small margin
    });

    it('should emit error event with path and Error object', async () => {
      const scanner = new FileScanner();
      const customError = new Error('Custom error message');
      const handle = createMockFileSystem({
        'problem.txt': createErrorFile('problem.txt', customError),
      });

      let errorEvent: ScannerEvents['error'] | null = null;
      const unsubscribe = scanner.on('error', (data) => {
        errorEvent = data;
      });

      await collectScanResults(scanner, handle);
      unsubscribe();

      expect(errorEvent).not.toBeNull();
      expect(errorEvent!.path).toBe('problem.txt');
      expect(errorEvent!.error).toBeInstanceOf(Error);
      expect(errorEvent!.error.message).toBe('Custom error message');
    });
  });

  describe('Event Management', () => {
    it('should support multiple listeners for same event', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file.txt': { name: 'file.txt', size: 100 },
      });

      const listener1Events: FileMetadata[] = [];
      const listener2Events: FileMetadata[] = [];

      const unsubscribe1 = scanner.on('file', (data) => listener1Events.push(data));
      const unsubscribe2 = scanner.on('file', (data) => listener2Events.push(data));

      await collectScanResults(scanner, handle);

      unsubscribe1();
      unsubscribe2();

      expect(listener1Events).toHaveLength(1);
      expect(listener2Events).toHaveLength(1);
      expect(listener1Events[0]).toEqual(listener2Events[0]);
    });

    it('should return unsubscribe function from on()', () => {
      const scanner = new FileScanner();
      const unsubscribe = scanner.on('file', () => {});

      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('Event Ordering', () => {
    it('should emit complete event after all file events', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'file2.txt': { name: 'file2.txt', size: 200 },
        'file3.txt': { name: 'file3.txt', size: 300 },
      });

      const eventOrder: string[] = [];

      scanner.on('file', (data) => {
        eventOrder.push(`file:${data.name}`);
      });

      scanner.on('complete', () => {
        eventOrder.push('complete');
      });

      await collectScanResults(scanner, handle);

      // Complete should be last
      expect(eventOrder[eventOrder.length - 1]).toBe('complete');

      // All files should come before complete
      const completeIndex = eventOrder.indexOf('complete');
      const fileEvents = eventOrder.slice(0, completeIndex);
      expect(fileEvents).toHaveLength(3);
      expect(fileEvents.every((e) => e.startsWith('file:'))).toBe(true);
    });

    it('should emit error events inline with file scanning', async () => {
      const scanner = new FileScanner();
      const handle = createMockFileSystem({
        'file1.txt': { name: 'file1.txt', size: 100 },
        'bad.txt': createErrorFile('bad.txt'),
        'file2.txt': { name: 'file2.txt', size: 200 },
      });

      const eventOrder: string[] = [];

      scanner.on('file', (data) => {
        eventOrder.push(`file:${data.name}`);
      });

      scanner.on('error', (data) => {
        eventOrder.push(`error:${data.path}`);
      });

      await collectScanResults(scanner, handle);

      // Error should appear between file events
      expect(eventOrder).toContain('file:file1.txt');
      expect(eventOrder).toContain('error:bad.txt');
      expect(eventOrder).toContain('file:file2.txt');

      // Error should come after file1 but before file2
      const file1Index = eventOrder.indexOf('file:file1.txt');
      const errorIndex = eventOrder.indexOf('error:bad.txt');
      const file2Index = eventOrder.indexOf('file:file2.txt');

      expect(errorIndex).toBeGreaterThan(file1Index);
      expect(errorIndex).toBeLessThan(file2Index);
    });
  });
});
