use crate::globals::{create_path_key, get_index_manager};
use crate::js_err;
use crate::utils::JsObjectBuilder;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn debug_file_info(path: String, use_staged: bool) -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    let index = if use_staged {
        manager
            .staged_index()
            .map_err(|e| js_err!("Failed to get staged index: {}", e))?
    } else {
        manager.active_index()
    };

    let path_key = create_path_key(&path)
        .map_err(|e| js_err!("Failed to create path key '{}': {}", path, e))?;

    let mut obj = JsObjectBuilder::new();
    obj = obj.set("originalPath", JsValue::from_str(&path))?;
    obj = obj.set("normalizedPath", JsValue::from_str(path_key.as_str()))?;
    obj = obj.set("pathKey", JsValue::from_str(path_key.as_str()))?;
    obj = obj.set(
        "indexType",
        JsValue::from_str(if use_staged { "staged" } else { "active" }),
    )?;
    obj = obj.set("totalFilesInIndex", JsValue::from(index.len() as u32))?;

    if let Some(entry) = index.get_file(&path_key) {
        obj = obj.set("fileFound", JsValue::from(true))?;
        obj = obj.set("hasBytes", JsValue::from(entry.bytes().is_some()))?;
        obj = obj.set(
            "bytesLen",
            JsValue::from(entry.bytes().map(|b| b.len()).unwrap_or(0) as u32),
        )?;
        obj = obj.set(
            "hasSearchContent",
            JsValue::from(entry.search_content().is_some()),
        )?;
        obj = obj.set(
            "searchContentLen",
            JsValue::from(entry.search_content().map(|c| c.len()).unwrap_or(0) as u32),
        )?;
        obj = obj.set("isEditable", JsValue::from(entry.is_editable()))?;
        obj = obj.set("mtime", JsValue::from(entry.mtime() as f64))?;

        // Check if line index can be built
        if let Some(line_index) = manager.get_line_index(&path_key, &index) {
            obj = obj.set("lineIndexBuilt", JsValue::from(true))?;
            obj = obj.set("totalLines", JsValue::from(line_index.line_count() as u32))?;
            obj = obj.set(
                "lineIndexTotalBytes",
                JsValue::from(line_index.total_bytes() as u32),
            )?;
        } else {
            obj = obj.set("lineIndexBuilt", JsValue::from(false))?;
        }
    } else {
        obj = obj.set("fileFound", JsValue::from(false))?;

        // List some files that ARE in the index for debugging
        let mut sample_files = Vec::new();
        for (p, _) in index.iter_sorted().take(10) {
            sample_files.push(JsValue::from_str(p.as_str()));
        }
        let sample_array = js_sys::Array::from_iter(sample_files);
        obj = obj.set("sampleFilesInIndex", JsValue::from(sample_array))?;
    }

    Ok(obj.build())
}

#[wasm_bindgen]
pub fn debug_list_all_files(use_staged: bool, limit: usize) -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    let index = if use_staged {
        manager
            .staged_index()
            .map_err(|e| js_err!("Failed to get staged index: {}", e))?
    } else {
        manager.active_index()
    };

    let files = js_sys::Array::new();
    for (path, entry) in index.iter_sorted().take(limit) {
        let file_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set("hasBytes", JsValue::from(entry.bytes().is_some()))?
            .set(
                "hasSearchContent",
                JsValue::from(entry.search_content().is_some()),
            )?
            .set("isEditable", JsValue::from(entry.is_editable()))?
            .build();
        files.push(&file_obj);
    }

    Ok(JsValue::from(files))
}
