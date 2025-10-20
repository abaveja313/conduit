use crate::globals::create_path_key;
use crate::js_err;
use crate::orchestrator::Orchestrator;
use crate::utils::{build_line_operation_response, get_string_field, get_usize_field};
use conduit_core::{
    DeleteLinesRequest, DeleteLinesTool, InsertLinesRequest, InsertLinesTool, InsertOperation,
    InsertPosition, ReplaceLinesRequest, ReplaceLinesTool,
};
use js_sys::Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn replace_lines(
    path: String,
    replacements: Array,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let mut line_replacements = Vec::new();
    for i in 0..replacements.length() {
        let pair = replacements.get(i);
        if let Some(array) = pair.dyn_ref::<Array>() {
            if array.length() == 2 {
                let line_num = array
                    .get(0)
                    .as_f64()
                    .ok_or_else(|| js_err!("Line number must be a number"))?;
                let content = array
                    .get(1)
                    .as_string()
                    .ok_or_else(|| js_err!("Line content must be a string"))?;

                if line_num < 1.0 {
                    return Err(js_err!("Line numbers must be 1-based (got {})", line_num));
                }

                line_replacements.push((line_num as usize, line_num as usize, content));
            } else if array.length() == 3 {
                let start_line = array
                    .get(0)
                    .as_f64()
                    .ok_or_else(|| js_err!("Start line must be a number"))?;
                let end_line = array
                    .get(1)
                    .as_f64()
                    .ok_or_else(|| js_err!("End line must be a number"))?;
                let content = array
                    .get(2)
                    .as_string()
                    .ok_or_else(|| js_err!("Line content must be a string"))?;

                if start_line < 1.0 || end_line < 1.0 {
                    return Err(js_err!("Line numbers must be 1-based"));
                }
                if start_line > end_line {
                    return Err(js_err!("Start line must be <= end line"));
                }

                line_replacements.push((start_line as usize, end_line as usize, content));
            } else {
                return Err(js_err!(
                    "Each replacement must be [lineNumber, content] or [startLine, endLine, content]"
                ));
            }
        } else {
            return Err(js_err!("Each replacement must be an array"));
        }
    }

    let request = ReplaceLinesRequest {
        path: path_key,
        replacements: line_replacements,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_replace_lines(request)
        .map_err(|e| js_err!("Failed to replace lines in '{}': {}", path, e))?;

    build_line_operation_response(&response)
}

#[wasm_bindgen]
pub fn delete_lines(
    path: String,
    line_numbers: Vec<usize>,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = DeleteLinesRequest {
        path: path_key,
        line_numbers,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_delete_lines(request)
        .map_err(|e| js_err!("Failed to delete lines from '{}': {}", path, e))?;

    build_line_operation_response(&response)
}

#[wasm_bindgen]
pub fn insert_before_line(
    path: String,
    line_number: usize,
    content: String,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    if line_number < 1 {
        return Err(js_err!("Line number must be 1-based"));
    }

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = InsertLinesRequest {
        path: path_key,
        insertions: vec![InsertOperation {
            line_number,
            content,
            position: InsertPosition::Before,
        }],
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator.run_insert_lines(request).map_err(|e| {
        js_err!(
            "Failed to insert before line {} in '{}': {}",
            line_number,
            path,
            e
        )
    })?;

    build_line_operation_response(&response)
}

#[wasm_bindgen]
pub fn insert_after_line(
    path: String,
    line_number: usize,
    content: String,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    if line_number < 1 {
        return Err(js_err!("Line number must be 1-based"));
    }

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = InsertLinesRequest {
        path: path_key,
        insertions: vec![InsertOperation {
            line_number,
            content,
            position: InsertPosition::After,
        }],
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator.run_insert_lines(request).map_err(|e| {
        js_err!(
            "Failed to insert after line {} in '{}': {}",
            line_number,
            path,
            e
        )
    })?;

    build_line_operation_response(&response)
}

#[wasm_bindgen]
pub fn insert_lines(
    path: String,
    insertions: Array,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let mut insert_operations = Vec::new();
    for i in 0..insertions.length() {
        let insertion = insertions.get(i);
        if let Some(obj) = insertion.dyn_ref::<js_sys::Object>() {
            let line_number = get_usize_field(obj, "lineNumber")?;
            let content = get_string_field(obj, "content")?;
            let position_str = get_string_field(obj, "position")?;

            let position = match position_str.as_str() {
                "before" => InsertPosition::Before,
                "after" => InsertPosition::After,
                _ => {
                    return Err(js_err!(
                        "Invalid position '{}', must be 'before' or 'after'",
                        position_str
                    ))
                }
            };

            insert_operations.push(InsertOperation {
                line_number,
                content,
                position,
            });
        } else {
            return Err(js_err!("Each insertion must be an object"));
        }
    }

    let request = InsertLinesRequest {
        path: path_key,
        insertions: insert_operations,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_insert_lines(request)
        .map_err(|e| js_err!("Failed to insert lines in '{}': {}", path, e))?;

    build_line_operation_response(&response)
}
