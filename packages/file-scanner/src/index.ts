/**
 * @conduit/file-scanner
 *
 * Modern file system scanner for browser environments
 */

// Main scanner
export { FileScanner } from './scanner.js';

// Types
export type { FileMetadata, ScanOptions, ScannerEvents } from './types.js';

// Utilities
export { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';
