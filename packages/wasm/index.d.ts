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
  mtimes: number[],
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
 * Read specific lines from a file in the index.
 * @param path - File path to read from
 * @param startLine - Starting line number (1-based)
 * @param endLine - Ending line number (1-based, inclusive)
 * @param useStaged - If true, read from staged index; otherwise read from active index
 * @returns Object containing path, startLine, endLine, content, and totalLines
 * @throws {Error} If file not found or lines out of range
 */
export function read_file_lines(
  path: string,
  startLine: number,
  endLine: number,
  useStaged: boolean,
): {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  totalLines: number;
};

/**
 * Begin a manual staging session.
 * @throws {Error} If staging is already active
 */
export function begin_index_staging(): void;

/**
 * Commit the staged index to active, returning modified files and count.
 * @returns Object with fileCount and array of modified files
 * @throws {Error} If no staging session is active
 */
export function commit_index_staging(): {
  fileCount: number;
  modified: Array<{ path: string; content: Uint8Array }>;
};

/**
 * Revert active staging session without committing.
 * @throws {Error} If no staging session is active
 */
export function revert_index_staging(): void;

/**
 * Get staged modifications without committing.
 * @returns Array of modified files with their content
 * @throws {Error} If no staging session is active
 */
export function get_staged_modifications(): Array<{ path: string; content: Uint8Array }>;

/**
 * Create or overwrite a file in the staged index.
 * @param path - File path to create
 * @param content - Optional file content
 * @param allowOverwrite - Whether to overwrite existing files
 * @returns Object with path, size, and created flag
 * @throws {Error} If file exists and allowOverwrite is false
 */
export function create_index_file(
  path: string,
  content?: Uint8Array | null,
  allowOverwrite?: boolean,
): {
  path: string;
  size: number;
  created: boolean;
};

/**
 * Delete a file from the staged index.
 * @param path - File path to delete
 * @returns Object with path and existed flag
 * @throws {Error} If staging is not active
 */
export function delete_index_file(path: string): {
  path: string;
  existed: boolean;
};

/**
 * List files from the index with pagination support.
 * @param start - Starting index (0-based, inclusive)
 * @param stop - Ending index (exclusive). If 0, returns all files from start.
 * @param use_staged - If true, list from staged index; otherwise list from active index
 * @returns Object containing files array, total count, and actual pagination bounds
 * @throws {Error} If use_staged is true but no staging session is active
 */
export function list_files(start: number, stop: number, use_staged: boolean): {
  files: Array<{
    path: string;
    size: number;
    mtime: number;
    extension: string;
  }>;
  total: number;
  start: number;
  end: number;
};

/**
 * Default export for initializing the WASM module
 */
export default function init(
  input?: string | RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
): Promise<void>;
