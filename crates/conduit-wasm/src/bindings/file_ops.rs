use crate::globals::create_path_key;
use crate::js_err;
use crate::orchestrator::Orchestrator;
use crate::utils::{parse_file_operations, JsObjectBuilder};
use conduit_core::{
    BatchCopyRequest, BatchMoveRequest, CreateRequest, CreateResponse, CreateTool, DeleteRequest,
    DeleteResponse, DeleteTool, FileOperation, MoveFilesTool,
};
use js_sys::{Array, Uint8Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_index_file(
    path: String,
    content: Option<Uint8Array>,
    allow_overwrite: bool,
) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;
    let content_bytes = content.map(|arr| arr.to_vec());

    let request = CreateRequest {
        path: path_key,
        content: content_bytes,
        allow_overwrite,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_create(request)
        .map_err(|e| js_err!("Failed to create '{}': {}", path, e))?;

    let CreateResponse {
        path: response_path,
        size,
        created,
    } = response;

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response_path.as_str()))?
        .set("size", JsValue::from_f64(size as f64))?
        .set("created", JsValue::from_bool(created))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn delete_file(path: String) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;
    let request = DeleteRequest::new(path_key);

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_delete(request)
        .map_err(|e| js_err!("Failed to delete '{}': {}", path, e))?;

    let DeleteResponse {
        path: response_path,
        existed,
    } = response;

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response_path.as_str()))?
        .set("existed", JsValue::from_bool(existed))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn copy_file(src: String, dst: String) -> Result<JsValue, JsValue> {
    let src_key =
        create_path_key(&src).map_err(|e| js_err!("Invalid source path '{}': {}", src, e))?;
    let dst_key =
        create_path_key(&dst).map_err(|e| js_err!("Invalid destination path '{}': {}", dst, e))?;

    let request = BatchCopyRequest {
        operations: vec![FileOperation {
            src: src_key,
            dst: dst_key.clone(),
        }],
    };

    let mut orchestrator = Orchestrator::new();
    orchestrator
        .run_copy_files(request)
        .map_err(|e| js_err!("Failed to copy file: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("dst", JsValue::from(dst_key.as_str()))?
        .build();
    Ok(obj)
}

#[wasm_bindgen]
pub fn copy_files(operations: Array) -> Result<JsValue, JsValue> {
    let file_operations = parse_file_operations(&operations)?;

    let request = BatchCopyRequest {
        operations: file_operations,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_copy_files(request)
        .map_err(|e| js_err!("Failed to copy files: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("count", JsValue::from(response.count as u32))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn move_file(src: String, dst: String) -> Result<JsValue, JsValue> {
    let src_key =
        create_path_key(&src).map_err(|e| js_err!("Invalid source path '{}': {}", src, e))?;
    let dst_key =
        create_path_key(&dst).map_err(|e| js_err!("Invalid destination path '{}': {}", dst, e))?;

    let request = BatchMoveRequest {
        operations: vec![FileOperation {
            src: src_key,
            dst: dst_key.clone(),
        }],
    };

    let mut orchestrator = Orchestrator::new();
    orchestrator
        .run_move_files(request)
        .map_err(|e| js_err!("Failed to move file: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("dst", JsValue::from(dst_key.as_str()))?
        .build();
    Ok(obj)
}

#[wasm_bindgen]
pub fn move_files(operations: Array) -> Result<JsValue, JsValue> {
    let file_operations = parse_file_operations(&operations)?;

    let request = BatchMoveRequest {
        operations: file_operations,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_move_files(request)
        .map_err(|e| js_err!("Failed to move files: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("count", JsValue::from(response.count as u32))?
        .build();

    Ok(obj)
}
