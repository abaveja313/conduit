//! WASM facade for Conduit core functionality.
//!
//! This crate provides the WASM bindings for the Conduit core,
//! managing global state and exposing a simple API to JavaScript.

use crate::globals::{create_path_key, get_index_manager};
use conduit_core::{
    fs::FileEntry, CreateRequest, CreateResponse, CreateTool, DeleteRequest, DeleteResponse,
    DeleteTool, SearchSpace,
};
use globset::Glob;
use js_sys::{Date, Uint8Array};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

mod globals;
mod orchestrator;

pub(crate) fn current_unix_timestamp() -> i64 {
    let now_ms = Date::now();
    if !now_ms.is_finite() {
        return 0;
    }
    (now_ms / 1000.0).floor() as i64
}

// Helper macro for consistent error conversion
macro_rules! js_err {
    ($msg:expr) => {
        JsValue::from_str($msg)
    };
    ($fmt:expr, $($arg:tt)*) => {
        JsValue::from_str(&format!($fmt, $($arg)*))
    };
}

// Helper to build JavaScript objects more ergonomically
struct JsObjectBuilder {
    obj: js_sys::Object,
}

impl JsObjectBuilder {
    fn new() -> Self {
        Self {
            obj: js_sys::Object::new(),
        }
    }

    fn set(self, key: &str, value: JsValue) -> Result<Self, JsValue> {
        js_sys::Reflect::set(&self.obj, &JsValue::from_str(key), &value)
            .map_err(|e| js_err!("Failed to set property '{}': {:?}", key, e))?;
        Ok(self)
    }

    fn build(self) -> JsValue {
        self.obj.into()
    }
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
    manager
        .load_files(vec![])
        .map_err(|e| js_err!("Failed to clear index: {}", e))?;

    // Start new staging session
    manager
        .begin_staging()
        .map_err(|e| js_err!("Failed to begin staging: {}", e))
}

/// Load a batch of files with content into staging.
/// Arrays must have the same length.
#[wasm_bindgen]
pub fn load_file_batch(
    paths: Vec<String>,
    contents: js_sys::Array, // Array of Uint8Arrays
    mtimes: Vec<f64>,        // JS timestamps are always f64
) -> Result<usize, JsValue> {
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

        // Convert JS timestamp (ms) to Unix timestamp (seconds)
        let mtime_secs = (mtimes[i] / 1000.0) as i64;

        let uint8_array = Uint8Array::from(contents.get(i as u32));
        let content_vec = uint8_array.to_vec();

        // Convert Vec directly to Arc<[u8]> without extra copy
        let content_arc: Arc<[u8]> = content_vec.into();

        let ext = FileEntry::get_extension(path_key.as_str());
        let entry = FileEntry::from_bytes(ext, mtime_secs, content_arc);

        entries.push((path_key, entry));
    }

    manager
        .add_files_to_staging(entries)
        .map_err(|e| js_err!("Failed to add files to staging: {}", e))?;

    Ok(len)
}

/// Commit all staged files to the active index.
/// Returns the number of files committed.
#[wasm_bindgen]
pub fn commit_file_load() -> Result<usize, JsValue> {
    let manager = get_index_manager();

    let staged = manager
        .staged_index()
        .map_err(|e| js_err!("Failed to access staged index: {}", e))?;
    let count = staged.len();

    // Promote staged to active
    manager
        .promote_staged()
        .map_err(|e| js_err!("Failed to commit staged files: {}", e))?;

    Ok(count)
}

/// Abort the current file load and discard staged changes.
#[wasm_bindgen]
pub fn abort_file_load() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .revert_staged()
        .map_err(|e| js_err!("Failed to abort file load: {}", e))
}

/// Begin a manual staging session.
#[wasm_bindgen]
pub fn begin_index_staging() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .begin_staging()
        .map_err(|e| js_err!("Failed to begin staging: {}", e))
}

/// Commit the staged index to active, returning modified files and count.
#[wasm_bindgen]
pub fn commit_index_staging() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    // Get modifications before promoting
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

    let modified_array = js_sys::Array::new();
    for (path, content) in modifications {
        let file_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set("content", Uint8Array::from(content.as_slice()).into())?
            .build();
        modified_array.push(&file_obj);
    }

    let deleted_array = js_sys::Array::new();
    for path in deletions {
        deleted_array.push(&JsValue::from_str(path.as_str()));
    }

    // Promote after we've collected the data
    manager
        .promote_staged()
        .map_err(|e| js_err!("Failed to promote staged index: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("fileCount", JsValue::from(count))?
        .set("modified", modified_array.into())?
        .set("deleted", deleted_array.into())?
        .build();

    Ok(obj)
}

/// Revert active staging session without committing.
#[wasm_bindgen]
pub fn revert_index_staging() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .revert_staged()
        .map_err(|e| js_err!("Failed to revert staging: {}", e))
}

/// Get staged modifications without committing.
#[wasm_bindgen]
pub fn get_staged_modifications() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    let modifications = manager
        .get_staged_modifications()
        .map_err(|e| js_err!("Failed to get staged modifications: {}", e))?;

    let modified_array = js_sys::Array::new();
    for (path, content) in modifications {
        let file_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set("content", Uint8Array::from(content.as_slice()).into())?
            .build();
        modified_array.push(&file_obj);
    }

    Ok(modified_array.into())
}

/// Get staged deletions without committing.
#[wasm_bindgen]
pub fn get_staged_deletions() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    let deletions = manager
        .get_staged_deletions()
        .map_err(|e| js_err!("Failed to get staged deletions: {}", e))?;

    let deleted_array = js_sys::Array::new();
    for path in deletions {
        deleted_array.push(&JsValue::from_str(path.as_str()));
    }

    Ok(deleted_array.into())
}

/// Get the number of files in the active index.
#[wasm_bindgen]
pub fn file_count() -> u32 {
    let manager = get_index_manager();
    let index = manager.active_index();
    index.len() as u32
}

/// Clear the entire index.
#[wasm_bindgen]
pub fn clear_index() -> Result<(), JsValue> {
    let manager = get_index_manager();
    manager
        .load_files(vec![])
        .map_err(|e| js_err!("Failed to clear index: {}", e))
}

/// Get basic statistics about the current index.
#[wasm_bindgen]
pub fn get_index_stats() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();
    let index = manager.active_index();

    let obj = JsObjectBuilder::new()
        .set("fileCount", JsValue::from(index.len() as u32))?
        .build();

    Ok(obj)
}

/// Read specific lines from a file in the index.
///
/// # Arguments
/// * `path` - The file path to read from
/// * `start_line` - Starting line number (1-based, inclusive)
/// * `end_line` - Ending line number (1-based, inclusive)
/// * `use_staged` - If true, read from staged index; otherwise read from active index
///
/// # Returns
/// A JavaScript object containing:
/// - `path`: The file path
/// - `startLine`: The actual start line (may be clamped to file bounds)
/// - `endLine`: The actual end line (may be clamped to file bounds)
/// - `content`: The extracted text content
/// - `totalLines`: Total number of lines in the file
#[wasm_bindgen]
pub fn read_file_lines(
    path: String,
    start_line: usize,
    end_line: usize,
    use_staged: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::ReadTool;

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    // Determine search space
    let where_ = if use_staged {
        SearchSpace::Staged
    } else {
        SearchSpace::Active
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_read(&path_key, start_line, end_line, where_)
        .map_err(|e| js_err!("Failed to read '{}': {}", path, e))?;

    // Build JavaScript object directly from ReadResponse
    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(&path))?
        .set("startLine", JsValue::from(response.start_line as u32))?
        .set("endLine", JsValue::from(response.end_line as u32))?
        .set("content", JsValue::from_str(&response.content))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .build();

    Ok(obj)
}

/// Create or overwrite a file in the staged index.
#[wasm_bindgen]
pub fn create_index_file(
    path: String,
    content: Option<Uint8Array>,
    allow_overwrite: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;

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

/// List files from the index with pagination support.
///
/// # Arguments
/// * `start` - Starting index (0-based, inclusive)
/// * `stop` - Ending index (exclusive). If 0, returns all files from start.
/// * `use_staged` - If true, list from staged index; otherwise list from active index
///
/// # Returns
/// A JavaScript object containing:
/// - `files`: Array of file objects with path and metadata
/// - `total`: Total number of files in the index
/// - `start`: The actual start index used
/// - `end`: The actual end index (exclusive) of returned files
#[wasm_bindgen]
pub fn list_files(
    start: usize,
    stop: usize,
    use_staged: bool,
    glob_pattern: Option<String>,
) -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    // Get the appropriate index
    let index = if use_staged {
        match manager.staged_index() {
            Ok(idx) => idx,
            Err(e) => return Err(js_err!("Failed to access staged index: {}", e)),
        }
    } else {
        manager.active_index()
    };

    // Collect all files (with optional glob filtering)
    let all_files: Vec<_> = match glob_pattern {
        Some(pattern) => {
            let glob = Glob::new(&pattern).map_err(|e| js_err!("Invalid glob pattern: {}", e))?;
            let matcher = glob.compile_matcher();
            index
                .iter_sorted()
                .filter(|(path, _)| matcher.is_match(path.as_str()))
                .collect()
        }
        None => index.iter_sorted().collect(),
    };

    let total = all_files.len();
    let files_array = js_sys::Array::new();

    let paginated = all_files.into_iter().skip(start).take(if stop == 0 {
        usize::MAX
    } else {
        stop.saturating_sub(start)
    });

    let mut count = 0;
    for (path, entry) in paginated {
        let file_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set("size", JsValue::from_f64(entry.size() as f64))?
            .set("mtime", JsValue::from_f64(entry.mtime() as f64))?
            .set("extension", JsValue::from_str(entry.ext()))?
            .build();
        files_array.push(&file_obj);
        count += 1;
    }

    Ok(JsObjectBuilder::new()
        .set("files", files_array.into())?
        .set("total", JsValue::from(total as u32))?
        .set("start", JsValue::from(start.min(total) as u32))?
        .set("end", JsValue::from((start.min(total) + count) as u32))?
        .build())
}

/// Search for matches in files using regex patterns.
///
/// Returns an array of preview hunks showing matches with surrounding context.
#[wasm_bindgen]
pub fn find_in_files(
    pattern: String,
    use_staged: bool,
    case_insensitive: Option<bool>,
    whole_word: Option<bool>,
    include_globs: Option<Vec<JsValue>>,
    exclude_globs: Option<Vec<JsValue>>,
    context_lines: Option<usize>,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::{AbortFlag, FindRequest, FindTool, RegexEngineOpts, SearchSpace};

    let include_globs =
        include_globs.map(|arr| arr.into_iter().filter_map(|v| v.as_string()).collect());
    let exclude_globs =
        exclude_globs.map(|arr| arr.into_iter().filter_map(|v| v.as_string()).collect());

    let req = FindRequest {
        find: pattern,
        where_: if use_staged {
            SearchSpace::Staged
        } else {
            SearchSpace::Active
        },
        include_globs,
        exclude_globs,
        prefix: None,
        delta: context_lines.unwrap_or(2),
        engine_opts: RegexEngineOpts {
            case_insensitive: case_insensitive.unwrap_or(false),
            word: whole_word.unwrap_or(false),
            ..Default::default()
        },
    };

    let mut orchestrator = Orchestrator::new();
    let abort = AbortFlag::new();

    let resp = orchestrator
        .run_find(req, &abort)
        .map_err(|e| js_err!("Search failed: {}", e))?;

    let results_array = js_sys::Array::new();

    for hunk in resp.results {
        let matched_ranges = js_sys::Array::new();
        for (start, end) in hunk.matched_line_ranges {
            matched_ranges.push(
                &JsObjectBuilder::new()
                    .set("start", JsValue::from(start as u32))?
                    .set("end", JsValue::from(end as u32))?
                    .build(),
            );
        }

        results_array.push(
            &JsObjectBuilder::new()
                .set("path", JsValue::from_str(hunk.path.as_str()))?
                .set(
                    "previewStartLine",
                    JsValue::from(hunk.preview_start_line as u32),
                )?
                .set(
                    "previewEndLine",
                    JsValue::from(hunk.preview_end_line as u32),
                )?
                .set("matchedLineRanges", matched_ranges.into())?
                .set("excerpt", JsValue::from_str(&hunk.excerpt))?
                .build(),
        );
    }

    Ok(results_array.into())
}

/// Delete a file from the staged index, if it exists.
#[wasm_bindgen]
pub fn delete_index_file(path: String) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;

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
