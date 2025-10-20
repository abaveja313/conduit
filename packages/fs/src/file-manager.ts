import * as wasm from '@conduit/wasm';
import type { FileMetadata } from './types.js';
import { FileScanner } from './scanner.js';
import { createLogger, ErrorCodes, wrapError, getErrorMessage } from '@conduit/shared';
import pLimit from 'p-limit';
import { isBinaryFromContent, normalizePath, logFileOperation, decodeText } from './file-utils.js';
import { DocumentExtractor } from './document-extractor.js';
import { getOptimalConcurrency } from './concurrency-utils.js';

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
  /** Progress callback for document extraction phase */
  onDocumentExtractionProgress?: (extracted: number, total: number, currentFile?: string) => void;
}

export interface FileManagerStats {
  filesScanned: number;
  filesLoaded: number;
  binaryFilesSkipped: number;
  documentsExtracted: number;
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
  private extractedContent = new Map<string, Uint8Array>();
  private originalDocumentContent = new Map<string, Uint8Array>();

  private readonly defaultConfig: Required<
    Omit<FileManagerConfig, 'onProgress' | 'onScanProgress' | 'onDocumentExtractionProgress'>
  > = {
      concurrency: getOptimalConcurrency(),
      batchSize: 50,
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
      editable: true, // New files are editable by default
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
    logger.info(`Scanned ${this.metadata.size} files, processing documents...`);

    const documentsExtracted = await this.extractDocuments();

    logger.info(`Extracted ${documentsExtracted} documents, loading to WASM...`);

    const binaryFilesSkipped = await this.loadToWasm();

    const stats: FileManagerStats = {
      filesScanned: this.metadata.size,
      filesLoaded: wasm.file_count(),
      binaryFilesSkipped,
      documentsExtracted,
      duration: performance.now() - startTime,
      totalSize: Array.from(this.metadata.values()).reduce((sum, f) => sum + f.size, 0),
    };

    logger.info('File initialization complete', stats);
    return stats;
  }

  /**
   * Extract text from documents (PDFs, DOCX) before loading to WASM
   * Returns the number of documents that had text extracted
   */
  private async extractDocuments(): Promise<number> {
    const documentPaths = Array.from(this.metadata.entries())
      .filter(([path, metadata]) => {
        return metadata.type === 'file' && DocumentExtractor.isSupported(path);
      })
      .map(([path]) => path);

    if (documentPaths.length === 0) {
      return 0;
    }

    logger.info(`Found ${documentPaths.length} documents to extract`);
    let extractedCount = 0;

    for (let i = 0; i < documentPaths.length; i += 10) {
      const batch = documentPaths.slice(i, i + 10);

      await Promise.all(
        batch.map((path) =>
          this.limit(async () => {
            try {
              const handle = this.handles.get(path);
              if (!handle) {
                logger.warn(`No handle found for document: ${path}`);
                return;
              }

              const file = await handle.getFile();
              const buffer = await file.arrayBuffer();

              // Create a copy of the buffer BEFORE extraction to avoid detached buffer issues
              const originalBuffer = new Uint8Array(buffer);
              const bufferCopy = originalBuffer.buffer.slice(0);

              this.config.onDocumentExtractionProgress?.(
                Math.min(i + batch.indexOf(path) + 1, documentPaths.length),
                documentPaths.length,
                path
              );

              const extractedText = await DocumentExtractor.extractHtml(path, bufferCopy);

              if (extractedText) {
                const textEncoder = new TextEncoder();
                const textBuffer = textEncoder.encode(extractedText);

                this.extractedContent.set(path, textBuffer);
                this.originalDocumentContent.set(path, originalBuffer);

                const metadata = this.metadata.get(path);
                if (metadata) {
                  this.metadata.set(path, {
                    ...metadata,
                    editable: false,
                    originalSize: metadata.size,
                    size: textBuffer.byteLength,
                    extracted: true
                  });
                }

                extractedCount++;
                logger.info(`Extracted text from ${path}: ${file.size} bytes -> ${textBuffer.byteLength} bytes`);
              }
            } catch (error) {
              logger.error(`Failed to extract document ${path}:`, error);
              // Mark as non-editable even if extraction failed
              const metadata = this.metadata.get(path);
              if (metadata) {
                this.metadata.set(path, {
                  ...metadata,
                  editable: false
                });
              }
            }
          })
        )
      );

      // Yield to UI thread
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    logger.info(`Document extraction completed`);

    return extractedCount;
  }

  /**
   * Load all scanned files to WASM index
   */
  private async loadToWasm(): Promise<number> {
    const paths = Array.from(this.handles.keys());
    const batchSize = this.config.batchSize!;
    const binaryFilesSkippedLock = { count: 0 };

    try {
      wasm.ping();
    } catch {
      logger.info('WASM not initialized in loadToWasm, initializing now...');
      await wasm.default();
      wasm.init();
    }

    wasm.begin_file_load();

    try {
      const batchPromises = new Set<Promise<void>>();
      const concurrency = this.config.concurrency!;
      const batchConcurrency = Math.max(1, Math.floor(concurrency / 2));

      for (let i = 0; i < paths.length; i += batchSize) {
        const batch = paths.slice(i, i + batchSize);

        if (batchPromises.size >= batchConcurrency) {
          await Promise.race(batchPromises);
        }

        const batchPromise = (async () => {
          const results = await Promise.all(
            batch.map((path) =>
              this.limit(async () => {
                try {
                  const handle = this.handles.get(path)!;
                  const metadata = this.metadata.get(path);

                  if (metadata?.extracted) {
                    const originalContent = this.originalDocumentContent.get(path);
                    const extractedContent = this.extractedContent.get(path);
                    if (originalContent && extractedContent) {
                      return {
                        path,
                        content: originalContent,
                        textContent: extractedContent,
                      };
                    }

                    logger.warn(`Missing content for extracted document ${path}, skipping`);
                    return null;
                  }

                  const file = await handle.getFile();
                  const buffer = await file.arrayBuffer();
                  const content = new Uint8Array(buffer);

                  const isBinary = isBinaryFromContent(content, file.name);
                  if (isBinary) {
                    logFileOperation('Skipping binary file', path);
                    return null;
                  }

                  return {
                    path,
                    content,
                  };
                } catch (error) {
                  logger.warn(`Failed to load ${path}:`, error);
                  return null;
                }
              }),
            ),
          );

          const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);
          binaryFilesSkippedLock.count += results.length - validResults.length;

          if (validResults.length > 0) {
            const validPaths = validResults.map((r) => r.path);
            const contents = validResults.map((r) => r.content);
            const textContents = validResults.map((r) => {
              const result = r as { path: string; content: Uint8Array; textContent?: Uint8Array };
              return result.textContent ? decodeText(result.textContent) : '';
            });

            const normalizedPaths = validPaths.map((p) => normalizePath(p));
            const timestamps = validPaths.map(
              (p) => this.metadata.get(p)?.lastModified ?? Date.now(),
            );
            const permissions = validPaths.map(
              (p) => this.metadata.get(p)?.editable !== false
            );

            if (!Array.isArray(normalizedPaths) || !Array.isArray(contents) || !Array.isArray(timestamps) || !Array.isArray(permissions)) {
              logger.error('Invalid batch data - not arrays:', {
                normalizedPaths: normalizedPaths,
                contents: contents,
                timestamps: timestamps,
                permissions: permissions
              });
              throw new Error('Invalid batch data: parameters must be arrays');
            }

            const hasTextContent = textContents.some(tc => tc !== '');

            const undefinedContentIndex = contents.findIndex(c => c === undefined || c === null);
            if (undefinedContentIndex !== -1) {
              logger.error('Found undefined content at index:', undefinedContentIndex, 'for path:', normalizedPaths[undefinedContentIndex]);
              const validIndices = contents
                .map((c, i) => c !== undefined && c !== null ? i : -1)
                .filter(i => i !== -1);

              const filteredPaths = validIndices.map(i => normalizedPaths[i]);
              const filteredContents = validIndices.map(i => contents[i]) as Uint8Array[];
              const filteredTextContents = validIndices.map(i => textContents[i]);
              const filteredTimestamps = validIndices.map(i => timestamps[i]);
              const filteredPermissions = validIndices.map(i => permissions[i]);

              if (filteredContents.length === 0) {
                logger.warn('No valid content in batch, skipping');
                return;
              }

              try {
                if (filteredTextContents.some(tc => tc !== '')) {
                  wasm.load_file_batch_with_text(filteredPaths, filteredContents, filteredTimestamps, filteredPermissions, filteredTextContents);
                } else {
                  wasm.load_file_batch(filteredPaths, filteredContents, filteredTimestamps, filteredPermissions);
                }
              } catch (filteredError) {
                logger.error('Error loading filtered batch:', filteredError);
                logger.debug('Filtered batch details:', {
                  pathsCount: filteredPaths.length,
                  contentsCount: filteredContents.length,
                  timestampsCount: filteredTimestamps.length,
                  permissionsCount: filteredPermissions.length
                });
                throw filteredError;
              }
            } else {
              try {
                if (hasTextContent) {
                  wasm.load_file_batch_with_text(normalizedPaths, contents, timestamps, permissions, textContents);
                } else {
                  wasm.load_file_batch(normalizedPaths, contents, timestamps, permissions);
                }
              } catch (batchError) {
                logger.error('Error loading file batch:', batchError);
                logger.debug('Batch details:', {
                  pathsCount: normalizedPaths.length,
                  contentsCount: contents.length,
                  timestampsCount: timestamps.length,
                  permissionsCount: permissions.length,
                  firstPath: normalizedPaths[0],
                  firstContentLength: contents[0]?.length,
                  pathsType: Array.isArray(normalizedPaths) ? 'array' : typeof normalizedPaths,
                  contentsType: Array.isArray(contents) ? 'array' : typeof contents,
                  timestampsType: Array.isArray(timestamps) ? 'array' : typeof timestamps,
                  permissionsType: Array.isArray(permissions) ? 'array' : typeof permissions,
                  contentTypes: contents.map(c => c ? c.constructor.name : 'null/undefined')
                });
                throw batchError;
              }
            }
          }

          this.config.onProgress?.(Math.min(i + batchSize, paths.length), paths.length);
        })();

        batchPromise
          .finally(() => {
            batchPromises.delete(batchPromise);
          });

        batchPromises.add(batchPromise);
      }

      const results = await Promise.allSettled(batchPromises);

      // Check for any failed batches
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        logger.error(`${failures.length} batch(es) failed during loading`);
        throw new Error(`Failed to load ${failures.length} batch(es)`);
      }

      wasm.commit_file_load();
      return binaryFilesSkippedLock.count;
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
