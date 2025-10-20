import { createLogger } from '@conduit/shared';
import { isBinaryFile as detectBinaryFile, isBinaryFromContent } from './binary-detector.js';

const logger = createLogger('file-utils');

export const isBinaryFile = detectBinaryFile;
export { isBinaryFromContent };

/**
 * Normalize file paths for consistent handling
 */
export function normalizePath(path: string): string {
    return (
        path
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\.\//, '')
            .replace(/\/$/, '') || '/'
    );
}

/**
 * Convert text content to Uint8Array
 */
export function encodeText(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/**
 * Convert Uint8Array to text content
 */
export function decodeText(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

/**
 * Get file extension from path
 */
export function getExtension(path: string): string {
    return path.toLowerCase().split('.').pop() || '';
}

/**
 * Get filename from path
 */
export function getFilename(path: string): string {
    return path.split('/').filter(Boolean).pop() || path;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Log file operation with consistent formatting
 */
export function logFileOperation(
    operation: string,
    path: string,
    details?: Record<string, unknown>
): void {
    logger.debug(`${operation}: ${path}`, details);
}
