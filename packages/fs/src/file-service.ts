import { z } from 'zod';
import * as wasm from '@conduit/wasm';
import { FileManager } from './file-manager.js';
import type { FileManagerConfig } from './file-manager.js';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';
import { encodeText, decodeText, normalizePath } from './file-utils.js';
import { FileMetadata } from './types.js';

const logger = createLogger('file-service');

// Schema definitions using Zod for runtime validation
export const readFileSchema = z.object({
    path: z.string().describe('File path to read from staged WASM index'),
    lineRange: z.object({
        start: z.number().positive().describe('Starting line number (1-based)'),
        end: z.number().positive().describe('Ending line number (inclusive)')
    }).describe('Range of lines to read from the file')
});

export const createFileSchema = z.object({
    path: z.string().describe('File path to create'),
    content: z.string().describe('Text content to write to the file')
});

export const deleteFileSchema = z.object({
    path: z.string().describe('File path to delete')
});

// Type inference from schemas
export type ReadFileParams = z.infer<typeof readFileSchema>;
export type CreateFileParams = z.infer<typeof createFileSchema>;
export type DeleteFileParams = z.infer<typeof deleteFileSchema>;


/**
 * FileService provides the main API for file operations.
 * Handles schemas, validation, and tool formatting for AI models.
 */
export class FileService {
    private fileManager: FileManager;
    private wasmInitialized = false;

    constructor(config?: FileManagerConfig) {
        this.fileManager = new FileManager(config);
    }

    /**
     * Ensure WASM is initialized
     */
    private async ensureWasmInitialized(): Promise<void> {
        if (this.wasmInitialized) return;

        try {
            wasm.ping(); // Test if WASM is ready
        } catch {
            await wasm.default();
            wasm.init();
        }
        this.wasmInitialized = true;
    }

    /**
     * Read file content with line range
     */
    async readFile(params: ReadFileParams): Promise<string> {
        const validated = readFileSchema.parse(params);

        // Validate line range
        if (validated.lineRange.end < validated.lineRange.start) {
            throw new Error(`Invalid line range: end (${validated.lineRange.end}) must be >= start (${validated.lineRange.start})`);
        }

        await this.ensureWasmInitialized();

        try {
            const normalizedPath = normalizePath(validated.path);

            // Always use WASM's read_file_lines function with use_staged=true
            const result = wasm.read_file_lines(
                normalizedPath,
                validated.lineRange.start,
                validated.lineRange.end,
                true // always use staged
            );

            if (!result.content) {
                throw new Error(`File not found: ${normalizedPath}`);
            }

            return result.content;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'read_file',
                path: validated.path
            });
        }
    }

    /**
     * Create or overwrite a file in the staged WASM index
     */
    async createFile(params: CreateFileParams): Promise<void> {
        const validated = createFileSchema.parse(params);
        const { path, content } = validated;
        const normalizedPath = normalizePath(path);

        await this.ensureWasmInitialized();

        try {
            const contentBytes = encodeText(content);

            // Create file in staged WASM index only
            const result = wasm.create_index_file(normalizedPath, contentBytes, true);

            logger.info(`Staged file creation: ${normalizedPath} (${result.size} bytes)`);
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'create_file',
                path
            });
        }
    }

    /**
     * Delete a file from the staged WASM index
     */
    async deleteFile(params: DeleteFileParams): Promise<void> {
        const validated = deleteFileSchema.parse(params);
        const normalizedPath = normalizePath(validated.path);

        await this.ensureWasmInitialized();

        try {
            // Delete file from staged WASM index only
            const result = wasm.delete_index_file(normalizedPath);

            logger.info(`Staged file deletion: ${normalizedPath} (existed: ${result.existed})`);
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'delete_file',
                path: validated.path
            });
        }
    }

    /**
     * Get staged modifications from WASM
     */
    async getStagedModifications(): Promise<Array<{ path: string; content: string }>> {
        await this.ensureWasmInitialized();

        try {
            const modifications = wasm.get_staged_modifications() as Array<{ path: string; content: Uint8Array }>;

            return modifications.map(mod => ({
                path: mod.path,
                content: decodeText(mod.content)
            }));
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'get_staged_modifications'
            });
        }
    }

    /**
     * Begin a manual staging session
     */
    async beginStaging(): Promise<void> {
        await this.ensureWasmInitialized();

        try {
            wasm.begin_index_staging();
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'begin_staging'
            });
        }
    }

    /**
     * Commit staged changes to active index and write to disk
     */
    async commitChanges(): Promise<{ modified: Array<{ path: string; content: string }>; fileCount: number; deleted: string[] }> {
        await this.ensureWasmInitialized();

        try {
            // Commit staging to active index
            const result = wasm.commit_index_staging() as {
                fileCount: number;
                modified: Array<{ path: string; content: Uint8Array }>;
                deleted: string[];
            };

            // Write modified files to disk
            if (result.modified.length > 0) {
                const writtenCount = await this.fileManager.writeModifiedFiles(result.modified);
                logger.info(`Wrote ${writtenCount} files to disk`);
            }

            // Delete files that were marked for deletion
            if (result.deleted.length > 0) {
                for (const path of result.deleted) {
                    try {
                        await this.fileManager.removeFile(path);
                        logger.info(`Deleted file: ${path}`);
                    } catch (error) {
                        logger.warn(`Failed to delete file: ${path}`, error);
                    }
                }
            }

            return {
                fileCount: result.fileCount,
                modified: result.modified.map(file => ({
                    path: file.path,
                    content: decodeText(file.content)
                })),
                deleted: result.deleted
            };
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'commit_changes'
            });
        }
    }

    /**
     * Revert active staging session without committing
     */
    async revertChanges(): Promise<void> {
        await this.ensureWasmInitialized();

        try {
            wasm.revert_index_staging();
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'revert_changes'
            });
        }
    }



    /**
     * Get the underlying FileManager instance
     */
    getFileManager(): FileManager {
        return this.fileManager;
    }

    /**
     * Get metadata for a specific file
     */
    getMetadata(path: string): FileMetadata | undefined {
        return this.fileManager.getMetadata(path);
    }

    /**
     * Get all file metadata
     */
    getAllMetadata(): FileMetadata[] {
        return this.fileManager.getAllMetadata();
    }

    /**
     * Check if a file exists in our metadata
     */
    hasFile(path: string): boolean {
        return this.fileManager.hasFile(path);
    }

    /**
     * Get total number of files
     */
    get fileCount(): number {
        return this.fileManager.fileCount;
    }

    /**
     * Initialize the file system by scanning a directory
     */
    async initialize(
        directoryHandle: FileSystemDirectoryHandle,
        scanOptions?: {
            exclude?: string[];
            includeHidden?: boolean;
        }
    ): Promise<import('./file-manager.js').FileManagerStats> {
        await this.ensureWasmInitialized();
        return this.fileManager.initialize(directoryHandle, scanOptions);
    }

    /**
     * Get all tools for AI integration
     */
    getTools() {
        return {
            readFile: {
                description: 'Read specific lines from a file in the staged WASM index. The file must be loaded into WASM memory first. Useful for examining code sections, configuration files, or any text content within a specific line range.',
                parameters: readFileSchema,
                execute: async (params: ReadFileParams) => {
                    return this.readFile(params);
                }
            },
            createFile: {
                description: 'Create a new file or overwrite an existing file with text content. The file is immediately written to disk, and parent directories are created automatically if they don\'t exist. Only supports text files (UTF-8 encoding).',
                parameters: createFileSchema,
                execute: async (params: CreateFileParams) => {
                    await this.createFile(params);
                    return { success: true };
                }
            },
            deleteFile: {
                description: 'Delete a file from the file system. The file must exist and be accessible. This operation is permanent and cannot be undone. The file is removed from both disk and any internal caches.',
                parameters: deleteFileSchema,
                execute: async (params: DeleteFileParams) => {
                    await this.deleteFile(params);
                    return { success: true };
                }
            },
            getStagedModifications: {
                description: 'Get all files that have been modified and staged in WASM memory but not yet written to disk. Returns an array of file paths and their text content. Useful for reviewing changes before committing them or for batch operations.',
                parameters: z.object({}),
                execute: async () => {
                    return this.getStagedModifications();
                }
            },
            beginStaging: {
                description: 'Begin a manual staging session. Call this before making multiple file modifications that you want to group together. Changes will be held in memory until committed with commitChanges or reverted with revertChanges.',
                parameters: z.object({}),
                execute: async () => {
                    await this.beginStaging();
                    return { success: true };
                }
            },
            revertChanges: {
                description: 'Revert all staged changes without committing. Discards all modifications made since beginStaging was called. Useful for canceling a batch operation.',
                parameters: z.object({}),
                execute: async () => {
                    await this.revertChanges();
                    return { success: true };
                }
            },
            commitChanges: {
                description: 'Commit all staged changes to the active WASM index and write to disk. Returns modified files, deleted files, and total file count. This operation: 1) Commits staged changes to WASM, 2) Writes modified files to disk, 3) Deletes removed files from disk.',
                parameters: z.object({}),
                execute: async () => {
                    const result = await this.commitChanges();
                    logger.info(`Committed ${result.fileCount} files with ${result.modified.length} modifications and ${result.deleted.length} deletions`);
                    return result;
                }
            }
        };
    }
}

// Export singleton instance with default config
export const fileService = new FileService();

// Export individual tool functions for easier integration
export const readFile = (params: ReadFileParams) => fileService.readFile(params);
export const createFile = (params: CreateFileParams) => fileService.createFile(params);
export const deleteFile = (params: DeleteFileParams) => fileService.deleteFile(params);
export const getStagedModifications = () => fileService.getStagedModifications();
export const beginStaging = async () => fileService.beginStaging();
export const commitChanges = () => fileService.commitChanges();
export const revertChanges = async () => fileService.revertChanges();
export const getTools = () => fileService.getTools();
