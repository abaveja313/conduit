import * as wasm from '@conduit/wasm';
import type { FileMetadata } from './types.js';
import { FileScanner } from './scanner.js';
import { createLogger, ErrorCodes, wrapError, getErrorMessage } from '@conduit/shared';
import pLimit from 'p-limit';
import { isBinaryFile, normalizePath, logFileOperation } from './file-utils.js';

const logger = createLogger('file-manager');


export interface FileManagerConfig {
  /** Parallel file operations limit (default: 10) */
  concurrency?: number;
  /** Files per batch for WASM loading (default: 100) */
  batchSize?: number;
  /** Progress callback for loading phase */
  onProgress?: (loaded: number, total: number) => void;
  /** Progress callback for scanning phase */
  onScanProgress?: (filesFound: number, currentPath?: string, fileSize?: number) => void;
}

export interface FileManagerStats {
  filesScanned: number;
  filesLoaded: number;
  binaryFilesSkipped: number;
  duration: number;
  totalSize: number;
}

/**
 * FileManager handles loading files from File System Access API into WASM index.
 * Manages file handles, metadata, and WASM operations.
 */
export class FileManager {
  private metadata = new Map<string, FileMetadata>();
  private handles = new Map<string, FileSystemFileHandle>();
  private rootDirectoryHandle?: FileSystemDirectoryHandle;
  private limit: ReturnType<typeof pLimit>;

  private readonly defaultConfig: Required<
    Omit<FileManagerConfig, 'onProgress' | 'onScanProgress'>
  > = {
      concurrency: 10,
      batchSize: 1000,
    };

  private readonly config: FileManagerConfig;

  constructor(config: FileManagerConfig = {}) {
    this.config = { ...this.defaultConfig, ...config };
    this.limit = pLimit(this.config.concurrency!);
  }


  private async walkToDirectory(
    segments: string[],
    { create }: { create: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    if (!this.rootDirectoryHandle) {
      throw wrapError(new Error('Root directory handle not set'), ErrorCodes.FILE_ACCESS_ERROR, {
        operation: 'walk_to_directory',
        segments,
      });
    }

    let dir: FileSystemDirectoryHandle = this.rootDirectoryHandle;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return dir;
  }

  async ensureFileHandle(
    normalizedPath: string,
  ): Promise<FileSystemFileHandle | undefined> {
    let handle = this.handles.get(normalizedPath);
    if (handle) {
      return handle;
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }

    try {
      const dir = await this.walkToDirectory(segments.slice(0, -1), { create: true });
      const fileName = segments[segments.length - 1];
      handle = await dir.getFileHandle(fileName, { create: true });
      this.handles.set(normalizedPath, handle);
      this.metadata.set(normalizedPath, {
        path: normalizedPath,
        name: fileName,
        size: 0,
        type: 'file',
        lastModified: Date.now(),
        handle,
      });
      logFileOperation('Created file handle', normalizedPath);
      return handle;
    } catch (error) {
      logger.warn(`Failed to create file handle: ${normalizedPath}`, error);
      return undefined;
    }
  }

  updateMetadata(normalizedPath: string, size: number): void {
    const existing = this.metadata.get(normalizedPath);
    const handle = this.handles.get(normalizedPath);
    const lastModified = Date.now();

    if (existing) {
      this.metadata.set(normalizedPath, {
        ...existing,
        size,
        lastModified,
        handle: handle ?? existing.handle,
      });
      return;
    }

    const name = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
    this.metadata.set(normalizedPath, {
      path: normalizedPath,
      name,
      size,
      type: 'file',
      lastModified,
      handle,
    });
  }

  async removeFile(normalizedPath: string): Promise<void> {
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length === 0) {
      throw wrapError(new Error('Cannot delete root directory'), ErrorCodes.FILE_ACCESS_ERROR, {
        operation: 'delete',
        path: normalizedPath,
      });
    }

    try {
      const dir = await this.walkToDirectory(segments.slice(0, -1), { create: false });
      const fileName = segments[segments.length - 1];
      await dir.removeEntry(fileName, { recursive: false });
      this.handles.delete(normalizedPath);
      this.metadata.delete(normalizedPath);
      logFileOperation('Deleted file', normalizedPath);
    } catch (error) {
      throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
        operation: 'delete',
        path: normalizedPath,
      });
    }
  }

  /**
   * Initialize the service by scanning and loading all files to WASM
   */
  async initialize(
    directoryHandle: FileSystemDirectoryHandle,
    scanOptions?: {
      exclude?: string[];
      includeHidden?: boolean;
    },
  ): Promise<FileManagerStats> {
    const startTime = performance.now();

    // Remember root directory so we can create new files/directories later
    this.rootDirectoryHandle = directoryHandle;

    logger.info('Starting file system scan');
    const scanner = new FileScanner();

    let filesFoundCount = 0;
    scanner.on('file', (metadata) => {
      if (metadata.type === 'file') {
        filesFoundCount++;
        this.config.onScanProgress?.(filesFoundCount, metadata.path, metadata.size);
      }
    });

    try {
      for await (const file of scanner.scan(directoryHandle, scanOptions)) {
        if (file.type === 'file' && file.handle) {
          this.metadata.set(file.path, file);
          this.handles.set(file.path, file.handle as FileSystemFileHandle);
        }
      }
    } catch (error) {
      throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
        operation: 'scan',
        directory: directoryHandle.name,
      });
    }
    logger.info(`Scanned ${this.metadata.size} files, loading to WASM...`);

    // Load to WASM
    const binaryFilesSkipped = await this.loadToWasm();

    const stats: FileManagerStats = {
      filesScanned: this.metadata.size,
      filesLoaded: wasm.file_count(),
      binaryFilesSkipped,
      duration: performance.now() - startTime,
      totalSize: Array.from(this.metadata.values()).reduce((sum, f) => sum + f.size, 0),
    };

    logger.info('File initialization complete', stats);
    return stats;
  }

  /**
   * Load all scanned files to WASM index
   */
  private async loadToWasm(): Promise<number> {
    const paths = Array.from(this.handles.keys());
    const batchSize = this.config.batchSize!;
    let binaryFilesSkipped = 0;

    // Ensure WASM is initialized before using it
    try {
      wasm.ping();
    } catch {
      console.log('WASM not initialized in loadToWasm, initializing now...');
      await wasm.default();
      wasm.init();
    }

    wasm.begin_file_load();

    try {
      for (let i = 0; i < paths.length; i += batchSize) {
        const batch = paths.slice(i, i + batchSize);

        // Load contents and detect MIME types in parallel
        const results = await Promise.all(
          batch.map((path) =>
            this.limit(async () => {
              try {
                const handle = this.handles.get(path)!;
                const file = await handle.getFile();

                // Check if file is binary before loading
                const isBinary = await isBinaryFile(file);
                if (isBinary) {
                  logFileOperation('Skipping binary file', path);
                  return null; // Skip binary files
                }

                const buffer = await file.arrayBuffer();

                return {
                  path,
                  content: new Uint8Array(buffer),
                };
              } catch (error) {
                logger.warn(`Failed to load ${path}:`, error);
                return null;
              }
            }),
          ),
        );

        // Filter out null results (binary files)
        const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);
        binaryFilesSkipped += results.length - validResults.length;

        if (validResults.length > 0) {
          // Extract data from valid results
          const validPaths = validResults.map((r) => r.path);
          const contents = validResults.map((r) => r.content);

          // Prepare for WASM
          const normalizedPaths = validPaths.map((p) => normalizePath(p));
          const timestamps = validPaths.map(
            (p) => this.metadata.get(p)?.lastModified ?? Date.now(),
          );

          // Load batch (contents is Uint8Array[] - wasm-bindgen will handle conversion)
          try {
            wasm.load_file_batch(normalizedPaths, contents, timestamps);
          } catch (batchError) {
            console.error('Error loading file batch:', batchError);
            console.log('Batch details:', {
              pathsCount: normalizedPaths.length,
              contentsCount: contents.length,
              timestampsCount: timestamps.length,
              firstPath: normalizedPaths[0],
              firstContentLength: contents[0]?.length
            });
            throw batchError;
          }
        }

        // Progress callback
        this.config.onProgress?.(Math.min(i + batchSize, paths.length), paths.length);
      }

      wasm.commit_file_load();
      return binaryFilesSkipped;
    } catch (error) {
      wasm.abort_file_load();
      throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, { operation: 'load_to_wasm' });
    }
  }

  /**
   * Get metadata for a specific file
   */
  getMetadata(path: string): FileMetadata | undefined {
    return this.metadata.get(path);
  }

  /**
   * Get all file metadata
   */
  getAllMetadata(): FileMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Check if a file exists in our metadata
   */
  hasFile(path: string): boolean {
    return this.metadata.has(path);
  }

  /**
   * Get total number of files
   */
  get fileCount(): number {
    return this.metadata.size;
  }


  /**
   * Write modified files back to disk
   * @param modifiedFiles Array of {path: string, content: Uint8Array} objects
   * @returns Number of files successfully written
   */
  async writeModifiedFiles(
    modifiedFiles: Array<{ path: string; content: Uint8Array | ArrayBuffer }>,
  ): Promise<number> {
    const results = await Promise.allSettled(
      modifiedFiles.map(({ path, content }) =>
        this.limit(async () => {
          const normalizedPath = normalizePath(path);

          const handle = await this.ensureFileHandle(normalizedPath);
          if (!handle) {
            logger.warn(
              `Unable to obtain file handle for: ${path} (normalized: ${normalizedPath})`,
            );
            return false;
          }

          const writable = await handle.createWritable();
          try {
            const buffer =
              content instanceof ArrayBuffer
                ? content
                : (content.buffer.slice(
                  content.byteOffset,
                  content.byteOffset + content.byteLength,
                ) as ArrayBuffer);
            await writable.write(buffer);
            await writable.close();
            this.updateMetadata(normalizedPath, buffer.byteLength);
            logFileOperation('Successfully wrote file', normalizedPath);
            return true;
          } catch (error) {
            await writable.abort();
            throw error;
          }
        }),
      ),
    );

    const errors = results
      .map((result, i) => {
        const originalPath = modifiedFiles[i].path;
        const normalizedPath = normalizePath(originalPath);
        return { result, originalPath, normalizedPath };
      })
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, originalPath, normalizedPath }) => ({
        path: originalPath,
        normalizedPath,
        error: (result as PromiseRejectedResult).reason,
      }));

    if (errors.length > 0) {
      logger.error('Failed to write files:', errors);
      throw wrapError(
        new Error(`Failed to write ${errors.length} file(s)`),
        ErrorCodes.FILE_ACCESS_ERROR,
        {
          operation: 'write',
          errors: errors.map((e) => ({ path: e.path, message: getErrorMessage(e.error) })),
        },
      );
    }

    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
  }


}
