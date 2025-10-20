import mitt, { Emitter } from 'mitt';
import picomatch from 'picomatch';
import { join } from 'pathe';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';
import type { FileMetadata, ScanOptions, ScannerEvents } from './types.js';
import { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';
import { getOptimalConcurrency } from './concurrency-utils.js';

const logger = createLogger('file-scanner');

/**
 * Modern file scanner for browser File System Access API
 */
export class FileScanner {
  private emitter: Emitter<ScannerEvents>;
  private readonly defaultOptions: Required<Omit<ScanOptions, 'fileFilter'>> & {
    fileFilter?: ScanOptions['fileFilter'];
  } = {
      exclude: [],
      maxDepth: Infinity,
      includeHidden: false,
      maxFileSize: Infinity,
      concurrency: getOptimalConcurrency(),
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
    const state = { processedCount: 0 };

    const shouldExclude = (path: string) => {
      return opts.exclude.length > 0 && picomatch.isMatch(path, opts.exclude);
    };

    try {
      if (opts.concurrency > 1) {
        logger.info('Using optimized concurrent scanning ', { concurrency: opts.concurrency });
        yield* this.scanConcurrent(rootHandle, opts, shouldExclude, startTime);
      } else {
        yield* this.scanSequential(rootHandle, '', 0, opts, shouldExclude, state, startTime);
      }
    } catch (error) {
      const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
        rootHandle: rootHandle.name,
        operation: 'scan',
      });
      logger.error('Scan failed', wrappedError.toJSON());
      throw wrappedError;
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
    state: { processedCount: number },
    startTime: number,
  ): AsyncGenerator<FileMetadata> {
    if (depth > opts.maxDepth) {
      return;
    }

    const dirPath = parentPath;

    for await (const [name, handle] of dirHandle.entries()) {
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

          if (depth < opts.maxDepth) {
            yield* this.scanSequential(
              handle,
              entryPath,
              depth + 1,
              opts,
              shouldExclude,
              state,
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

      if (metadata) {
        state.processedCount++;
        yield metadata;

        try {
          this.emitter.emit('file', metadata);
          this.emitter.emit('progress', {
            processed: state.processedCount,
            currentPath: entryPath,
          });
        } catch (eventError) {
          logger.error('Error in event listener', eventError);
        }
      }
    }

    if (depth === 0) {
      this.emitter.emit('complete', {
        processed: state.processedCount,
        duration: Math.max(1, Math.round(performance.now() - startTime)),
      });
    }
  }

  /**
   * Concurrent scanning with improved parallelism
   */
  private async *scanConcurrent(
    rootHandle: FileSystemDirectoryHandle,
    opts: Required<Omit<ScanOptions, 'fileFilter'>> & { fileFilter?: ScanOptions['fileFilter'] },
    shouldExclude: (path: string) => boolean,
    startTime: number,
  ): AsyncGenerator<FileMetadata> {
    // Single work queue for all entries (files and directories)
    interface WorkItem {
      type: 'directory' | 'file';
      handle: FileSystemHandle;
      path: string;
      name: string;
      depth: number;
    }

    const workQueue: WorkItem[] = [
      { type: 'directory', handle: rootHandle, path: '', name: '', depth: 0 },
    ];

    const results: FileMetadata[] = [];
    let processedCount = 0;
    const processing = new Set<Promise<void>>();

    const processWorkItem = async (item: WorkItem): Promise<void> => {
      const { type, handle, path, name, depth } = item;

      if (type === 'directory') {
        if (depth > opts.maxDepth) return;

        const dirHandle = handle as FileSystemDirectoryHandle;

        // Emit directory metadata
        const metadata: FileMetadata = {
          path,
          name,
          size: 0,
          type: 'directory',
          lastModified: Date.now(),
          handle: dirHandle,
        };

        if (path !== '') { // Don't emit root directory
          results.push(metadata);
          processedCount++;
          this.emitter.emit('file', metadata);
        }

        // Queue all entries from this directory
        try {
          for await (const [entryName, entryHandle] of dirHandle.entries()) {
            // Early filtering
            if (!opts.includeHidden && entryName.startsWith('.')) {
              continue;
            }

            const entryPath = path ? join(path, entryName) : entryName;
            if (shouldExclude(entryPath)) continue;

            // Add to work queue for parallel processing
            workQueue.push({
              type: isFileHandle(entryHandle) ? 'file' : 'directory',
              handle: entryHandle,
              path: entryPath,
              name: entryName,
              depth: depth + 1,
            });
          }
        } catch (error) {
          const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
            path,
            operation: 'read_directory',
          });
          this.emitter.emit('error', { path, error: wrappedError });
        }
      } else {
        // Process file
        try {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();

          // Apply filters
          if (opts.maxFileSize !== Infinity && file.size > opts.maxFileSize) {
            return;
          }

          if (opts.fileFilter && !opts.fileFilter(file, path)) {
            return;
          }

          const metadata: FileMetadata = {
            path,
            name,
            size: file.size,
            type: 'file',
            lastModified: file.lastModified,
            handle: fileHandle,
          };

          results.push(metadata);
          processedCount++;
          this.emitter.emit('file', metadata);
        } catch (error) {
          const wrappedError = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
            path,
            operation: 'read_file',
          });
          this.emitter.emit('error', { path, error: wrappedError });
        }
      }
    };

    // Process work queue with improved parallelism
    while (workQueue.length > 0 || processing.size > 0) {

      // Start processing up to concurrency limit
      while (workQueue.length > 0 && processing.size < opts.concurrency) {
        const workItem = workQueue.shift()!;

        const promise = processWorkItem(workItem)
          .then(() => {
            processing.delete(promise);
            this.emitter.emit('progress', {
              processed: processedCount,
              currentPath: workItem.path,
            });
          })
          .catch((error) => {
            processing.delete(promise);
            logger.error(`Error processing ${workItem.type}: ${workItem.path}`, error);
          });

        processing.add(promise);
      }

      // Wait for at least one task to complete
      if (processing.size > 0) {
        await Promise.race(processing);
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
