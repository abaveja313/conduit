use crate::globals::create_path_key;
use crate::js_err;
use crate::orchestrator::Orchestrator;
use crate::utils::JsObjectBuilder;
use conduit_core::{ReadTool, SearchSpace};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn read_file_lines(
    path: String,
    start_line: usize,
    end_line: usize,
    use_staged: bool,
) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let where_ = if use_staged {
        SearchSpace::Staged
    } else {
        SearchSpace::Active
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_read(&path_key, start_line, end_line, where_)
        .map_err(|e| js_err!("Failed to read '{}': {}", path, e))?;

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(&path))?
        .set("startLine", JsValue::from(response.start_line as u32))?
        .set("endLine", JsValue::from(response.end_line as u32))?
        .set("content", JsValue::from_str(&response.content))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .build();

    Ok(obj)
}
