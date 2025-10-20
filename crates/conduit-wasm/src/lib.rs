//! WASM bindings for Conduit core functionality.

use crate::globals::{create_path_key, get_index_manager};
use conduit_core::{
    fs::FileEntry, CreateRequest, CreateResponse, CreateTool, DeleteRequest, DeleteResponse,
    DeleteTool, MoveFileRequest, MoveFilesTool,
};
use globset::Glob;
use js_sys::{Boolean, Date, Uint8Array};
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

macro_rules! js_err {
    ($msg:expr) => {
        JsValue::from_str($msg)
    };
    ($fmt:expr, $($arg:tt)*) => {
        JsValue::from_str(&format!($fmt, $($arg)*))
    };
}

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

    manager
        .load_files(vec![])
        .map_err(|e| js_err!("Failed to clear index: {}", e))?;
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
    permissions: Vec<Boolean>,
) -> Result<usize, JsValue> {
    let len = paths.len();
    let contents_len = contents.length() as usize;
    if contents_len != len || mtimes.len() != len || permissions.len() != len {
        return Err(js_err!(
            "Array length mismatch: paths={}, contents={}, mtimes={}, permissions={}",
            paths.len(),
            contents_len,
            mtimes.len(),
            permissions.len()
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

        let editable: bool = permissions
            .get(i)
            .and_then(|o| o.as_bool())
            .unwrap_or(false);

        let mtime_secs = (mtimes[i] / 1000.0) as i64;

        let uint8_array = Uint8Array::from(contents.get(i as u32));
        let content_vec = uint8_array.to_vec();

        let content_arc: Arc<[u8]> = content_vec.into();

        let ext = FileEntry::get_extension(path_key.as_str());
        let entry = FileEntry::from_bytes(ext, mtime_secs, content_arc, editable);

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

/// Get summary of all modified files with line change statistics.
/// Returns an array of objects with path, linesAdded, linesRemoved, and status.
#[wasm_bindgen]
pub fn get_modified_files_summary() -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::DiffTool;

    let orchestrator = Orchestrator::new();
    let summaries = orchestrator
        .get_modified_files_summary()
        .map_err(|e| js_err!("Failed to get modified files summary: {}", e))?;

    let result_array = js_sys::Array::new();

    for summary in summaries {
        let mut builder = JsObjectBuilder::new()
            .set("path", JsValue::from_str(summary.path.as_str()))?
            .set("linesAdded", JsValue::from(summary.lines_added as u32))?
            .set("linesRemoved", JsValue::from(summary.lines_removed as u32))?
            .set(
                "status",
                JsValue::from_str(match summary.status {
                    conduit_core::FileChangeStatus::Created => "created",
                    conduit_core::FileChangeStatus::Modified => "modified",
                    conduit_core::FileChangeStatus::Deleted => "deleted",
                    conduit_core::FileChangeStatus::Moved => "moved",
                }),
            )?;

        if let Some(moved_to) = summary.moved_to {
            builder = builder.set("movedTo", JsValue::from_str(moved_to.as_str()))?;
        }

        let obj = builder.build();
        result_array.push(&obj);
    }

    Ok(result_array.into())
}

/// Get detailed diff for a specific file.
/// Returns regions of changes with line numbers and content.
#[wasm_bindgen]
pub fn get_file_diff(path: String) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::DiffTool;

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let orchestrator = Orchestrator::new();
    let diff = orchestrator
        .get_file_diff(&path_key)
        .map_err(|e| js_err!("Failed to get file diff for '{}': {}", path, e))?;

    let regions_array = js_sys::Array::new();

    for region in diff.regions {
        let removed_lines = js_sys::Array::new();
        for line in &region.removed_lines {
            removed_lines.push(&JsValue::from_str(line));
        }

        let added_lines = js_sys::Array::new();
        for line in &region.added_lines {
            added_lines.push(&JsValue::from_str(line));
        }

        let region_obj = JsObjectBuilder::new()
            .set("originalStart", JsValue::from(region.original_start as u32))?
            .set("linesRemoved", JsValue::from(region.lines_removed as u32))?
            .set("modifiedStart", JsValue::from(region.modified_start as u32))?
            .set("linesAdded", JsValue::from(region.lines_added as u32))?
            .set("removedLines", removed_lines.into())?
            .set("addedLines", added_lines.into())?
            .build();

        regions_array.push(&region_obj);
    }

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(diff.path.as_str()))?
        .set(
            "stats",
            JsObjectBuilder::new()
                .set("linesAdded", JsValue::from(diff.stats.lines_added as u32))?
                .set(
                    "linesRemoved",
                    JsValue::from(diff.stats.lines_removed as u32),
                )?
                .set(
                    "regionsChanged",
                    JsValue::from(diff.stats.regions_changed as u32),
                )?
                .build(),
        )?
        .set("regions", regions_array.into())?
        .build();

    Ok(obj)
}

/// Get staged modifications with both active and staged content for diff preview.
#[wasm_bindgen]
pub fn get_staged_modifications_with_active() -> Result<JsValue, JsValue> {
    let manager = get_index_manager();

    let modifications = manager
        .get_staged_modifications()
        .map_err(|e| js_err!("Failed to get staged modifications: {}", e))?;

    let modified_array = js_sys::Array::new();
    let active_index = manager.active_index();

    for (path, staged_content) in modifications {
        let active_content = active_index
            .get_file(&path)
            .and_then(|entry| entry.bytes().map(|b| b.to_vec()));

        let mut file_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set(
                "stagedContent",
                Uint8Array::from(staged_content.as_slice()).into(),
            )?;

        if let Some(content) = active_content {
            file_obj =
                file_obj.set("activeContent", Uint8Array::from(content.as_slice()).into())?;
        }

        modified_array.push(&file_obj.build());
    }

    Ok(modified_array.into())
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
    use conduit_core::{ReadTool, SearchSpace};

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
            .set("editable", JsValue::from_bool(entry.is_editable()))?
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

/// Replace specific lines in a file by line number.
///
/// # Arguments
/// * `path` - The file path to modify
/// * `replacements` - JavaScript array of [lineNumber, newContent] pairs (line numbers are 1-based)
/// * `use_staged` - If true, modify staged index; otherwise modify active index
///
/// # Returns
/// Object containing path, lines_replaced, and total_lines
#[wasm_bindgen]
pub fn replace_lines(
    path: String,
    replacements: js_sys::Array,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::{ReplaceLinesRequest, ReplaceLinesTool};

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    // Convert JavaScript array to Vec<(usize, usize, String)>
    let mut line_replacements = Vec::new();
    for i in 0..replacements.length() {
        let pair = replacements.get(i);
        if let Some(array) = pair.dyn_ref::<js_sys::Array>() {
            if array.length() == 2 {
                // Old format: [lineNumber, content] - treat as single line replacement
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

                // Convert to range format (single line)
                line_replacements.push((line_num as usize, line_num as usize, content));
            } else if array.length() == 3 {
                // New format: [startLine, endLine, content]
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

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response.path.as_str()))?
        .set(
            "linesReplaced",
            JsValue::from(response.lines_replaced as u32),
        )?
        .set("linesAdded", JsValue::from(response.lines_added as i32))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .set(
            "originalLines",
            JsValue::from(response.original_lines as u32),
        )?
        .build();

    Ok(obj)
}

/// Delete specific lines from a file.
///
/// # Arguments
/// * `path` - The file path to modify
/// * `line_numbers` - Array of line numbers to delete (1-based)
/// * `use_staged` - If true, modify staged index; otherwise modify active index
#[wasm_bindgen]
pub fn delete_lines(
    path: String,
    line_numbers: Vec<usize>,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::{DeleteLinesRequest, DeleteLinesTool};

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = DeleteLinesRequest {
        path: path_key,
        line_numbers,
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_delete_lines(request)
        .map_err(|e| js_err!("Failed to delete lines from '{}': {}", path, e))?;

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response.path.as_str()))?
        .set(
            "linesReplaced",
            JsValue::from(response.lines_replaced as u32),
        )?
        .set("linesAdded", JsValue::from(response.lines_added as i32))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .set(
            "originalLines",
            JsValue::from(response.original_lines as u32),
        )?
        .build();

    Ok(obj)
}

/// Insert new content before a specific line.
///
/// # Arguments
/// * `path` - The file path to modify
/// * `line_number` - Line number where to insert (1-based)
/// * `content` - Content to insert (can be multi-line)
/// * `use_staged` - If true, modify staged index; otherwise modify active index
#[wasm_bindgen]
pub fn insert_before_line(
    path: String,
    line_number: usize,
    content: String,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::{InsertLinesRequest, InsertLinesTool, InsertPosition};

    if line_number < 1 {
        return Err(js_err!("Line number must be 1-based"));
    }

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = InsertLinesRequest {
        path: path_key,
        line_number,
        content,
        position: InsertPosition::Before,
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

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response.path.as_str()))?
        .set(
            "linesReplaced",
            JsValue::from(response.lines_replaced as u32),
        )?
        .set("linesAdded", JsValue::from(response.lines_added as i32))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .set(
            "originalLines",
            JsValue::from(response.original_lines as u32),
        )?
        .build();

    Ok(obj)
}

/// Insert new content after a specific line.
///
/// # Arguments
/// * `path` - The file path to modify  
/// * `line_number` - Line number after which to insert (1-based)
/// * `content` - Content to insert (can be multi-line)
/// * `use_staged` - If true, modify staged index; otherwise modify active index
#[wasm_bindgen]
pub fn insert_after_line(
    path: String,
    line_number: usize,
    content: String,
    _use_staged: bool,
) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;
    use conduit_core::{InsertLinesRequest, InsertLinesTool, InsertPosition};

    if line_number < 1 {
        return Err(js_err!("Line number must be 1-based"));
    }

    let path_key = create_path_key(&path).map_err(|e| js_err!("Invalid path '{}': {}", path, e))?;

    let request = InsertLinesRequest {
        path: path_key,
        line_number,
        content,
        position: InsertPosition::After,
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

    let obj = JsObjectBuilder::new()
        .set("path", JsValue::from_str(response.path.as_str()))?
        .set(
            "linesReplaced",
            JsValue::from(response.lines_replaced as u32),
        )?
        .set("linesAdded", JsValue::from(response.lines_added as i32))?
        .set("totalLines", JsValue::from(response.total_lines as u32))?
        .set(
            "originalLines",
            JsValue::from(response.original_lines as u32),
        )?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn copy_file(src: String, dst: String) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;

    let src_key =
        create_path_key(&src).map_err(|e| js_err!("Invalid source path '{}': {}", src, e))?;
    let dst_key =
        create_path_key(&dst).map_err(|e| js_err!("Invalid destination path '{}': {}", dst, e))?;

    let request = MoveFileRequest {
        src: src_key,
        dst: dst_key.clone(),
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_copy_file(request)
        .map_err(|e| js_err!("Failed to copy file: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("dst", JsValue::from(response.dst.as_str()))?
        .build();

    Ok(obj)
}

#[wasm_bindgen]
pub fn move_file(src: String, dst: String) -> Result<JsValue, JsValue> {
    use crate::orchestrator::Orchestrator;

    let src_key =
        create_path_key(&src).map_err(|e| js_err!("Invalid source path '{}': {}", src, e))?;
    let dst_key =
        create_path_key(&dst).map_err(|e| js_err!("Invalid destination path '{}': {}", dst, e))?;

    let request = MoveFileRequest {
        src: src_key,
        dst: dst_key.clone(),
    };

    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_move_file(request)
        .map_err(|e| js_err!("Failed to move file: {}", e))?;

    let obj = JsObjectBuilder::new()
        .set("dst", JsValue::from(response.dst.as_str()))?
        .build();

    Ok(obj)
}
