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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly init: () => void;
  readonly ping: () => [number, number];
  readonly begin_file_load: () => [number, number];
  readonly load_file_batch: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
  readonly commit_file_load: () => [number, number, number];
  readonly abort_file_load: () => [number, number];
  readonly file_count: () => number;
  readonly clear_index: () => [number, number];
  readonly get_index_stats: () => [number, number, number];
  readonly read_file_lines: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
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
