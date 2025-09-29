import * as wasm from '@conduit/wasm';
import type { FileMetadata } from './types.js';
import { FileScanner } from './scanner.js';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';
import pLimit from 'p-limit';
import { fileTypeFromBuffer } from 'file-type';

const logger = createLogger('file-service');

export interface FileServiceConfig {
  concurrency?: number; // Parallel file operations (default: 10)
  batchSize?: number; // Files per batch for WASM loading (default: 100)
  onProgress?: (loaded: number, total: number) => void; // Progress callback
}

export interface FileServiceStats {
  filesScanned: number;
  filesLoaded: number;
  duration: number;
  totalSize: number;
}

/**
 * FileService loads files from File System Access API into WASM index.
 * All file content is loaded upfront and stored in WASM for fast searching.
 */
export class FileService {
  private metadata = new Map<string, FileMetadata>();
  private handles = new Map<string, FileSystemFileHandle>();
  private limit: ReturnType<typeof pLimit>;
  private initialized = false;

  constructor(private config: FileServiceConfig = {}) {
    this.limit = pLimit(this.config.concurrency ?? 10);
  }

  /**
   * Initialize the service by scanning and loading all files to WASM
   */
  async initialize(
    directoryHandle: FileSystemDirectoryHandle,
    scanOptions?: {
      exclude?: string[];
      includeHidden?: boolean;
    }
  ): Promise<FileServiceStats> {
    const startTime = performance.now();

    // Initialize WASM once
    if (!this.initialized) {
      // Check if wasm is already initialized globally
      try {
        wasm.ping(); // Test if WASM is ready
      } catch {
        // If not initialized, do it now
        await wasm.default();
        wasm.init();
      }
      this.initialized = true;
    }

    // Scan files
    logger.info('Starting file system scan');
    const scanner = new FileScanner();

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
    logger.info(`Scanned ${this.metadata.size} files, loading to WASM...`);

    // Load to WASM
    await this.loadToWasm();

    const stats: FileServiceStats = {
      filesScanned: this.metadata.size,
      filesLoaded: wasm.file_count(),
      duration: performance.now() - startTime,
      totalSize: Array.from(this.metadata.values()).reduce((sum, f) => sum + f.size, 0)
    };

    logger.info('File initialization complete', stats);
    return stats;
  }

  /**
   * Detect MIME type from file content, browser type, or default to binary.
   */
  private async detectMimeType(
    file: File | Blob,
    browserMimeType?: string
  ): Promise<string> {
    try {
      // For files with content, attempt magic byte detection
      if (file.size > 0) {
        // Read up to 4100 bytes for detection (file-type requirement)
        const slice = file.size > 4100 ? file.slice(0, 4100) : file;
        const buffer = await slice.arrayBuffer();
        const detected = await fileTypeFromBuffer(new Uint8Array(buffer));

        if (detected?.mime) {
          return detected.mime;
        }
      }
    } catch (error) {
      // Silently fall back on error
      console.debug('Content-based MIME detection failed:', error);
    }

    // Use browser type if available and not empty, otherwise binary
    return browserMimeType || file.type || 'application/octet-stream';
  }

  /**
   * Load all scanned files to WASM index
   */
  private async loadToWasm(): Promise<void> {
    const paths = Array.from(this.handles.keys());
    const batchSize = this.config.batchSize ?? 100;

    wasm.begin_file_load();

    try {
      for (let i = 0; i < paths.length; i += batchSize) {
        const batch = paths.slice(i, i + batchSize);

        // Load contents and detect MIME types in parallel
        const results = await Promise.all(
          batch.map(path =>
            this.limit(async () => {
              try {
                const handle = this.handles.get(path)!;
                const file = await handle.getFile();
                const buffer = await file.arrayBuffer();
                const metadata = this.metadata.get(path);

                // Detect MIME type
                const mimeType = await this.detectMimeType(file, metadata?.mimeType);

                return {
                  content: new Uint8Array(buffer),
                  mimeType
                };
              } catch (error) {
                logger.warn(`Failed to load ${path}:`, error);
                return {
                  content: new Uint8Array(0),
                  mimeType: ''
                };
              }
            })
          )
        );

        // Separate contents and MIME types
        const contents = results.map(r => r.content);
        const mimeTypes = results.map(r => r.mimeType);

        // Prepare for WASM
        const normalizedPaths = batch.map(p =>
          p.replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\.\//, '')
            .replace(/\/$/, '') || '/'
        );
        const timestamps = batch.map(p =>
          this.metadata.get(p)?.lastModified ?? Date.now()
        );

        // Load batch with MIME types (contents is Uint8Array[] - wasm-bindgen will handle conversion)
        wasm.load_file_batch(normalizedPaths, contents, timestamps, mimeTypes);

        // Progress callback
        this.config.onProgress?.(Math.min(i + batchSize, paths.length), paths.length);
      }

      wasm.commit_file_load();
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
}