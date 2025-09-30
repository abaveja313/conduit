import mitt, { Emitter } from 'mitt';
import picomatch from 'picomatch';
import { join } from 'pathe';
import { createLogger, ErrorCodes, wrapError, isAbortError } from '@conduit/shared';
import type { FileMetadata, ScanOptions, ScannerEvents } from './types.js';
import { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';

const logger = createLogger('file-scanner');

/**
 * Modern file scanner for browser File System Access API
 */
export class FileScanner {
  private emitter: Emitter<ScannerEvents>;
  private readonly defaultOptions: Required<Omit<ScanOptions, 'fileFilter'>> & { fileFilter?: ScanOptions['fileFilter'] } = {
    exclude: [],
    maxDepth: Infinity,
    includeHidden: false,
    maxFileSize: Infinity,
    concurrency: 3,
    signal: new AbortController().signal,
    fileFilter: undefined,
  };

  constructor() {
    this.emitter = mitt<ScannerEvents>();
  }

  /**
   * Check if File System Access API is supported
   */
  static isSupported(): boolean {
    return isFileSystemAccessSupported();
  }

  /**
   * Subscribe to scanner events
   */
  on<K extends keyof ScannerEvents>(event: K, handler: (data: ScannerEvents[K]) => void) {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  /**
   * Scan a directory and yield file metadata
   */
  async *scan(
    rootHandle: FileSystemDirectoryHandle,
    options: ScanOptions = {},
  ): AsyncGenerator<FileMetadata> {
    if (!FileScanner.isSupported()) {
      throw new Error('File System Access API is not supported in this browser');
    }

    const opts = { ...this.defaultOptions, ...options };

    const startTime = performance.now();
    const processedCount = 0;

    const shouldExclude = (path: string) => {
      return opts.exclude.length > 0 && picomatch.isMatch(path, opts.exclude);
    };

    try {
      if (opts.concurrency > 1) {
        logger.info('Using concurrent scanning', { concurrency: opts.concurrency });
        yield* this.scanConcurrent(rootHandle, opts, shouldExclude, startTime);
      } else {
        yield* this.scanSequential(
          rootHandle,
          '',
          0,
          opts,
          shouldExclude,
          processedCount,
          startTime,
        );
      }
    } catch (error) {
      if (isAbortError(error)) {
        logger.info('Scan aborted');
        throw error; // Let DOMException propagate
      } else {
        const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
          rootHandle: rootHandle.name,
          operation: 'scan',
        });
        logger.error('Scan failed', wrappedError.toJSON());
        throw wrappedError;
      }
    }
  }

  /**
   * Sequential scanning (default)
   */
  private async *scanSequential(
    dirHandle: FileSystemDirectoryHandle,
    parentPath: string,
    depth: number,
    opts: Required<Omit<ScanOptions, 'fileFilter'>> & { fileFilter?: ScanOptions['fileFilter'] },
    shouldExclude: (path: string) => boolean,
    processedCount: number,
    startTime: number,
  ): AsyncGenerator<FileMetadata> {
    if (opts.signal?.aborted) {
      throw new DOMException('Scan aborted', 'AbortError');
    }

    if (depth > opts.maxDepth) {
      return;
    }

    // For root directory, use empty path; for subdirectories, use the parentPath as-is
    const dirPath = parentPath;

    for await (const [name, handle] of dirHandle.entries()) {
      if (opts.signal?.aborted) {
        throw new DOMException('Scan aborted', 'AbortError');
      }

      if (!opts.includeHidden && name.startsWith('.')) {
        continue;
      }

      const entryPath = dirPath ? join(dirPath, name) : name;

      if (shouldExclude(entryPath)) {
        logger.debug('Excluded by pattern', { path: entryPath });
        continue;
      }

      let metadata: FileMetadata | null = null;

      try {
        if (isFileHandle(handle)) {
          const file = await handle.getFile();

          if (opts.maxFileSize === 0 || file.size > opts.maxFileSize) {
            logger.debug('File exceeds size limit', { path: entryPath, size: file.size });
            continue;
          }

          // Apply optional file filter
          if (opts.fileFilter && !opts.fileFilter(file, entryPath)) {
            logger.debug('File filtered out', { path: entryPath });
            continue;
          }

          metadata = {
            path: entryPath,
            name,
            size: file.size,
            type: 'file',
            lastModified: file.lastModified,
            handle: handle,
          };
        } else if (isDirectoryHandle(handle)) {
          // Only yield directory metadata if we're going to scan into it
          if (depth < opts.maxDepth) {
            metadata = {
              path: entryPath,
              name,
              size: 0,
              type: 'directory',
              lastModified: Date.now(),
              handle: handle,
            };
          }

          // Recursively scan subdirectories
          if (depth < opts.maxDepth) {
            yield* this.scanSequential(
              handle,
              entryPath,
              depth + 1,
              opts,
              shouldExclude,
              processedCount,
              startTime,
            );
          }
        } else {
          continue;
        }
      } catch (error) {
        logger.error('Error processing entry', { path: entryPath, error });
        const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
          path: entryPath,
          operation: 'process_entry',
        });
        this.emitter.emit('error', {
          path: entryPath,
          error: wrappedError,
        });
        continue;
      }

      // Yield metadata and emit events if we have metadata
      if (metadata) {
        processedCount++;
        yield metadata;

        // Emit events - these can throw but shouldn't stop scanning
        try {
          this.emitter.emit('file', metadata);
          this.emitter.emit('progress', {
            processed: processedCount,
            currentPath: entryPath,
          });
        } catch (eventError) {
          // Log event listener errors but continue scanning
          logger.error('Error in event listener', eventError);
        }
      }
    }

    // Emit complete event when done with root
    if (depth === 0) {
      this.emitter.emit('complete', {
        processed: processedCount,
        duration: Math.max(1, Math.round(performance.now() - startTime)),
      });
    }
  }

  /**
   * Concurrent scanning (experimental)
   */
  private async *scanConcurrent(
    rootHandle: FileSystemDirectoryHandle,
    opts: Required<Omit<ScanOptions, 'fileFilter'>> & { fileFilter?: ScanOptions['fileFilter'] },
    shouldExclude: (path: string) => boolean,
    startTime: number,
  ): AsyncGenerator<FileMetadata> {
    // Queue of directories to process
    const queue: Array<{ handle: FileSystemDirectoryHandle; path: string; depth: number }> = [
      { handle: rootHandle, path: '', depth: 0 },
    ];

    const results: FileMetadata[] = [];
    let processedCount = 0;
    const processing = new Set<Promise<void>>();

    const processDirectory = async (dir: (typeof queue)[0]) => {
      if (dir.depth > opts.maxDepth) return;

      for await (const [name, handle] of dir.handle.entries()) {
        if (opts.signal?.aborted) break;


        if (!opts.includeHidden && name.startsWith('.')) {
          continue;
        }

        const entryPath = dir.path ? join(dir.path, name) : name;
        if (shouldExclude(entryPath)) continue;

        try {
          if (isFileHandle(handle)) {
            const file = await handle.getFile();
            // Check if file size exceeds max (skip if too large)
            if (opts.maxFileSize !== Infinity && file.size > opts.maxFileSize) {
              continue;
            }

            // Apply optional file filter
            if (opts.fileFilter && !opts.fileFilter(file, entryPath)) {
              continue;
            }

            const metadata: FileMetadata = {
              path: entryPath,
              name,
              size: file.size,
              type: 'file',
              lastModified: file.lastModified,
              handle, // Make sure to include the handle
            };

            results.push(metadata);
            processedCount++;
            this.emitter.emit('file', metadata);
          } else if (isDirectoryHandle(handle)) {
            const metadata: FileMetadata = {
              path: entryPath,
              name,
              size: 0,
              type: 'directory',
              lastModified: Date.now(),
            };

            results.push(metadata);
            processedCount++;
            this.emitter.emit('file', metadata);

            queue.push({ handle, path: entryPath, depth: dir.depth + 1 });
          }
        } catch (error) {
          const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
            path: entryPath,
            operation: 'process_concurrent',
          });
          this.emitter.emit('error', {
            path: entryPath,
            error: wrappedError,
          });
        }
      }
    };

    // Process directories with concurrency limit
    while (queue.length > 0 || processing.size > 0) {
      if (opts.signal?.aborted) {
        throw new DOMException('Scan aborted', 'AbortError');
      }

      while (queue.length > 0 && processing.size < opts.concurrency) {
        const dir = queue.shift()!;
        const promise = processDirectory(dir)
          .then(() => {
            processing.delete(promise);
            this.emitter.emit('progress', {
              processed: processedCount,
              currentPath: dir.path,
            });
          })
          .catch((error) => {
            processing.delete(promise);
            // Re-throw abort errors
            if (error.name === 'AbortError') {
              throw error;
            }
            // Log other errors but continue
            logger.error('Error processing directory', error);
          });
        processing.add(promise);
      }

      // Wait for at least one to complete
      if (processing.size > 0) {
        await Promise.race(processing);
      }

      // Check abort again before yielding results
      if (opts.signal?.aborted) {
        throw new DOMException('Scan aborted', 'AbortError');
      }

      // Yield accumulated results
      while (results.length > 0) {
        yield results.shift()!;
      }
    }

    this.emitter.emit('complete', {
      processed: processedCount,
      duration: Math.max(1, Math.round(performance.now() - startTime)),
    });
  }

  /**
   * Create a ReadableStream for the scan results
   */
  stream(
    rootHandle: FileSystemDirectoryHandle,
    options: ScanOptions = {},
  ): ReadableStream<FileMetadata> {
    const generator = this.scan(rootHandle, options);

    return new ReadableStream<FileMetadata>({
      async pull(controller) {
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
      async cancel() {
        try {
          await generator.return?.(undefined);
        } catch {
          // Ignore cancellation errors
        }
      },
    });
  }
}
