import * as wasm from '@conduit/wasm';
import type { FileMetadata } from './types.js';
import { FileScanner } from './scanner.js';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';
import pLimit from 'p-limit';

const logger = createLogger('file-service');

/**
 * Quick binary file detection
 */
export async function isBinaryFile(file: File): Promise<boolean> {
  const ext = file.name.toLowerCase().split('.').pop() || '';

  // Known text files - skip content check
  const textExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'py', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'go', 'rs',
    'yml', 'yaml', 'toml', 'ini', 'sh', 'sql', 'csv', 'log', 'env'];
  if (textExts.includes(ext)) return false;

  // Known binary files - skip content check  
  const binaryExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so',
    'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'ogg', 'webm',
    'ttf', 'otf', 'woff', 'woff2', 'eot', 'db', 'sqlite'];
  if (binaryExts.includes(ext)) return true;

  // Unknown extension - check content
  const sample = new Uint8Array(await file.slice(0, 8192).arrayBuffer());

  // Quick NUL byte check
  if (sample.indexOf(0x00) !== -1) return true;

  // UTF-8 validity check
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return false;
  } catch {
    return true;
  }
}

export interface FileServiceConfig {
  /** Parallel file operations limit (default: 10) */
  concurrency?: number;
  /** Files per batch for WASM loading (default: 100) */
  batchSize?: number;
  /** Progress callback for loading phase */
  onProgress?: (loaded: number, total: number) => void;
  /** Progress callback for scanning phase */
  onScanProgress?: (filesFound: number, currentPath?: string, fileSize?: number) => void;
}

export interface FileServiceStats {
  filesScanned: number;
  filesLoaded: number;
  binaryFilesSkipped: number;
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

  private readonly defaultConfig: Required<Omit<FileServiceConfig, 'onProgress' | 'onScanProgress'>> = {
    concurrency: 10,
    batchSize: 1000,
  };

  private readonly config: FileServiceConfig;

  constructor(config: FileServiceConfig = {}) {
    this.config = { ...this.defaultConfig, ...config };
    this.limit = pLimit(this.config.concurrency!);
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
      try {
        wasm.ping(); // Test if WASM is ready
      } catch {
        await wasm.default();
        wasm.init();
      }
      this.initialized = true;
    }

    // Scan files
    logger.info('Starting file system scan');
    const scanner = new FileScanner();

    // Track scanning progress
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
        directory: directoryHandle.name
      });
    }
    logger.info(`Scanned ${this.metadata.size} files, loading to WASM...`);

    // Load to WASM
    const binaryFilesSkipped = await this.loadToWasm();

    const stats: FileServiceStats = {
      filesScanned: this.metadata.size,
      filesLoaded: wasm.file_count(),
      binaryFilesSkipped,
      duration: performance.now() - startTime,
      totalSize: Array.from(this.metadata.values()).reduce((sum, f) => sum + f.size, 0)
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

                // Check if file is binary before loading
                const isBinary = await isBinaryFile(file);
                if (isBinary) {
                  logger.debug(`Skipping binary file: ${path}`);
                  return null; // Skip binary files
                }

                const buffer = await file.arrayBuffer();

                return {
                  path,
                  content: new Uint8Array(buffer)
                };
              } catch (error) {
                logger.warn(`Failed to load ${path}:`, error);
                return null;
              }
            })
          )
        );

        // Filter out null results (binary files)
        const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);
        binaryFilesSkipped += results.length - validResults.length;

        if (validResults.length > 0) {
          // Extract data from valid results
          const validPaths = validResults.map(r => r.path);
          const contents = validResults.map(r => r.content);

          // Prepare for WASM
          const normalizedPaths = validPaths.map(p =>
            p.replace(/\\/g, '/')
              .replace(/\/+/g, '/')
              .replace(/^\.\//, '')
              .replace(/\/$/, '') || '/'
          );
          const timestamps = validPaths.map(p =>
            this.metadata.get(p)?.lastModified ?? Date.now()
          );

          // Load batch (contents is Uint8Array[] - wasm-bindgen will handle conversion)
          wasm.load_file_batch(normalizedPaths, contents, timestamps);
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
}