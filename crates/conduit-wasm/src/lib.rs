//! WASM facade for Conduit core functionality.
//!
//! This crate provides the WASM bindings for the Conduit core,
//! managing global state and exposing a simple API to JavaScript.

use wasm_bindgen::prelude::*;

mod globals;
mod orchestrator;

/// Initialize the WASM module.
///
/// This should be called once when the module loads.
#[wasm_bindgen]
pub fn init() {
    // Set panic hook for better error messages in development
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Test function to verify the module is working.
#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

/// Load a file into the index.
///
/// This is a simple test function to verify file loading works.
#[wasm_bindgen]
#[allow(unused_variables)]
pub fn load_file(path: String, content: Vec<u8>, mtime: i64) -> Result<(), JsValue> {
    Ok(())
}

/// Commit staged changes to the active index.
#[wasm_bindgen]
#[allow(unused_variables)]
pub fn commit_staged() -> std::result::Result<(), JsValue> {
    Ok(())
}

/// Get the number of files in the active index.
#[wasm_bindgen]
#[allow(unused_variables)]
pub fn file_count() -> usize {
    0
}
