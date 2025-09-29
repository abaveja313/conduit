/**
 * @conduit/fs
 *
 * File system utilities for browser environments
 */

// Main exports
export { FileScanner } from './scanner.js';
export { FileService } from './file-service.js';
export { AstService, astService } from './ast-service.js';

// Types
export type { 
  FileMetadata, 
  ScanOptions, 
  ScannerEvents 
} from './types.js';

export type { 
  FileServiceConfig, 
  FileServiceStats
} from './file-service.js';

// AST Types
export type {
  AstQuery,
  AstMatch,
  AstStats,
  SupportedLanguage,
  PatternTemplates
} from '@conduit/wasm/ast';

// Utilities
export { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';
