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
 * @param permissions - Array of booleans indicating if each file is editable
 * @returns Number of files loaded in this batch
 * @throws {Error} If array lengths don't match or paths are invalid
 */
export function load_file_batch(
  paths: string[],
  contents: Array<ArrayBuffer | Uint8Array | string>, // js_sys::Array
  mtimes: number[],
  permissions: boolean[],
): number;

/**
 * Load a batch of files with both original and extracted text content into staging.
 * For documents (PDF/DOCX), pass original bytes in contents and extracted text in text_contents.
 * @param paths - File paths (will be normalized internally)
 * @param contents - Array of original file contents (Uint8Arrays)
 * @param text_contents - Array of extracted text contents (Uint8Arrays or null for non-documents)
 * @param mtimes - Last modified timestamps (JavaScript milliseconds since epoch)
 * @param permissions - Array of booleans indicating if each file is editable
 * @returns Number of files loaded in this batch
 * @throws {Error} If array lengths don't match or paths are invalid
 */
export function load_file_batch_with_text(
  paths: string[],
  contents: Array<ArrayBuffer | Uint8Array | string>,
  text_contents: Array<ArrayBuffer | Uint8Array | string | null>,
  mtimes: number[],
  permissions: boolean[],
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
 * Get staged deletions without committing.
 * @returns Array of deleted file paths
 * @throws {Error} If no staging session is active
 */
export function get_staged_deletions(): string[];

/**
 * Get staged modifications with both active and staged content for diff preview
 * @returns Array of objects with path, stagedContent, and optionally activeContent
 * @throws {Error} If staging is not active
 */
export function get_staged_modifications_with_active(): Array<{
  path: string;
  stagedContent: Uint8Array;
  activeContent?: Uint8Array;
}>;

/**
 * Get summary of all modified files with line change statistics
 * @returns Array of file summaries with change stats
 * @throws {Error} If staging is not active
 */
export function get_modified_files_summary(): Array<{
  path: string;
  linesAdded: number;
  linesRemoved: number;
  status: 'created' | 'modified' | 'deleted';
}>;

/**
 * Get detailed diff for a specific file
 * @param path - File path to diff
 * @returns Detailed diff with regions of changes
 * @throws {Error} If file not found or staging not active
 */
export function get_file_diff(path: string): {
  path: string;
  stats: {
    linesAdded: number;
    linesRemoved: number;
    regionsChanged: number;
  };
  regions: Array<{
    originalStart: number;
    linesRemoved: number;
    modifiedStart: number;
    linesAdded: number;
    removedLines: string[];
    addedLines: string[];
  }>;
};

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
 * Replace specific lines or line ranges in a file.
 * @param path - The file path to modify
 * @param replacements - Array of [lineNumber, newContent] for single line or [startLine, endLine, newContent] for range (1-based, inclusive)
 * @param use_staged - If true, modify staged index; otherwise modify active index
 * @returns Object containing path, linesReplaced, linesAdded, totalLines, and originalLines
 * @throws {Error} If file not found or line numbers invalid
 */
export function replace_lines(
  path: string,
  replacements: Array<[number, string] | [number, number, string]>,
  use_staged: boolean
): {
  path: string;
  linesReplaced: number;
  linesAdded: number;
  totalLines: number;
  originalLines: number;
};

/**
 * Delete specific lines from a file.
 * @param path - The file path to modify
 * @param line_numbers - Array of line numbers to delete (1-based)
 * @param use_staged - If true, modify staged index; otherwise modify active index
 * @returns Same as replace_lines - object with modification stats
 * @throws {Error} If file not found or line numbers invalid
 */
export function delete_lines(
  path: string,
  line_numbers: number[],
  use_staged: boolean
): {
  path: string;
  linesReplaced: number;
  linesAdded: number;
  totalLines: number;
  originalLines: number;
};

/**
 * Insert content before a specific line.
 * @param path - The file path to modify
 * @param line_number - Line number where to insert (1-based)
 * @param content - Content to insert (can be multi-line)
 * @param use_staged - If true, modify staged index; otherwise modify active index
 * @returns Same as replace_lines - object with modification stats
 * @throws {Error} If file not found or line number invalid
 */
export function insert_before_line(
  path: string,
  line_number: number,
  content: string,
  use_staged: boolean
): {
  path: string;
  linesReplaced: number;
  linesAdded: number;
  totalLines: number;
  originalLines: number;
};

/**
 * Insert content after a specific line.
 * @param path - The file path to modify
 * @param line_number - Line number after which to insert (1-based)
 * @param content - Content to insert (can be multi-line)
 * @param use_staged - If true, modify staged index; otherwise modify active index
 * @returns Same as replace_lines - object with modification stats
 * @throws {Error} If file not found or line number invalid
 */
export function insert_after_line(
  path: string,
  line_number: number,
  content: string,
  use_staged: boolean
): {
  path: string;
  linesReplaced: number;
  linesAdded: number;
  totalLines: number;
  originalLines: number;
};

/**
 * Insert multiple lines at various positions in a file.
 * @param path - The file path to modify
 * @param insertions - Array of insertion operations
 * @param use_staged - If true, modify staged index; otherwise modify active index
 * @returns Same as replace_lines - object with modification stats
 * @throws {Error} If file not found or line numbers invalid
 */
export function insert_lines(
  path: string,
  insertions: Array<{
    lineNumber: number;
    content: string;
    position: 'before' | 'after';
  }>,
  use_staged: boolean
): {
  path: string;
  linesReplaced: number;
  linesAdded: number;
  totalLines: number;
  originalLines: number;
};

/**
 * List files from the index with pagination support.
 * @param start - Starting index (0-based, inclusive)
 * @param stop - Ending index (exclusive). If 0, returns all files from start.
 * @param use_staged - If true, list from staged index; otherwise list from active index
 * @returns Object containing files array, total count, and actual pagination bounds
 * @throws {Error} If use_staged is true but no staging session is active
 */
export function list_files(start: number, stop: number, use_staged: boolean, glob_pattern?: string | null): {
  files: Array<{
    path: string;
    size: number;
    mtime: number;
    extension: string;
    editable: boolean;
  }>;
  total: number;
  start: number;
  end: number;
};

/**
 * Search for matches in files using regex patterns.
 * Returns an array of preview hunks showing matches with surrounding context.
 */
export function find_in_files(
  pattern: string,
  use_staged: boolean,
  case_insensitive?: boolean | null,
  whole_word?: boolean | null,
  include_globs?: string[] | null,
  exclude_globs?: string[] | null,
  context_lines?: number | null
): Array<{
  path: string;
  previewStartLine: number;
  previewEndLine: number;
  matchedLineRanges: Array<{ start: number; end: number }>;
  excerpt: string;
}>;

/**
 * Copy a file to a new location in the staged index.
 * @param src - Source file path
 * @param dst - Destination file path
 * @returns Object containing the destination path
 * @throws {Error} If source file not found or staging not active
 */
export function copy_file(src: string, dst: string): {
  dst: string;
};

/**
 * Copy multiple files in a batch operation.
 * @param operations - Array of copy operations with src and dst paths
 * @returns Object containing the count of files copied
 * @throws {Error} If any source file not found or staging not active
 */
export function copy_files(operations: Array<{ src: string; dst: string }>): {
  count: number;
};

/**
 * Move (rename) a file in the staged index.
 * @param src - Source file path
 * @param dst - Destination file path
 * @returns Object containing the destination path
 * @throws {Error} If source file not found or staging not active
 */
export function move_file(src: string, dst: string): {
  dst: string;
};

/**
 * Move multiple files in a batch operation.
 * @param operations - Array of move operations with src and dst paths
 * @returns Object containing the count of files moved
 * @throws {Error} If any source file not found or staging not active
 */
export function move_files(operations: Array<{ src: string; dst: string }>): {
  count: number;
};

/**
 * Default export for initializing the WASM module
 */
export default function init(
  input?: string | RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
): Promise<void>;
