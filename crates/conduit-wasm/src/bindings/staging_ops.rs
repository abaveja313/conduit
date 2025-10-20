use crate::globals::{create_path_key, get_index_manager};
use crate::js_err;
use crate::orchestrator::Orchestrator;
use crate::utils::JsObjectBuilder;
use conduit_core::fs::FileEntry;
use conduit_core::DiffTool;
use js_sys::{Array, Boolean, Uint8Array};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn clear_wasm_index() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .begin_staging()
        .map_err(|e| js_err!("Failed to begin staging: {}", e))
}

#[wasm_bindgen]
pub fn add_files_to_staging(
    paths: Vec<String>,
    contents: Vec<Uint8Array>,
    mtimes: Vec<f64>,
    permissions: Vec<Boolean>,
    text_contents: Option<Vec<String>>,
) -> Result<usize, JsValue> {
    let len = paths.len();
    if contents.len() != len || mtimes.len() != len || permissions.len() != len {
        return Err(js_err!(
            "Array length mismatch: paths={}, contents={}, mtimes={}, permissions={}",
            paths.len(),
            contents.len(),
            mtimes.len(),
            permissions.len()
        ));
    }

    if let Some(ref texts) = text_contents {
        if texts.len() != len {
            return Err(js_err!(
                "Text contents array length mismatch: expected {}, got {}",
                len,
                texts.len()
            ));
        }
    }

    let mut entries = Vec::with_capacity(len);

    for i in 0..len {
        if paths[i].is_empty() {
            return Err(js_err!("Empty path at index {}", i));
        }

        let path_key = create_path_key(&paths[i])
            .map_err(|e| js_err!("Invalid path '{}': {}", paths[i], e))?;

        if !mtimes[i].is_finite() || mtimes[i] < 0.0 {
            return Err(js_err!(
                "Invalid timestamp for '{}': {}",
                paths[i],
                mtimes[i]
            ));
        }

        let original_bytes = contents[i].to_vec();
        let is_editable = permissions[i].value_of();

        let search_content = if is_editable {
            text_contents
                .as_ref()
                .map(|texts| texts[i].as_bytes().to_vec())
        } else {
            None
        };

        let timestamp = (mtimes[i] / 1000.0).floor() as i64;
        let ext = FileEntry::get_extension(path_key.as_str());

        let entry = if let Some(search_content) = search_content {
            FileEntry::from_bytes_with_text(
                ext,
                timestamp,
                Arc::from(original_bytes),
                Arc::from(search_content),
                is_editable,
            )
        } else {
            FileEntry::from_bytes(ext, timestamp, Arc::from(original_bytes), is_editable)
        };

        entries.push((path_key, entry));
    }

    let manager = get_index_manager();
    manager
        .add_files_to_staging(entries)
        .map_err(|e| js_err!("Failed to add files to staging: {}", e))?;

    Ok(len)
}

#[wasm_bindgen]
pub fn promote_staged_index() -> Result<usize, JsValue> {
    let manager = get_index_manager();
    manager
        .staged_index()
        .map_err(|e| js_err!("Failed to access staged index: {}", e))?;
    let count = manager
        .staged_index()
        .map_err(|e| js_err!("Failed to get staged index: {}", e))?
        .len();

    manager
        .promote_staged()
        .map_err(|e| js_err!("Failed to commit staged files: {}", e))?;

    Ok(count)
}

#[wasm_bindgen]
pub fn begin_index_staging() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .begin_staging()
        .map_err(|e| js_err!("Failed to begin staging: {}", e))
}

#[wasm_bindgen]
pub fn get_staging_info() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let modifications = manager
        .get_staged_modifications()
        .map_err(|e| js_err!("Failed to get staged modifications: {}", e))?;

    let deletions = manager
        .get_staged_deletions()
        .map_err(|e| js_err!("Failed to get staged deletions: {}", e))?;

    let staged = manager
        .staged_index()
        .map_err(|e| js_err!("Failed to access staged index: {}", e))?;
    let count = staged.len() as u32;

    let obj = JsObjectBuilder::new()
        .set("fileCount", JsValue::from(count))?
        .set("modifiedCount", JsValue::from(modifications.len() as u32))?
        .set("deletedCount", JsValue::from(deletions.len() as u32))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn commit_index_staging() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let staged = manager
        .staged_index()
        .map_err(|e| js_err!("Failed to access staged index: {}", e))?;
    let file_count = staged.len();

    manager
        .promote_staged()
        .map_err(|e| js_err!("Failed to promote staged index: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("fileCount", JsValue::from(file_count as u32))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn revert_index_staging() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .revert_staged()
        .map_err(|e| js_err!("Failed to revert staging: {}", e))
}

#[wasm_bindgen]
pub fn get_staged_modifications() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let modifications = manager
        .get_staged_modifications()
        .map_err(|e| js_err!("Failed to get staged modifications: {}", e))?;

    let modified_array = Array::new();
    for (path, _) in &modifications {
        modified_array.push(&JsValue::from_str(path.as_str()));
    }

    Ok(modified_array.into())
}

#[wasm_bindgen]
pub fn get_staged_deletions() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let deletions = manager
        .get_staged_deletions()
        .map_err(|e| js_err!("Failed to get staged deletions: {}", e))?;

    let deleted_array = Array::new();
    for path in &deletions {
        deleted_array.push(&JsValue::from_str(path.as_str()));
    }

    Ok(deleted_array.into())
}

#[wasm_bindgen]
pub fn get_modified_files_summary() -> Result<JsValue, JsValue> {
    let orchestrator = Orchestrator::new();
    let summaries = orchestrator
        .get_modified_files_summary()
        .map_err(|e| js_err!("Failed to get modified files summary: {}", e))?;

    let result_array = Array::new();
    for summary in summaries {
        let obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(summary.path.as_str()))?
            .set("linesAdded", JsValue::from(summary.lines_added as u32))?
            .set("linesRemoved", JsValue::from(summary.lines_removed as u32))?
            .set(
                "status",
                JsValue::from_str(&format!("{:?}", summary.status).to_lowercase()),
            )?;

        let obj = if let Some(moved_to) = summary.moved_to {
            obj.set("movedTo", JsValue::from_str(moved_to.as_str()))?
        } else {
            obj
        };

        result_array.push(&obj.build());
    }

    Ok(result_array.into())
}

#[wasm_bindgen]
pub fn get_file_diff(path: String) -> Result<JsValue, JsValue> {
    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let orchestrator = Orchestrator::new();
    let diff = orchestrator
        .get_file_diff(&path_key)
        .map_err(|e| js_err!("Failed to get file diff for '{}': {}", path, e))?;

    let regions_array = Array::new();
    for region in diff.regions {
        let removed_lines_array = Array::new();
        for line in &region.removed_lines {
            removed_lines_array.push(&JsValue::from_str(line));
        }

        let added_lines_array = Array::new();
        for line in &region.added_lines {
            added_lines_array.push(&JsValue::from_str(line));
        }

        let region_obj = JsObjectBuilder::new()
            .set("originalStart", JsValue::from(region.original_start as u32))?
            .set("linesRemoved", JsValue::from(region.lines_removed as u32))?
            .set("modifiedStart", JsValue::from(region.modified_start as u32))?
            .set("linesAdded", JsValue::from(region.lines_added as u32))?
            .set("removedLines", removed_lines_array.into())?
            .set("addedLines", added_lines_array.into())?
            .build();

        regions_array.push(&region_obj);
    }

    let stats_obj = JsObjectBuilder::new()
        .set("linesAdded", JsValue::from(diff.stats.lines_added as u32))?
        .set(
            "linesRemoved",
            JsValue::from(diff.stats.lines_removed as u32),
        )?
        .set(
            "regionsChanged",
            JsValue::from(diff.stats.regions_changed as u32),
        )?
        .build();

    let diff_obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(diff.path.as_str()))?
        .set("stats", stats_obj)?
        .set("regions", regions_array.into())?
        .build();

    Ok(diff_obj)
}

#[wasm_bindgen]
pub fn get_staged_modifications_with_active() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let modifications = manager
        .get_staged_modifications()
        .map_err(|e| js_err!("Failed to get staged modifications: {}", e))?;

    let modified_array = Array::new();
    let active_index = manager.active_index();

    for (path, staged_content) in modifications {
        let obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set(
                "stagedContent",
                Uint8Array::from(&staged_content[..]).into(),
            )?;

        let obj = if let Some(active_entry) = active_index.get_file(&path) {
            if let Some(active_bytes) = active_entry.bytes() {
                obj.set("activeContent", Uint8Array::from(active_bytes).into())?
            } else {
                obj
            }
        } else {
            obj
        };

        modified_array.push(&obj.build());
    }

    Ok(modified_array.into())
}

#[wasm_bindgen]
pub fn abort_file_load() -> Result<(), JsValue> {
    Ok(())
}
