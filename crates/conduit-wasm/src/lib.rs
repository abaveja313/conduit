//! WASM facade for Conduit core functionality.
//!
//! This crate provides the WASM bindings for the Conduit core,
//! managing global state and exposing a simple API to JavaScript.

use crate::globals::{create_path_key, get_index_manager};
use conduit_core::fs::FileEntry;
use js_sys::Uint8Array;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

mod globals;
mod orchestrator;

// Helper macro for consistent error conversion
macro_rules! js_err {
    ($msg:expr) => {
        JsValue::from_str($msg)
    };
    ($fmt:expr, $($arg:tt)*) => {
        JsValue::from_str(&format!($fmt, $($arg)*))
    };
}

/// Initialize the WASM module.
#[wasm_bindgen]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Test function to verify the module is working.
#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

/// Begin a new file loading session.
/// Clears any existing index and starts fresh staging.
#[wasm_bindgen]
pub fn begin_file_load() -> Result<(), JsValue> {
    let manager = get_index_manager();

    // Clear existing index
    manager.load_files(vec![]).map_err(|e| js_err!("{}", e))?;

    // Start new staging session
    manager.begin_staging().map_err(|e| js_err!("{}", e))
}

/// Load a batch of files with content into staging.
/// Arrays must have the same length.
#[wasm_bindgen]
pub fn load_file_batch(
    paths: Vec<String>,
    contents: js_sys::Array, // Array of Uint8Arrays
    mtimes: Vec<f64>,        // JS timestamps are always f64
) -> Result<usize, JsValue> {
    // Validate input arrays have same length
    let len = paths.len();
    let contents_len = contents.length() as usize;
    if contents_len != len || mtimes.len() != len {
        return Err(js_err!(
            "Array length mismatch: paths={}, contents={}, mtimes={}",
            paths.len(),
            contents_len,
            mtimes.len()
        ));
    }

    if len == 0 {
        return Ok(0);
    }

    let manager = get_index_manager();
    let mut entries = Vec::with_capacity(len);

    // Process each file
    for i in 0..len {
        if paths[i].is_empty() {
            return Err(js_err!("Empty path at index {}", i));
        }

        let path_key = create_path_key(&paths[i])
            .map_err(|e| js_err!("Invalid path '{}': {}", paths[i], e))?;

        // Validate timestamp
        if !mtimes[i].is_finite() || mtimes[i] < 0.0 {
            return Err(js_err!(
                "Invalid timestamp for '{}': {}",
                paths[i],
                mtimes[i]
            ));
        }

        // Convert JS timestamp (ms) to Unix timestamp (seconds)
        let mtime_secs = (mtimes[i] / 1000.0) as i64;

        // Get Uint8Array from the array and convert to Vec<u8>
        let uint8_array = Uint8Array::from(contents.get(i as u32));
        let content_vec = uint8_array.to_vec();

        // Convert Vec directly to Arc<[u8]> without extra copy
        let content_arc: Arc<[u8]> = content_vec.into();
        let entry = FileEntry::from_bytes_and_path(&path_key, mtime_secs, content_arc);

        entries.push((path_key, entry));
    }

    // Add all entries to staging
    manager
        .add_files_to_staging(entries)
        .map_err(|e| js_err!("{}", e))?;

    Ok(len)
}

/// Commit all staged files to the active index.
/// Returns the number of files committed.
#[wasm_bindgen]
pub fn commit_file_load() -> Result<usize, JsValue> {
    let manager = get_index_manager();

    // Get staged index to count files
    let staged = manager.staged_index().map_err(|e| js_err!("{}", e))?;
    let count = staged.len();

    // Promote staged to active
    manager.promote_staged().map_err(|e| js_err!("{}", e))?;

    Ok(count)
}

/// Abort the current file load and discard staged changes.
#[wasm_bindgen]
pub fn abort_file_load() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager.revert_staged().map_err(|e| js_err!("{}", e))
}

/// Get the number of files in the active index.
#[wasm_bindgen]
pub fn file_count() -> usize {
    let manager = get_index_manager();
    let index = manager.active_index();
    index.len()
}

/// Clear the entire index.
#[wasm_bindgen]
pub fn clear_index() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager.load_files(vec![]).map_err(|e| js_err!("{}", e))
}

/// Get basic statistics about the current index.
#[wasm_bindgen]
pub fn get_index_stats() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let index = manager.active_index();

    let obj = js_sys::Object::new();

    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("fileCount"),
        &JsValue::from(index.len()),
    )?;

    Ok(obj.into())
}
