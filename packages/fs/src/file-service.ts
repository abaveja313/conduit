import type { FileMetadata } from './types.js';
import { FileScanner } from './scanner.js';
import { createLogger, ConduitError, ErrorCodes, wrapError } from '@conduit/shared';
import pLimit from 'p-limit';

const logger = createLogger('file-service');

export interface FileServiceConfig {
  concurrency?: number; // Parallel file operations (default: 10)
}

export interface FileServiceStats {
  filesScanned: number;
  duration: number;
  totalSize: number;
}

export interface FileMetadataForWASM {
  paths: string[];
  sizes: Uint32Array;
  extensions: string[];
}

/**
 * FileService acts as a thin coordination layer between File System Access API and WASM.
 * It does not cache any file content - all caching is done in WASM.
 */
export class FileService {
  private metadata = new Map<string, FileMetadata>();
  private handles = new Map<string, FileSystemFileHandle>();
  private limit: ReturnType<typeof pLimit>;

  constructor(config: FileServiceConfig = {}) {
    this.limit = pLimit(config.concurrency ?? 10);
  }

  /**
   * Initialize the service by scanning a directory for metadata
   */
  async initialize(
    directoryHandle: FileSystemDirectoryHandle,
    scanOptions?: {
      exclude?: string[];
      includeHidden?: boolean;
    }
  ): Promise<FileServiceStats> {
    const startTime = performance.now();
    const scanner = new FileScanner();

    logger.info('Starting file system scan');

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
        directory: directoryHandle.name
      });
    }

    const stats: FileServiceStats = {
      filesScanned: this.metadata.size,
      duration: performance.now() - startTime,
      totalSize: Array.from(this.metadata.values()).reduce((sum, f) => sum + f.size, 0)
    };

    logger.info('File system scan complete', stats);
    return stats;
  }

  /**
   * Get all metadata formatted for efficient transfer to WASM
   */
  getMetadataForWASM(): FileMetadataForWASM {
    const paths: string[] = [];
    const sizes: number[] = [];
    const extensions: string[] = [];

    for (const [path, meta] of this.metadata) {
      paths.push(path);
      sizes.push(meta.size);
      extensions.push(path.split('.').pop()?.toLowerCase() || '');
    }

    return {
      paths,
      sizes: new Uint32Array(sizes),
      extensions
    };
  }

  /**
   * Load multiple files efficiently with concurrency control
   */
  async loadFiles(paths: string[]): Promise<ArrayBuffer[]> {
    logger.debug(`Loading ${paths.length} files`);

    const results = await Promise.all(
      paths.map((path) =>
        this.limit(async () => {
          try {
            const handle = this.handles.get(path);
            if (!handle) {
              throw new ConduitError(
                `No handle for file: ${path}`,
                ErrorCodes.FILE_ACCESS_ERROR,
                { path }
              );
            }

            const file = await handle.getFile();
            return file.arrayBuffer();
          } catch (error) {
            // Log but don't throw - return empty buffer to maintain array alignment
            logger.error('Failed to load file', { path, error });
            return new ArrayBuffer(0);
          }
        })
      )
    );

    return results;
  }

  /**
   * Write multiple files efficiently
   */
  async writeFiles(updates: Array<{ path: string; content: ArrayBuffer }>): Promise<void> {
    logger.debug(`Writing ${updates.length} files`);

    await Promise.all(
      updates.map(({ path, content }) =>
        this.limit(async () => {
          const handle = this.handles.get(path);
          if (!handle) {
            throw new ConduitError(
              `No handle for file: ${path}`,
              ErrorCodes.FILE_ACCESS_ERROR,
              { path }
            );
          }

          const writable = await handle.createWritable();
          try {
            await writable.write(content);
            await writable.close();

            const file = await handle.getFile();
            const meta = this.metadata.get(path);
            if (meta) {
              meta.size = file.size;
              meta.lastModified = file.lastModified;
            }
          } catch (error) {
            await writable.close();
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
              path,
              operation: 'write',
              size: content.byteLength
            });
          }
        })
      )
    );
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
}