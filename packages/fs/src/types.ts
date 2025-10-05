/**
 * Core types for the file scanner
 */

import type { ConduitError } from '@conduit/shared';

export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  type: 'file' | 'directory';
  lastModified: number;
  handle?: FileSystemHandle; // File or directory handle for direct access
  editable?: boolean; // Whether the file can be edited (false for PDFs, DOCX, etc.)
  originalSize?: number; // Original file size before text extraction
  extracted?: boolean; // Whether text was extracted from a document
}

export interface ScanOptions {
  /** Glob patterns to exclude (e.g., ['node_modules/**', '*.log']) */
  exclude?: string[];
  maxDepth?: number;
  includeHidden?: boolean;
  /** Skip files larger than this size in bytes */
  maxFileSize?: number;
  concurrency?: number;
  signal?: AbortSignal;
  /** Optional filter function to determine which files to include */
  fileFilter?: (file: File, path: string) => boolean;
}

export type ScannerEvents = {
  file: FileMetadata;
  error: { path: string; error: ConduitError };
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
