/* tslint:disable */
/* eslint-disable */
/**
 * Initialize the WASM module.
 */
export function init(): void;
/**
 * Test function to verify the module is working.
 */
export function ping(): string;
/**
 * Begin a new file loading session.
 * Clears any existing index and starts fresh staging.
 */
export function begin_file_load(): void;
/**
 * Load a batch of files with content into staging.
 * Arrays must have the same length.
 */
export function load_file_batch(paths: string[], contents: Array<any>, mtimes: Float64Array): number;
/**
 * Commit all staged files to the active index.
 * Returns the number of files committed.
 */
export function commit_file_load(): number;
/**
 * Abort the current file load and discard staged changes.
 */
export function abort_file_load(): void;
/**
 * Begin a manual staging session.
 */
export function begin_index_staging(): void;
/**
 * Commit the staged index to active, returning modified files and count.
 */
export function commit_index_staging(): any;
/**
 * Revert active staging session without committing.
 */
export function revert_index_staging(): void;
/**
 * Get staged modifications without committing.
 */
export function get_staged_modifications(): any;
/**
 * Get staged deletions without committing.
 */
export function get_staged_deletions(): any;
/**
 * Get summary of all modified files with line change statistics.
 * Returns an array of objects with path, linesAdded, linesRemoved, and status.
 */
export function get_modified_files_summary(): any;
/**
 * Get detailed diff for a specific file.
 * Returns regions of changes with line numbers and content.
 */
export function get_file_diff(path: string): any;
/**
 * Get staged modifications with both active and staged content for diff preview.
 */
export function get_staged_modifications_with_active(): any;
/**
 * Get the number of files in the active index.
 */
export function file_count(): number;
/**
 * Clear the entire index.
 */
export function clear_index(): void;
/**
 * Get basic statistics about the current index.
 */
export function get_index_stats(): any;
/**
 * Read specific lines from a file in the index.
 *
 * # Arguments
 * * `path` - The file path to read from
 * * `start_line` - Starting line number (1-based, inclusive)
 * * `end_line` - Ending line number (1-based, inclusive)
 * * `use_staged` - If true, read from staged index; otherwise read from active index
 *
 * # Returns
 * A JavaScript object containing:
 * - `path`: The file path
 * - `startLine`: The actual start line (may be clamped to file bounds)
 * - `endLine`: The actual end line (may be clamped to file bounds)
 * - `content`: The extracted text content
 * - `totalLines`: Total number of lines in the file
 */
export function read_file_lines(path: string, start_line: number, end_line: number, use_staged: boolean): any;
/**
 * Create or overwrite a file in the staged index.
 */
export function create_index_file(path: string, content: Uint8Array | null | undefined, allow_overwrite: boolean): any;
/**
 * List files from the index with pagination support.
 *
 * # Arguments
 * * `start` - Starting index (0-based, inclusive)
 * * `stop` - Ending index (exclusive). If 0, returns all files from start.
 * * `use_staged` - If true, list from staged index; otherwise list from active index
 *
 * # Returns
 * A JavaScript object containing:
 * - `files`: Array of file objects with path and metadata
 * - `total`: Total number of files in the index
 * - `start`: The actual start index used
 * - `end`: The actual end index (exclusive) of returned files
 */
export function list_files(start: number, stop: number, use_staged: boolean, glob_pattern?: string | null): any;
/**
 * Search for matches in files using regex patterns.
 *
 * Returns an array of preview hunks showing matches with surrounding context.
 */
export function find_in_files(pattern: string, use_staged: boolean, case_insensitive?: boolean | null, whole_word?: boolean | null, include_globs?: any[] | null, exclude_globs?: any[] | null, context_lines?: number | null): any;
/**
 * Delete a file from the staged index, if it exists.
 */
export function delete_index_file(path: string): any;
/**
 * Replace specific lines in a file by line number.
 *
 * # Arguments
 * * `path` - The file path to modify
 * * `replacements` - JavaScript array of [lineNumber, newContent] pairs (line numbers are 1-based)
 * * `use_staged` - If true, modify staged index; otherwise modify active index
 *
 * # Returns
 * Object containing path, lines_replaced, and total_lines
 */
export function replace_lines(path: string, replacements: Array<any>, use_staged: boolean): any;
/**
 * Delete specific lines from a file.
 *
 * # Arguments
 * * `path` - The file path to modify
 * * `line_numbers` - Array of line numbers to delete (1-based)
 * * `use_staged` - If true, modify staged index; otherwise modify active index
 */
export function delete_lines(path: string, line_numbers: Uint32Array, use_staged: boolean): any;
/**
 * Insert new content before a specific line.
 *
 * # Arguments
 * * `path` - The file path to modify
 * * `line_number` - Line number where to insert (1-based)
 * * `content` - Content to insert (can be multi-line)
 * * `use_staged` - If true, modify staged index; otherwise modify active index
 */
export function insert_before_line(path: string, line_number: number, content: string, use_staged: boolean): any;
/**
 * Insert new content after a specific line.
 *
 * # Arguments
 * * `path` - The file path to modify  
 * * `line_number` - Line number after which to insert (1-based)
 * * `content` - Content to insert (can be multi-line)
 * * `use_staged` - If true, modify staged index; otherwise modify active index
 */
export function insert_after_line(path: string, line_number: number, content: string, use_staged: boolean): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly init: () => void;
  readonly ping: () => [number, number];
  readonly begin_file_load: () => [number, number];
  readonly load_file_batch: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
  readonly commit_file_load: () => [number, number, number];
  readonly abort_file_load: () => [number, number];
  readonly begin_index_staging: () => [number, number];
  readonly commit_index_staging: () => [number, number, number];
  readonly revert_index_staging: () => [number, number];
  readonly get_staged_modifications: () => [number, number, number];
  readonly get_staged_deletions: () => [number, number, number];
  readonly get_modified_files_summary: () => [number, number, number];
  readonly get_file_diff: (a: number, b: number) => [number, number, number];
  readonly get_staged_modifications_with_active: () => [number, number, number];
  readonly file_count: () => number;
  readonly clear_index: () => [number, number];
  readonly get_index_stats: () => [number, number, number];
  readonly read_file_lines: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly create_index_file: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly list_files: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly find_in_files: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly delete_index_file: (a: number, b: number) => [number, number, number];
  readonly replace_lines: (a: number, b: number, c: any, d: number) => [number, number, number];
  readonly delete_lines: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly insert_before_line: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly insert_after_line: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_3: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
