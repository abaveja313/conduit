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
  private readonly defaultOptions: Required<ScanOptions> = {
    exclude: [],
    maxDepth: Infinity,
    includeHidden: false,
    maxFileSize: Infinity,
    concurrency: 1,
    signal: new AbortController().signal,
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

    // DEBUG: Log scan start
    console.log('DEBUG Scanner: Starting scan of', rootHandle.name);
    console.log('DEBUG Scanner: Options received:', options);

    const opts = { ...this.defaultOptions, ...options };
    console.log('DEBUG Scanner: Merged options:', opts);

    const startTime = performance.now();
    const processedCount = 0;

    const shouldExclude = (path: string) => {
      const isExcluded = opts.exclude.length > 0 && picomatch.isMatch(path, opts.exclude);
      if (isExcluded) {
        console.log('DEBUG Scanner: Excluding path:', path);
      }
      return isExcluded;
    };

    try {
      if (opts.concurrency > 1) {
        console.log('DEBUG Scanner: Using concurrent scanning with concurrency:', opts.concurrency);
        logger.info('Using concurrent scanning', { concurrency: opts.concurrency });
        yield* this.scanConcurrent(rootHandle, opts, shouldExclude, startTime);
      } else {
        console.log('DEBUG Scanner: Using sequential scanning');
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
    opts: Required<ScanOptions>,
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

          metadata = {
            path: entryPath,
            name,
            size: file.size,
            type: 'file',
            lastModified: file.lastModified,
            mimeType: file.type || undefined,
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
    opts: Required<ScanOptions>,
    shouldExclude: (path: string) => boolean,
    startTime: number,
  ): AsyncGenerator<FileMetadata> {
    // DEBUG: Log concurrent scan start
    console.log('DEBUG Scanner: Starting concurrent scan');

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

        // DEBUG: Log entry found
        console.log(`DEBUG Scanner: Found entry "${name}" in "${dir.path}", type: ${handle.kind}`);

        if (!opts.includeHidden && name.startsWith('.')) {
          console.log(`DEBUG Scanner: Skipping hidden file: ${name}`);
          continue;
        }

        const entryPath = dir.path ? join(dir.path, name) : name;
        if (shouldExclude(entryPath)) continue;

        try {
          if (isFileHandle(handle)) {
            const file = await handle.getFile();
            console.log(`DEBUG Scanner: File "${entryPath}" - size: ${file.size}, maxFileSize: ${opts.maxFileSize}`);

            // Fix: Check if file size exceeds max (skip if too large)
            if (opts.maxFileSize !== Infinity && file.size > opts.maxFileSize) {
              console.log(`DEBUG Scanner: Skipping large file: ${entryPath} (${file.size} > ${opts.maxFileSize})`);
              continue;
            }

            // TEMPORARY: Only accept text files
            const isTextFile = file.type.startsWith('text/') ||
              file.type === 'application/json' ||
              file.type === 'application/javascript' ||
              file.type === 'application/typescript' ||
              file.type === 'application/xml' ||
              file.type === '' && (
                name.endsWith('.txt') || name.endsWith('.md') ||
                name.endsWith('.ts') || name.endsWith('.tsx') ||
                name.endsWith('.js') || name.endsWith('.jsx') ||
                name.endsWith('.json') || name.endsWith('.css') ||
                name.endsWith('.html') || name.endsWith('.xml') ||
                name.endsWith('.yaml') || name.endsWith('.yml') ||
                name.endsWith('.toml') || name.endsWith('.rs') ||
                name.endsWith('.go') || name.endsWith('.py') ||
                name.endsWith('.java') || name.endsWith('.cpp') ||
                name.endsWith('.c') || name.endsWith('.h') ||
                name.endsWith('.sh') || name.endsWith('.bash')
              );

            if (!isTextFile) {
              console.log(`DEBUG Scanner: Skipping non-text file: ${entryPath} (type: ${file.type || 'unknown'})`);
              continue;
            }

            const metadata: FileMetadata = {
              path: entryPath,
              name,
              size: file.size,
              type: 'file',
              lastModified: file.lastModified,
              mimeType: file.type || undefined,
              handle, // Make sure to include the handle
            };

            results.push(metadata);
            processedCount++;
            console.log(`DEBUG Scanner: Added file ${processedCount}: ${entryPath}`);
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
        const promise = processDirectory(dir).then(() => {
          processing.delete(promise);
          this.emitter.emit('progress', {
            processed: processedCount,
            currentPath: dir.path,
          });
        });
        processing.add(promise);
      }

      // Wait for at least one to complete
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
