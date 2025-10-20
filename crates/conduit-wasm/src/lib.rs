//! WASM bindings for Conduit core functionality.

use js_sys::Date;
use wasm_bindgen::prelude::*;

mod bindings;
mod globals;
mod orchestrator;
mod utils;

pub use bindings::*;
pub(crate) fn current_unix_timestamp() -> i64 {
    let now_ms = Date::now();
    if !now_ms.is_finite() {
        return 0;
    }
    (now_ms / 1000.0).floor() as i64
}

#[wasm_bindgen]
pub fn init() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}

#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

#[wasm_bindgen]
pub fn file_count() -> u32 {
    use crate::globals::get_index_manager;
    get_index_manager().active_index().len() as u32
}

#[wasm_bindgen]
pub fn get_index_stats() -> Result<JsValue, JsValue> {
    use crate::globals::get_index_manager;
    use crate::js_err;
    use crate::utils::JsObjectBuilder;

    let manager = get_index_manager();
    let active = manager.active_index();
    let staged = manager
        .staged_index()
        .map_err(|e| js_err!("Failed to access staged index: {}", e))?;

    let active_count = active.len() as u32;
    let staged_count = staged.len() as u32;

    let obj = JsObjectBuilder::new()
        .set("activeFiles", JsValue::from(active_count))?
        .set("stagedFiles", JsValue::from(staged_count))?
        .set("hasStagedChanges", JsValue::from_bool(staged_count > 0))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn clear_index() -> Result<(), JsValue> {
    use crate::globals::get_index_manager;

    let manager = get_index_manager();
    manager.clear_line_index_cache();
    Ok(())
}

#[wasm_bindgen]
pub fn begin_file_load() -> Result<(), JsValue> {
    use crate::globals::get_index_manager;

    let manager = get_index_manager();
    manager.clear_line_index_cache();
    manager
        .begin_staging()
        .map_err(|e| js_err!("Failed to begin staging: {}", e))
}

#[wasm_bindgen]
pub fn load_file_batch(
    paths: Vec<String>,
    contents: Vec<js_sys::Uint8Array>,
    mtimes: Vec<f64>,
    permissions: Vec<js_sys::Boolean>,
) -> Result<usize, JsValue> {
    load_file_batch_with_text(paths, contents, mtimes, permissions, None)
}

#[wasm_bindgen]
pub fn load_file_batch_with_text(
    paths: Vec<String>,
    contents: Vec<js_sys::Uint8Array>,
    mtimes: Vec<f64>,
    permissions: Vec<js_sys::Boolean>,
    text_contents: Option<Vec<String>>,
) -> Result<usize, JsValue> {
    bindings::staging_ops::add_files_to_staging(paths, contents, mtimes, permissions, text_contents)
}

#[wasm_bindgen]
pub fn commit_file_load() -> Result<usize, JsValue> {
    bindings::staging_ops::promote_staged_index()
}
