/*!
 * WASM bindings for read-before-edit validation operations.
 *
 * This module provides functions to validate that files have been read before
 * line-based editing operations to prevent corruption from stale line numbers.
 */

use crate::globals::{create_path_key, get_index_manager};
use crate::js_err;
use wasm_bindgen::prelude::*;

/// Validates whether a file can be edited with line-based operations.
/// Returns true if the file can be edited, false if it needs to be read first.
#[wasm_bindgen]
pub fn validate_can_edit_lines(path: String) -> Result<bool, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let manager = get_index_manager();
    let needs_read = manager
        .check_needs_read(&path_key)
        .map_err(|e| js_err!("Failed to check needs_read status: {}", e))?;

    Ok(!needs_read)
}

/// Records that a file has been read, clearing its needs_read flag.
/// Should be called after successfully reading a file's content.
#[wasm_bindgen]
pub fn record_file_read(path: String) -> Result<(), JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let manager = get_index_manager();
    manager
        .clear_needs_read(&path_key)
        .map_err(|e| js_err!("Failed to clear needs_read flag: {}", e))
}

/// Marks a file as needing to be read before line-based edits.
/// This is typically called after line-based edit operations.
#[wasm_bindgen]
pub fn mark_file_needs_read(path: String) -> Result<(), JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let manager = get_index_manager();
    manager
        .mark_needs_read(&path_key)
        .map_err(|e| js_err!("Failed to mark file as needs_read: {}", e))
}

/// Checks if a file needs to be read before line-based edits.
/// Returns true if the file needs to be read, false otherwise.
#[wasm_bindgen]
pub fn check_file_needs_read(path: String) -> Result<bool, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let manager = get_index_manager();
    manager
        .check_needs_read(&path_key)
        .map_err(|e| js_err!("Failed to check needs_read status: {}", e))
}
