pub mod error;
pub mod fs;
pub mod tools;
pub mod ast;

pub use error::{Error, Result};
pub use fs::prelude::*;
pub use tools::{
    search_regions, AbortFlag, ByteSpan, LineIndex, LineSpan, Match, MatchRegion, PreviewBuilder,
    PreviewHunk, RegexEngineOpts, RegexMatcher,
};

/// Selects which buffer set to operate on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum SearchSpace {
    /// The primary/committed buffer.
    Active,
    /// The working/uncommitted buffer.
    Staged,
}

/// Parameters for searching files.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FindRequest {
    /// Glob patterns to include (if any).
    pub include_globs: Option<Vec<String>>,
    /// Glob patterns to exclude.
    pub exclude_globs: Option<Vec<String>>,
    /// Path prefix filter.
    pub prefix: Option<String>,
    /// Regex pattern to search for.
    pub find: String,
    /// Number of context lines around matches.
    pub delta: usize,
    /// Regex compilation options.
    pub engine_opts: RegexEngineOpts,
    /// Which buffer set to search.
    pub where_: SearchSpace,
}

impl Default for FindRequest {
    fn default() -> Self {
        Self {
            include_globs: None,
            exclude_globs: None,
            prefix: None,
            find: String::new(),
            delta: 2,
            engine_opts: RegexEngineOpts::default(),
            where_: SearchSpace::Active,
        }
    }
}

/// Search results as preview excerpts.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FindResponse {
    pub results: Vec<PreviewHunk>,
}

/// Parameters for find-and-replace operations.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EditRequest {
    /// Glob patterns to include (if any).
    pub include_globs: Option<Vec<String>>,
    /// Glob patterns to exclude.
    pub exclude_globs: Option<Vec<String>>,
    /// Path prefix filter.
    pub prefix: Option<String>,
    /// Regex pattern to search for.
    pub find: String,
    /// Replacement template supporting `$1`, `${name}`, `$$`.
    pub replace: String,
    /// Number of context lines in previews.
    pub delta: usize,
    /// Regex compilation options.
    pub engine_opts: RegexEngineOpts,
    /// Target buffer (typically Staged).
    pub where_: SearchSpace,
}

impl Default for EditRequest {
    fn default() -> Self {
        Self {
            include_globs: None,
            exclude_globs: None,
            prefix: None,
            find: String::new(),
            replace: String::new(),
            delta: 2,
            engine_opts: RegexEngineOpts::default(),
            where_: SearchSpace::Staged,
        }
    }
}

/// Summary of edits applied to a single file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EditItem {
    pub path: PathKey,
    /// Preview from the original buffer.
    pub original_preview: PreviewHunk,
    /// Preview after applying replacements.
    pub staged_preview: PreviewHunk,
    /// Line range of the match in original (inclusive, 1-based).
    pub original_range: (usize, usize),
    /// Line range after replacement (may shift due to added/removed lines).
    pub staged_range: (usize, usize),
}

/// Edit operation results.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EditResponse {
    pub items: Vec<EditItem>,
}

/// Search files and return preview excerpts.
pub trait FindTool {
    fn run_find(&mut self, req: FindRequest, abort: &AbortFlag) -> Result<FindResponse>;
}

/// Apply replacements and return before/after previews.
pub trait EditTool {
    fn run_edit(&mut self, req: EditRequest, abort: &AbortFlag) -> Result<EditResponse>;
}

/// Extract exact line ranges from files.
pub trait ReadTool {
    fn run_read(
        &mut self,
        path: &PathKey,
        start_line: usize,
        end_line: usize,
        where_: SearchSpace,
    ) -> Result<PreviewHunk>;
}

pub mod prelude {
    //! Common imports for consumers of this crate.
    pub use super::{
        AbortFlag, EditItem, EditRequest, EditResponse, EditTool, Error, FindRequest, FindResponse,
        FindTool, Index, IndexManager, Match, PathKey, PreviewBuilder, PreviewHunk, ReadTool,
        RegexEngineOpts, Result, SearchSpace,
    };
}
