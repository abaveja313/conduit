import { z } from 'zod';
import * as wasm from '@conduit/wasm';
import { FileManager } from './file-manager.js';
import type { FileManagerConfig } from './file-manager.js';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';
import { encodeText, decodeText, normalizePath } from './file-utils.js';
import { FileMetadata } from './types.js';

const logger = createLogger('file-service');

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

export const listFilesSchema = z.object({
    start: z.number().min(0).default(0).describe('Starting index (0-based, inclusive)'),
    limit: z.number().min(0).default(100).describe('Maximum number of files to return. 0 means no limit'),
    useStaged: z.boolean().default(false).describe('If true, list from staged index; otherwise from active index'),
    glob: z.string().optional().describe('Optional glob pattern to filter files (e.g. "*.ts", "src/**/*.js")')
});

export const searchFilesSchema = z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    useStaged: z.boolean().default(false).describe('If true, search in staged index; otherwise in active index'),
    caseInsensitive: z.boolean().default(false).optional().describe('Case insensitive search'),
    wholeWord: z.boolean().default(false).optional().describe('Match whole words only'),
    includeGlobs: z.array(z.string()).optional().describe('Glob patterns to include (e.g. ["*.ts", "src/**/*.js"])'),
    excludeGlobs: z.array(z.string()).optional().describe('Glob patterns to exclude (e.g. ["node_modules/**", "*.test.ts"])'),
    contextLines: z.number().min(0).default(2).optional().describe('Number of context lines around matches')
});

export const replaceLinesSchema = z.object({
    path: z.string().describe('File path to modify'),
    replacements: z.array(z.union([
        // Legacy format: [lineNumber, newContent]
        z.tuple([
            z.number().int().positive().describe('Line number (1-based)'),
            z.string().describe('New content for the line')
        ]),
        // New format: [startLine, endLine, newContent]
        z.tuple([
            z.number().int().positive().describe('Start line number (1-based, inclusive)'),
            z.number().int().positive().describe('End line number (1-based, inclusive)'),
            z.string().describe('New content for the line range')
        ])
    ])).describe('Array of [lineNumber, newContent] or [startLine, endLine, newContent]'),
    useStaged: z.boolean().default(true).describe('If true, modify staged index; otherwise modify active index')
});

export const deleteLinesSchema = z.object({
    path: z.string().describe('File path to modify'),
    lineNumbers: z.array(z.number().int().positive()).describe('Line numbers to delete (1-based)'),
    useStaged: z.boolean().default(true).describe('If true, modify staged index; otherwise modify active index')
});

export const insertLinesSchema = z.object({
    path: z.string().describe('File path to modify'),
    insertions: z.array(z.object({
        lineNumber: z.number().int().positive().describe('Line number where to insert (1-based)'),
        content: z.string().describe('Content to insert (can be multi-line)'),
        position: z.enum(['before', 'after']).describe('Insert before or after the specified line')
    })).describe('Array of insertions to perform'),
    useStaged: z.boolean().default(true).describe('If true, modify staged index; otherwise modify active index')
});

export const readEntireFileSchema = z.object({
    path: z.string().describe('File path to read from staged WASM index')
});

export const copyFilesSchema = z.object({
    operations: z.array(z.object({
        src: z.string().describe('Source file path to copy from'),
        dst: z.string().describe('Destination file path to copy to')
    })).describe('Array of copy operations to perform')
});

export const moveFilesSchema = z.object({
    operations: z.array(z.object({
        src: z.string().describe('Source file path to move from'),
        dst: z.string().describe('Destination file path to move to')
    })).describe('Array of move operations to perform')
});

export type ReadFileParams = z.infer<typeof readFileSchema>;
export type CreateFileParams = z.infer<typeof createFileSchema>;
export type DeleteFileParams = z.infer<typeof deleteFileSchema>;
export type ListFilesParams = z.infer<typeof listFilesSchema>;
export type SearchFilesParams = z.infer<typeof searchFilesSchema>;
export type ReplaceLinesParams = z.infer<typeof replaceLinesSchema>;
export type DeleteLinesParams = z.infer<typeof deleteLinesSchema>;
export type InsertLinesParams = z.infer<typeof insertLinesSchema>;
export type ReadEntireFileParams = z.infer<typeof readEntireFileSchema>;
export type CopyFilesParams = z.infer<typeof copyFilesSchema>;
export type MoveFilesParams = z.infer<typeof moveFilesSchema>;


/**
 * FileService provides the main API for file operations.
 * Handles schemas, validation, and tool formatting for AI models.
 */
export class FileService {
    private fileManager: FileManager;
    private wasmInitialized = false;
    private lastFileOperations = new Map<string, string>();

    constructor(config?: FileManagerConfig) {
        this.fileManager = new FileManager(config);
    }

    private async ensureWasmInitialized(): Promise<void> {
        if (this.wasmInitialized) return;

        try {
            wasm.ping();
        } catch {
            await wasm.default();
            wasm.init();
        }
        this.wasmInitialized = true;
    }

    /**
     * Read file content with line range
     */
    async readFile(params: ReadFileParams): Promise<{
        path: string;
        lines: Array<{ [key: number]: string }>;
        totalLines: number;
    }> {
        const validated = readFileSchema.parse(params);

        if (validated.lineRange.end < validated.lineRange.start) {
            throw new Error(`Invalid line range: end (${validated.lineRange.end}) must be >= start (${validated.lineRange.start})`);
        }

        await this.ensureWasmInitialized();

        try {
            const normalizedPath = normalizePath(validated.path);

            const result = wasm.read_file_lines(
                normalizedPath,
                validated.lineRange.start,
                validated.lineRange.end,
                true
            );

            if (!result.content) {
                throw new Error(`File not found: ${normalizedPath}`);
            }

            const lines = result.content.split('\n').map((content, index) => {
                const lineNum = result.startLine + index;
                return { [lineNum]: content };
            });

            this.lastFileOperations.set(normalizedPath, 'read');

            return {
                path: normalizedPath,
                lines,
                totalLines: result.totalLines
            };
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

            wasm.create_index_file(normalizedPath, contentBytes, true);
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
            wasm.delete_file(normalizedPath);
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'delete_file',
                path: validated.path
            });
        }
    }

    /**
     * List files from the WASM index with pagination
     */
    async listFiles(params?: ListFilesParams): Promise<{
        files: Array<{
            path: string;
            size: number;
            mtime: number;
            extension: string;
            editable: boolean;
        }>;
        total: number;
        hasMore: boolean;
    }> {
        const validated = listFilesSchema.parse(params || {});
        const { start, limit, useStaged, glob } = validated;

        await this.ensureWasmInitialized();

        try {
            const result = wasm.list_files_from_wasm(null, glob, useStaged, limit, start);

            const hasMore = result.end < result.total;

            return {
                files: result.files,
                total: result.total,
                hasMore
            };
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'list_files',
                start,
                limit,
                useStaged,
                glob
            });
        }
    }

    /**
     * Search for matches in files using regex patterns
     */
    async searchFiles(params: SearchFilesParams) {
        const validated = searchFilesSchema.parse(params);
        await this.ensureWasmInitialized();

        try {
            const results = wasm.search_files(
                validated.pattern,
                null, // path_prefix
                validated.includeGlobs?.join(',') || null, // include_pattern
                validated.excludeGlobs?.join(',') || null, // exclude_pattern
                !validated.caseInsensitive, // case_sensitive (inverted)
                validated.wholeWord || false,
                validated.useStaged,
                validated.contextLines || 2,
                100 // limit
            );
            return { results };
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'search_files',
                pattern: validated.pattern,
                useStaged: validated.useStaged
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
     * Get staged modifications with both active and staged content for diff preview
     */
    async getStagedModificationsWithDiff(): Promise<Array<{
        path: string;
        activeContent?: string;
        stagedContent: string;
    }>> {
        await this.ensureWasmInitialized();

        try {
            const modifications = wasm.get_staged_modifications_with_active() as Array<{
                path: string;
                activeContent?: Uint8Array;
                stagedContent: Uint8Array;
            }>;

            return modifications.map(mod => ({
                path: mod.path,
                activeContent: mod.activeContent ? decodeText(mod.activeContent) : undefined,
                stagedContent: decodeText(mod.stagedContent)
            }));
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'get_staged_modifications_with_diff'
            });
        }
    }

    /**
     * Get summary of all modified files with line change statistics
     */
    async getModifiedFilesSummary(): Promise<Array<{
        path: string;
        linesAdded: number;
        linesRemoved: number;
        status: 'created' | 'modified' | 'deleted' | 'moved';
        movedTo?: string;
    }>> {
        await this.ensureWasmInitialized();

        try {
            return wasm.get_modified_files_summary();
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'get_modified_files_summary'
            });
        }
    }

    /**
     * Get detailed diff for a specific file
     */
    async getFileDiff(path: string): Promise<{
        path: string;
        stats: {
            linesAdded: number;
            linesRemoved: number;
            regionsChanged: number;
        };
        regions: Array<{
            originalStart: number;
            linesRemoved: number;
            modifiedStart: number;
            linesAdded: number;
            removedLines: string[];
            addedLines: string[];
        }>;
    }> {
        await this.ensureWasmInitialized();

        try {
            return wasm.get_file_diff(path);
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'get_file_diff',
                path
            });
        }
    }

    /**
     * Get staged deletions from WASM
     */
    async getStagedDeletions(): Promise<string[]> {
        await this.ensureWasmInitialized();

        try {
            const deletions = wasm.get_staged_deletions() as string[];
            return deletions;
        } catch (error) {
            throw wrapError(error, ErrorCodes.INTERNAL_ERROR, {
                operation: 'get_staged_deletions'
            });
        }
    }

    /**
     * Replace specific lines in a file by line number
     */
    async replaceLines(params: ReplaceLinesParams): Promise<{
        path: string;
        linesReplaced: number;
        linesAdded: number;
        totalLines: number;
        originalLines: number;
    }> {
        const validated = replaceLinesSchema.parse(params);
        await this.ensureWasmInitialized();

        const normalizedPath = normalizePath(validated.path);
        if (this.lastFileOperations.get(normalizedPath) !== 'read') {
            throw new Error(
                `Cannot replace lines in '${validated.path}' without reading the file first. ` +
                `Call readFile() before using replaceLines() to ensure line numbers are accurate.`
            );
        }

        try {
            const result = wasm.replace_lines(
                normalizedPath,
                validated.replacements as Array<[number, string]>,
                validated.useStaged
            );
            return result;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'replace_lines',
                path: validated.path,
                linesCount: validated.replacements.length
            });
        }
    }

    /**
     * Delete specific lines from a file
     */
    async deleteLines(params: DeleteLinesParams): Promise<{
        path: string;
        linesReplaced: number;
        linesAdded: number;
        totalLines: number;
        originalLines: number;
    }> {
        const validated = deleteLinesSchema.parse(params);
        await this.ensureWasmInitialized();

        const normalizedPath = normalizePath(validated.path);
        if (this.lastFileOperations.get(normalizedPath) !== 'read') {
            throw new Error(
                `Cannot delete lines in '${validated.path}' without reading the file first. ` +
                `Call readFile() before using deleteLines() to ensure line numbers are accurate.`
            );
        }

        try {
            const result = wasm.delete_lines(
                normalizedPath,
                validated.lineNumbers,
                validated.useStaged
            );
            return result;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'delete_lines',
                path: validated.path,
                lineCount: validated.lineNumbers.length
            });
        }
    }

    async insertLines(params: InsertLinesParams): Promise<{
        path: string;
        linesReplaced: number;
        linesAdded: number;
        totalLines: number;
        originalLines: number;
    }> {
        const validated = insertLinesSchema.parse(params);
        await this.ensureWasmInitialized();

        const normalizedPath = normalizePath(validated.path);
        if (this.lastFileOperations.get(normalizedPath) !== 'read') {
            throw new Error(
                `Cannot insert lines in '${validated.path}' without reading the file first. ` +
                `Call readFile() before using insertLines() to ensure line numbers are accurate.`
            );
        }

        try {
            const result = wasm.insert_lines(
                normalizedPath,
                validated.insertions,
                validated.useStaged
            );
            return result;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'insert_lines',
                path: validated.path,
                insertionCount: validated.insertions.length
            });
        }
    }

    async copyFiles(params: CopyFilesParams): Promise<{ count: number }> {
        const validated = copyFilesSchema.parse(params);
        await this.ensureWasmInitialized();

        try {
            const result = wasm.copy_files(validated.operations);
            return result;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'copy_files',
                operationCount: validated.operations.length
            });
        }
    }

    async moveFiles(params: MoveFilesParams): Promise<{ count: number }> {
        const validated = moveFilesSchema.parse(params);
        await this.ensureWasmInitialized();

        try {
            const result = wasm.move_files(validated.operations);
            return result;
        } catch (error) {
            throw wrapError(error, ErrorCodes.FILE_ACCESS_ERROR, {
                operation: 'move_files',
                operationCount: validated.operations.length
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
            this.lastFileOperations.clear();
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
            const result = wasm.commit_index_staging() as {
                fileCount: number;
                modified: Array<{ path: string; content: Uint8Array }>;
                deleted: string[];
            };

            const hasModifications = result.modified.length > 0;
            const hasDeletions = result.deleted.length > 0;

            const operations = await Promise.all([
                hasModifications ? this.fileManager.writeModifiedFiles(result.modified) : Promise.resolve(0),
                hasDeletions ? this.processDeletions(result.deleted) : Promise.resolve({ succeeded: 0, failed: 0 })
            ]);

            const [writtenCount, deletionStats] = operations;

            if (hasModifications) {
                logger.info(`Wrote ${writtenCount} files to disk`);
            }

            if (deletionStats.succeeded > 0 || deletionStats.failed > 0) {
                logger.debug(`Deletions: ${deletionStats.succeeded} succeeded, ${deletionStats.failed} failed`);
            }

            this.lastFileOperations.clear();

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

    private async processDeletions(paths: string[]): Promise<{ succeeded: number; failed: number }> {
        if (paths.length === 0) {
            return { succeeded: 0, failed: 0 };
        }

        const deletionsToProcess = [];
        let skippedCount = 0;

        for (const path of paths) {
            const metadata = this.fileManager.getMetadata(path);
            if (metadata?.handle) {
                deletionsToProcess.push(path);
            } else {
                skippedCount++;
            }
        }

        if (skippedCount > 0) {
            logger.debug(`Skipped ${skippedCount} deletions (never existed on disk)`);
        }

        if (deletionsToProcess.length === 0) {
            return { succeeded: 0, failed: 0 };
        }

        const deletionPromises = deletionsToProcess.map(async (path) => {
            try {
                await this.fileManager.removeFile(path);
                return { success: true };
            } catch {
                return { success: false };
            }
        });

        const deletionResults = await Promise.all(deletionPromises);

        let succeeded = 0;
        let failed = 0;
        for (const result of deletionResults) {
            if (result.success) succeeded++;
            else failed++;
        }

        return { succeeded, failed };
    }

    /**
     * Revert active staging session without committing
     */
    async revertChanges(): Promise<void> {
        await this.ensureWasmInitialized();

        try {
            wasm.revert_index_staging();
            this.lastFileOperations.clear();
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
                description: 'Read specific lines from a file in the STAGED WASM index (not from disk). Returns an object with path, array of lines (format: [{lineNum: "content"}, ...]), and totalLines. The staged index contains your working changes that haven\'t been committed yet. The file must be loaded into WASM memory first. For files under 500 lines, read the entire file at once. For larger files, read in chunks of 200-300 lines. NOTE: Can read .pdf and .docx files (automatically converted to text/HTML) but these files are READ-ONLY and cannot be edited.',
                parameters: readFileSchema,
                execute: async (params: ReadFileParams) => {
                    return this.readFile(params);
                }
            },
            createFile: {
                description: 'Create a new file or overwrite an existing file in the STAGED index only. This does NOT write to disk immediately - changes are held in memory until the user commits them. The file will appear in getStagedModifications. Parent directories are created automatically in the staged index. Only supports text files (UTF-8 encoding).',
                parameters: createFileSchema,
                execute: async (params: CreateFileParams) => {
                    await this.createFile(params);
                    return { success: true };
                }
            },
            deleteFile: {
                description: 'Mark a file for deletion in the STAGED index. This does NOT delete the file from disk immediately - it only stages the deletion. The file will still exist on disk until the user commits the changes. The deletion will appear in getStagedDeletions.',
                parameters: deleteFileSchema,
                execute: async (params: DeleteFileParams) => {
                    await this.deleteFile(params);
                    return { success: true };
                }
            },
            getStagedModifications: {
                description: 'Get all files that have been created or modified in the STAGED index but not yet committed to disk. Returns file paths and their new content. The staged index is your working area - changes here are not on disk yet. Does not include deletions (use getStagedDeletions for those).',
                parameters: z.object({}),
                execute: async () => {
                    return this.getStagedModifications();
                }
            },
            listFiles: {
                description: 'List files from the WASM index with pagination. IMPORTANT: Always use limit=100 or less (default is 100). The STAGED index shows your working changes, while the ACTIVE index shows the last committed state. Returns file paths with metadata. Supports glob patterns like "*.ts", "src/**/*.js". For large directories, paginate using offset.',
                parameters: listFilesSchema,
                execute: async (params?: ListFilesParams) => {
                    return this.listFiles(params);
                }
            },
            searchFiles: {
                description: 'Search for regex patterns across files in the WASM index. Searches the STAGED index by default (your working changes) or ACTIVE index (last committed state) if specified. Returns preview excerpts with context. Supports case-insensitive search, whole word matching, and glob filtering. Useful for finding code patterns or text.',
                parameters: searchFilesSchema,
                execute: async (params: SearchFilesParams) => {
                    return this.searchFiles(params);
                }
            },
            replaceLines: {
                description: 'Replace specific lines or line ranges in a file in the STAGED index. Provide either [lineNumber, newContent] for single line replacement or [startLine, endLine, newContent] for range replacement (1-based line numbers, inclusive). When replacing a range, all lines from startLine to endLine are replaced with the new content. Supports multi-line content - newlines in content create multiple lines. This is an ATOMIC operation - either all replacements succeed or none do. Returns linesReplaced, linesAdded (can be negative if shrinking), totalLines, and originalLines. Changes are held in memory only until committed. Cannot be used on PDF or DOCX files (they are read-only).',
                parameters: replaceLinesSchema,
                execute: async (params: ReplaceLinesParams) => {
                    return this.replaceLines(params);
                }
            },
            deleteLines: {
                description: 'Delete specific lines from a file in the STAGED index. Provide an array of line numbers to delete (1-based). The file will shrink by the number of deleted lines. This is an ATOMIC operation - either all deletions succeed or none do. Returns modification stats including linesAdded (negative for deletions). Changes are held in memory only until committed. Cannot be used on PDF or DOCX files (they are read-only).',
                parameters: deleteLinesSchema,
                execute: async (params: DeleteLinesParams) => {
                    return this.deleteLines(params);
                }
            },
            insertLines: {
                description: 'Insert new content at multiple locations in the STAGED index. Each insertion specifies a line number, content (can be multi-line), and position ("before" or "after"). Insertions are applied in descending line order to handle shifting correctly. This is an ATOMIC operation - either all insertions succeed or none do. Returns modification stats. Changes are held in memory only until committed. Cannot be used on PDF or DOCX files (they are read-only).',
                parameters: insertLinesSchema,
                execute: async (params: InsertLinesParams) => {
                    return this.insertLines(params);
                }
            },
            copyFiles: {
                description: 'Copy multiple files to new locations in the STAGED index. Each operation copies source file content to the destination path. Both source and destination files will exist after the operation. This is an ATOMIC operation - either all copies succeed or none do. Returns the count of files copied. Changes are held in memory only until committed.',
                parameters: copyFilesSchema,
                execute: async (params: CopyFilesParams) => {
                    return this.copyFiles(params);
                }
            },
            moveFiles: {
                description: 'Move (rename) multiple files in the STAGED index. Each file is efficiently moved from source to destination path without copying content. Source paths will no longer exist after successful moves. This is an ATOMIC operation - either all moves succeed or none do. Returns the count of files moved. Changes are held in memory only until committed.',
                parameters: moveFilesSchema,
                execute: async (params: MoveFilesParams) => {
                    return this.moveFiles(params);
                }
            }
        };
    }
}

export const fileService = new FileService();

export const readFile = (params: ReadFileParams) => fileService.readFile(params);
export const createFile = (params: CreateFileParams) => fileService.createFile(params);
export const deleteFile = (params: DeleteFileParams) => fileService.deleteFile(params);
export const getStagedModifications = () => fileService.getStagedModifications();
export const getStagedModificationsWithDiff = () => fileService.getStagedModificationsWithDiff();
export const getStagedDeletions = () => fileService.getStagedDeletions();
export const listFiles = (params?: ListFilesParams) => fileService.listFiles(params);
export const beginStaging = () => fileService.beginStaging();
export const commitChanges = () => fileService.commitChanges();
export const revertChanges = () => fileService.revertChanges();
export const replaceLines = (params: ReplaceLinesParams) => fileService.replaceLines(params);
export const deleteLines = (params: DeleteLinesParams) => fileService.deleteLines(params);
export const insertLines = (params: InsertLinesParams) => fileService.insertLines(params);
export const copyFiles = (params: CopyFilesParams) => fileService.copyFiles(params);
export const moveFiles = (params: MoveFilesParams) => fileService.moveFiles(params);
export const getTools = () => fileService.getTools();
