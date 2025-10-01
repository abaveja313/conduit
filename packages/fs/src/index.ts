/**
 * @conduit/fs
 *
 * File system utilities for browser environments
 */

// Main exports
export { FileScanner } from './scanner.js';
export { FileManager } from './file-manager.js';
export {
  FileService,
  fileService,
  readFile,
  createFile,
  deleteFile,
  getStagedModifications,
  beginStaging,
  commitChanges,
  revertChanges,
  getTools,
  readFileSchema,
  createFileSchema,
  deleteFileSchema
} from './file-service.js';

// Types
export type { FileMetadata, ScanOptions, ScannerEvents } from './types.js';
export type { FileManagerConfig, FileManagerStats } from './file-manager.js';
export type {
  ReadFileParams,
  CreateFileParams,
  DeleteFileParams
} from './file-service.js';

// Utilities
export { isFileHandle, isDirectoryHandle, isFileSystemAccessSupported } from './types.js';
export {
  isBinaryFile,
  normalizePath,
  encodeText,
  decodeText,
  getExtension,
  getFilename,
  formatFileSize
} from './file-utils.js';
