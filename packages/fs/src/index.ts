/**
 * @conduit/fs
 *
 * File system utilities for browser environments
 */

// Main exports
export { FileScanner } from './scanner.js';
export { FileManager } from './file-manager.js';
export { DocumentExtractor } from './document-extractor.js';
export {
  FileService,
  fileService,
  readFile,
  createFile,
  deleteFile,
  getStagedModifications,
  getStagedModificationsWithDiff,
  beginStaging,
  commitChanges,
  revertChanges,
  getTools,
  replaceLines,
  deleteLines,
  insertLines,
  copyFiles,
  moveFiles,
  readFileSchema,
  createFileSchema,
  deleteFileSchema,
  replaceLinesSchema,
  deleteLinesSchema,
  insertLinesSchema,
  copyFilesSchema,
  moveFilesSchema
} from './file-service.js';

// Types
export type { FileMetadata, ScanOptions, ScannerEvents } from './types.js';
export type { FileManagerConfig, FileManagerStats } from './file-manager.js';
export type {
  ReadFileParams,
  CreateFileParams,
  DeleteFileParams,
  ReplaceLinesParams,
  DeleteLinesParams,
  InsertLinesParams
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
