/**
 * Helper functions for common file operations
 */

import { fileService } from './file-service.js';

/**
 * Read an entire file without specifying line ranges
 * @param path The file path to read
 * @returns The file content with line numbers and total lines
 */
export async function readEntireFile(path: string) {
    const files = await fileService.listFiles({
        start: 0,
        limit: 1,
        glob: path,
        useStaged: false
    });

    if (files.files.length === 0) {
        throw new Error(`File not found: ${path}`);
    }

    const sample = await fileService.readFile({
        path,
        lineRange: { start: 1, end: 1 }
    });

    return fileService.readFile({
        path,
        lineRange: { start: 1, end: sample.totalLines }
    });
}

/**
 * Read file in chunks for large files
 * @param path The file path to read
 * @param chunkSize Number of lines per chunk (default 300)
 * @returns An async generator yielding chunks of the file
 */
export async function* readFileInChunks(path: string, chunkSize = 300) {
    const sample = await fileService.readFile({
        path,
        lineRange: { start: 1, end: 1 }
    });

    const totalLines = sample.totalLines;
    let currentLine = 1;

    while (currentLine <= totalLines) {
        const endLine = Math.min(currentLine + chunkSize - 1, totalLines);

        const chunk = await fileService.readFile({
            path,
            lineRange: { start: currentLine, end: endLine }
        });

        yield chunk;

        currentLine = endLine + 1;
    }
}
