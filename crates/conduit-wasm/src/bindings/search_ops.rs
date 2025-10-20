use crate::js_err;
use crate::orchestrator::Orchestrator;
use crate::utils::JsObjectBuilder;
use conduit_core::{AbortFlag, FindRequest, FindTool, RegexEngineOpts, SearchSpace};
use globset::Glob;
use js_sys::Array;
use wasm_bindgen::prelude::*;

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn search_files(
    search_term: String,
    path_prefix: Option<String>,
    include_pattern: Option<String>,
    exclude_pattern: Option<String>,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
    use_staged: Option<bool>,
    context_lines: Option<usize>,
    limit: Option<usize>,
) -> Result<JsValue, JsValue> {
    let staged = use_staged.unwrap_or(true);
    let case_sensitive = case_sensitive.unwrap_or(false);
    let whole_word = whole_word.unwrap_or(false);
    let context_lines = context_lines.unwrap_or(2);

    let include_globs = include_pattern
        .as_ref()
        .map(|pattern| vec![pattern.clone()]);
    let exclude_globs = exclude_pattern
        .as_ref()
        .map(|pattern| vec![pattern.clone()]);

    let find_request = FindRequest {
        find: search_term.clone(),
        where_: if staged {
            SearchSpace::Staged
        } else {
            SearchSpace::Active
        },
        prefix: path_prefix,
        include_globs,
        exclude_globs,
        engine_opts: RegexEngineOpts {
            case_insensitive: !case_sensitive,
            multiline: true,
            dot_all: false,
            crlf: true,
            word: whole_word,
            unicode: true,
        },
        delta: context_lines,
    };

    let abort_flag = AbortFlag::new();
    let mut orchestrator = Orchestrator::new();
    let response = orchestrator
        .run_find(find_request, &abort_flag)
        .map_err(|e| js_err!("Search failed: {}", e))?;

    let results_array = Array::new();
    for (idx, hunk) in response.results.into_iter().enumerate() {
        if let Some(limit) = limit {
            if idx >= limit {
                break;
            }
        }

        let lines_array = Array::new();
        for (line_idx, line_content) in hunk.excerpt.lines().enumerate() {
            let line_num = hunk.preview_start_line + line_idx;
            let is_match = hunk
                .matched_line_ranges
                .iter()
                .any(|(start, end)| line_num >= *start && line_num <= *end);

            let line_obj = JsObjectBuilder::new()
                .set("lineNumber", JsValue::from(line_num as u32))?
                .set("content", JsValue::from_str(line_content))?
                .set("isMatch", JsValue::from_bool(is_match))?
                .build();
            lines_array.push(&line_obj);
        }

        let hunk_obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(hunk.path.as_str()))?
            .set("lines", lines_array.into())?
            .build();
        results_array.push(&hunk_obj);
    }

    Ok(results_array.into())
}

#[wasm_bindgen]
pub fn list_files_from_wasm(
    path_prefix: Option<String>,
    glob_pattern: Option<String>,
    use_staged: Option<bool>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<JsValue, JsValue> {
    let staged = use_staged.unwrap_or(true);
    let limit = limit.unwrap_or(100).min(100);
    let offset = offset.unwrap_or(0);

    let index = if staged {
        match get_index_manager().staged_index() {
            Ok(idx) => idx,
            Err(e) => return Err(js_err!("Failed to access staged index: {}", e)),
        }
    } else {
        get_index_manager().active_index()
    };

    let files: Vec<_> = if let Some(pattern) = glob_pattern {
        match pattern.as_str() {
            "" | "*" | "**/*" => index.iter_sorted().collect(),
            _ => {
                let glob =
                    Glob::new(&pattern).map_err(|e| js_err!("Invalid glob pattern: {}", e))?;
                let matcher = glob.compile_matcher();
                index
                    .iter_sorted()
                    .filter(|(path, _)| matcher.is_match(path.as_str()))
                    .collect()
            }
        }
    } else {
        index.iter_sorted().collect()
    };

    let filtered_files: Vec<_> = if let Some(prefix) = path_prefix {
        files
            .into_iter()
            .filter(|(path, _)| path.as_str().starts_with(&prefix))
            .collect()
    } else {
        files
    };

    let total_count = filtered_files.len();
    let end = (offset + limit).min(total_count);

    let results_array = Array::new();
    for (path, entry) in filtered_files.into_iter().skip(offset).take(end - offset) {
        let obj = JsObjectBuilder::new()
            .set("path", JsValue::from_str(path.as_str()))?
            .set("size", JsValue::from_f64(entry.size() as f64))?
            .set("mtime", JsValue::from_f64(entry.mtime() as f64 * 1000.0))?
            .set("editable", JsValue::from_bool(entry.is_editable()))?
            .build();
        results_array.push(&obj);
    }

    let response_obj = JsObjectBuilder::new()
        .set("files", results_array.into())?
        .set("total", JsValue::from(total_count as u32))?
        .set("hasMore", JsValue::from_bool(end < total_count))?
        .build();

    Ok(response_obj)
}

use crate::globals::get_index_manager;
