import { createLogger } from '@conduit/shared';

const logger = createLogger('file-utils');

const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'py', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'go', 'rs',
    'yml', 'yaml', 'toml', 'ini', 'sh', 'sql', 'csv', 'log', 'env',
]);

const BINARY_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
    'exe', 'dll', 'so',
    'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'ogg', 'webm',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'db', 'sqlite',
]);

/**
 * Detect if a file is binary based on extension and content sampling
 */
export async function isBinaryFile(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase().split('.').pop() || '';

    if (TEXT_EXTENSIONS.has(ext)) return false;
    if (BINARY_EXTENSIONS.has(ext)) return true;

    // Unknown extension - check content
    const sample = new Uint8Array(await file.slice(0, 8192).arrayBuffer());

    // Quick NUL byte check
    if (sample.indexOf(0x00) !== -1) return true;

    // UTF-8 validity check
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample);
        return false;
    } catch {
        return true;
    }
}

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
