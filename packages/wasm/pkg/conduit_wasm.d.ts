/* tslint:disable */
/* eslint-disable */
export function clear_wasm_index(): void;
export function add_files_to_staging(paths: string[], contents: Uint8Array[], mtimes: Float64Array, permissions: boolean[], text_contents?: string[] | null): number;
export function promote_staged_index(): number;
export function begin_index_staging(): void;
export function get_staging_info(): any;
export function commit_index_staging(): any;
export function revert_index_staging(): void;
export function get_staged_modifications(): any;
export function get_staged_deletions(): any;
export function get_modified_files_summary(): any;
export function get_file_diff(path: string): any;
export function get_staged_modifications_with_active(): any;
export function abort_file_load(): void;
/**
 * Validates whether a file can be edited with line-based operations.
 * Returns true if the file can be edited, false if it needs to be read first.
 */
export function validate_can_edit_lines(path: string): boolean;
/**
 * Records that a file has been read, clearing its needs_read flag.
 * Should be called after successfully reading a file's content.
 */
export function record_file_read(path: string): void;
/**
 * Marks a file as needing to be read before line-based edits.
 * This is typically called after line-based edit operations.
 */
export function mark_file_needs_read(path: string): void;
/**
 * Checks if a file needs to be read before line-based edits.
 * Returns true if the file needs to be read, false otherwise.
 */
export function check_file_needs_read(path: string): boolean;
export function create_index_file(path: string, content: Uint8Array | null | undefined, allow_overwrite: boolean): any;
export function delete_file(path: string): any;
export function copy_file(src: string, dst: string): any;
export function copy_files(operations: Array<any>): any;
export function move_file(src: string, dst: string): any;
export function move_files(operations: Array<any>): any;
export function debug_file_info(path: string, use_staged: boolean): any;
export function debug_list_all_files(use_staged: boolean, limit: number): any;
export function replace_lines(path: string, replacements: Array<any>, _use_staged: boolean): any;
export function delete_lines(path: string, line_numbers: Uint32Array, _use_staged: boolean): any;
export function insert_before_line(path: string, line_number: number, content: string, _use_staged: boolean): any;
export function insert_after_line(path: string, line_number: number, content: string, _use_staged: boolean): any;
export function insert_lines(path: string, insertions: Array<any>, _use_staged: boolean): any;
export function read_file_lines(path: string, start_line: number, end_line: number, use_staged: boolean): any;
export function init(): void;
export function ping(): string;
export function file_count(): number;
export function get_index_stats(): any;
export function clear_index(): void;
export function reset_all_indices(): void;
export function begin_file_load(): void;
export function load_file_batch(paths: string[], contents: Uint8Array[], mtimes: Float64Array, permissions: boolean[]): number;
export function load_file_batch_with_text(paths: string[], contents: Uint8Array[], mtimes: Float64Array, permissions: boolean[], text_contents?: string[] | null): number;
export function commit_file_load(): number;
export function search_files(search_term: string, path_prefix?: string | null, include_pattern?: string | null, exclude_pattern?: string | null, case_sensitive?: boolean | null, whole_word?: boolean | null, use_staged?: boolean | null, context_lines?: number | null, limit?: number | null): any;
export function list_files_from_wasm(path_prefix?: string | null, glob_pattern?: string | null, use_staged?: boolean | null, limit?: number | null, offset?: number | null): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly add_files_to_staging: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly promote_staged_index: () => [number, number, number];
  readonly begin_index_staging: () => [number, number];
  readonly get_staging_info: () => [number, number, number];
  readonly commit_index_staging: () => [number, number, number];
  readonly revert_index_staging: () => [number, number];
  readonly get_staged_modifications: () => [number, number, number];
  readonly get_staged_deletions: () => [number, number, number];
  readonly get_modified_files_summary: () => [number, number, number];
  readonly get_file_diff: (a: number, b: number) => [number, number, number];
  readonly get_staged_modifications_with_active: () => [number, number, number];
  readonly abort_file_load: () => [number, number];
  readonly clear_wasm_index: () => [number, number];
  readonly validate_can_edit_lines: (a: number, b: number) => [number, number, number];
  readonly record_file_read: (a: number, b: number) => [number, number];
  readonly mark_file_needs_read: (a: number, b: number) => [number, number];
  readonly check_file_needs_read: (a: number, b: number) => [number, number, number];
  readonly create_index_file: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly delete_file: (a: number, b: number) => [number, number, number];
  readonly copy_file: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly copy_files: (a: any) => [number, number, number];
  readonly move_file: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly move_files: (a: any) => [number, number, number];
  readonly debug_file_info: (a: number, b: number, c: number) => [number, number, number];
  readonly debug_list_all_files: (a: number, b: number) => [number, number, number];
  readonly replace_lines: (a: number, b: number, c: any, d: number) => [number, number, number];
  readonly delete_lines: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly insert_before_line: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly insert_after_line: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly insert_lines: (a: number, b: number, c: any, d: number) => [number, number, number];
  readonly read_file_lines: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly init: () => void;
  readonly ping: () => [number, number];
  readonly file_count: () => number;
  readonly get_index_stats: () => [number, number, number];
  readonly clear_index: () => [number, number];
  readonly reset_all_indices: () => [number, number];
  readonly begin_file_load: () => [number, number];
  readonly load_file_batch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly load_file_batch_with_text: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly commit_file_load: () => [number, number, number];
  readonly search_files: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
  readonly list_files_from_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
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
