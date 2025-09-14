import { expect } from 'vitest';
import type { FileMetadata, ScanOptions, ScannerEvents } from '../../types.js';
import type { FileScanner } from '../../scanner.js';

/**
 * Collect all scan results into an array
 */
export async function collectScanResults(
  scanner: FileScanner,
  handle: FileSystemDirectoryHandle,
  options?: ScanOptions,
): Promise<FileMetadata[]> {
  const results: FileMetadata[] = [];
  for await (const file of scanner.scan(handle, options)) {
    results.push(file);
  }
  return results;
}

/**
 * Collect all events of a specific type during a scan
 */
export async function collectEvents<K extends keyof ScannerEvents>(
  scanner: FileScanner,
  eventName: K,
  scanPromise: Promise<void>,
): Promise<ScannerEvents[K][]> {
  const events: ScannerEvents[K][] = [];
  const unsubscribe = scanner.on(eventName, (data) => {
    events.push(data);
  });

  try {
    await scanPromise;
  } finally {
    unsubscribe();
  }

  return events;
}

/**
 * Create an AbortSignal that aborts after a specified delay
 */
export function createAbortSignal(abortAfterMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), abortAfterMs);
  return controller.signal;
}

/**
 * Wait for a specific number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a scan and collect all events
 */
export async function runScanWithEvents(
  scanner: FileScanner,
  handle: FileSystemDirectoryHandle,
  options?: ScanOptions,
): Promise<{
  files: FileMetadata[];
  fileEvents: FileMetadata[];
  progressEvents: ScannerEvents['progress'][];
  errorEvents: ScannerEvents['error'][];
  completeEvents: ScannerEvents['complete'][];
}> {
  const fileEvents: FileMetadata[] = [];
  const progressEvents: ScannerEvents['progress'][] = [];
  const errorEvents: ScannerEvents['error'][] = [];
  const completeEvents: ScannerEvents['complete'][] = [];

  const unsubscribeFile = scanner.on('file', (data) => fileEvents.push(data));
  const unsubscribeProgress = scanner.on('progress', (data) => progressEvents.push(data));
  const unsubscribeError = scanner.on('error', (data) => errorEvents.push(data));
  const unsubscribeComplete = scanner.on('complete', (data) => completeEvents.push(data));

  const files = await collectScanResults(scanner, handle, options);

  unsubscribeFile();
  unsubscribeProgress();
  unsubscribeError();
  unsubscribeComplete();

  return {
    files,
    fileEvents,
    progressEvents,
    errorEvents,
    completeEvents,
  };
}

/**
 * Assert that two file metadata objects are equal (ignoring lastModified)
 */
export function assertFileMetadataEqual(
  actual: FileMetadata,
  expected: Partial<FileMetadata>,
): void {
  expect(actual.name).toBe(expected.name);
  expect(actual.path).toBe(expected.path);
  expect(actual.type).toBe(expected.type);
  expect(actual.size).toBe(expected.size);
  if (expected.mimeType !== undefined) {
    expect(actual.mimeType).toBe(expected.mimeType);
  }
}

/**
 * Create a stream reader and collect all chunks
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks;
}
