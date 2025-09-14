/**
 * @conduit/fs
 *
 * File system utilities for browser environments
 */

// Main exports
export { FileScanner } from './scanner.js';
export { FileService } from './file-service.js';

// Types
export type { 
  FileMetadata, 
  ScanOptions, 
  ScannerEvents 
} from './types.js';

export type { 
  FileServiceConfig, 
  FileServiceStats, 
  FileMetadataForWASM 
} from './file-service.js';

// Utilities
export { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';
