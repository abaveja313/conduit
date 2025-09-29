/* TypeScript definitions for @conduit/wasm */

/**
 * Initialize the WASM module.
 * Should be called once when the module loads.
 */
export function init(): void;

/**
 * Test function to verify the module is working.
 */
export function ping(): string;

/**
 * Begin a new file loading session.
 * Clears any existing index and starts fresh staging.
 * @throws {Error} If staging is already active
 */
export function begin_file_load(): void;

/**
 * Load a batch of files with content into staging.
 * @param paths - File paths (will be normalized internally)
 * @param contents - Array of Uint8Arrays with file contents
 * @param mtimes - Last modified timestamps (JavaScript milliseconds since epoch)
 * @returns Number of files loaded in this batch
 * @throws {Error} If array lengths don't match or paths are invalid
 */
export function load_file_batch(
    paths: string[],
    contents: Array<ArrayBuffer | Uint8Array | string>, // js_sys::Array
    mtimes: number[]
): number;

/**
 * Commit all staged files to the active index.
 * @returns The number of files committed
 * @throws {Error} If no staging session is active
 */
export function commit_file_load(): number;

/**
 * Abort the current file load and discard staged changes.
 * @throws {Error} If no staging session is active
 */
export function abort_file_load(): void;

/**
 * Get the number of files in the active index.
 */
export function file_count(): number;

/**
 * Clear the entire index.
 * @throws {Error} If clearing fails
 */
export function clear_index(): void;

/**
 * Get basic statistics about the current index.
 * @returns Object with fileCount property
 */
export function get_index_stats(): { fileCount: number };

/**
 * Default export for initializing the WASM module
 */
export default function init(input?: string | RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
