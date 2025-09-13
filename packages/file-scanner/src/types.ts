/**
 * Core types for the file scanner
 */

export interface FileMetadata {
    path: string;
    name: string;
    size: number;
    type: 'file' | 'directory';
    lastModified: number;
    mimeType?: string;
    handle?: FileSystemHandle; // File or directory handle for direct access
}

export interface ScanOptions {
    /** Glob patterns to exclude (e.g., ['node_modules/**', '*.log']) */
    exclude?: string[];
    /** Maximum depth to scan (default: Infinity) */
    maxDepth?: number;
    /** Include hidden files starting with . (default: false) */
    includeHidden?: boolean;
    /** Maximum file size in bytes to include (default: Infinity) */
    maxFileSize?: number;
    /** Maximum concurrent operations (default: 1) */
    concurrency?: number;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
}

export type ScannerEvents = {
    file: FileMetadata;
    error: { path: string; error: Error };
    progress: { processed: number; total?: number; currentPath: string };
    complete: { processed: number; duration: number };
};

export function isFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
    return handle.kind === 'file';
}

export function isDirectoryHandle(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
    return handle.kind === 'directory';
}

// Feature detection
export function isFileSystemAccessSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'showDirectoryPicker' in window &&
        'FileSystemFileHandle' in window &&
        'FileSystemDirectoryHandle' in window
    );
}
