pub mod error;
pub mod fs;
pub mod tools;

pub use error::{Error, Result};
pub use fs::prelude::*;
pub use tools::{
    apply_line_operations, compute_diff, compute_diffs, search_regions, AbortFlag, ByteSpan,
    DiffRegion, DiffStats, FileDiff, LineIndex, LineOperation, LineSpan, Match, MatchRegion,
    PreviewBuilder, PreviewHunk, ReadRequest, ReadResponse, RegexEngineOpts, RegexMatcher,
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

/// Request to create a file in the staged index.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateRequest {
    /// Path where the file should be created
    pub path: PathKey,
    /// File content (None creates an empty file)
    pub content: Option<Vec<u8>>,
    /// Whether to overwrite if file already exists
    pub allow_overwrite: bool,
}

impl CreateRequest {
    /// Create a new request for an empty file.
    pub fn empty(path: PathKey) -> Self {
        Self {
            path,
            content: None,
            allow_overwrite: false,
        }
    }

    /// Create a new request with content.
    pub fn with_content(path: PathKey, content: Vec<u8>) -> Self {
        Self {
            path,
            content: Some(content),
            allow_overwrite: false,
        }
    }

    /// Enable overwriting existing files.
    pub fn allow_overwrite(mut self) -> Self {
        self.allow_overwrite = true;
        self
    }

    /// Validate the request parameters.
    pub fn validate(&self) -> Result<()> {
        // PathKey construction already validates non-empty paths
        Ok(())
    }
}

/// Response after creating a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateResponse {
    /// Path of the created file
    pub path: PathKey,
    /// Size of the created file in bytes
    pub size: u64,
    /// Whether the file was newly created (false if overwritten)
    pub created: bool,
}

/// Request to delete a file from the staged index.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeleteRequest {
    /// Path of the file to delete
    pub path: PathKey,
}

impl DeleteRequest {
    /// Create a new delete request.
    pub fn new(path: PathKey) -> Self {
        Self { path }
    }

    /// Validate the request parameters.
    pub fn validate(&self) -> Result<()> {
        // PathKey construction already validates non-empty paths
        Ok(())
    }
}

/// Response after deleting a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeleteResponse {
    /// Path of the deleted file
    pub path: PathKey,
    /// Whether the file existed before deletion
    pub existed: bool,
}

/// Request to replace specific lines in a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplaceLinesRequest {
    /// Path of the file to modify
    pub path: PathKey,
    /// List of (start_line, end_line, new_content) replacements
    /// Lines are 1-based and inclusive
    pub replacements: Vec<(usize, usize, String)>,
    /// Which buffer to target (typically Staged)
    pub where_: SearchSpace,
}

/// Response after replacing lines in a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReplaceLinesResponse {
    /// Path of the modified file
    pub path: PathKey,
    /// Number of lines replaced
    pub lines_replaced: usize,
    /// Number of lines added (when replacement has more lines than original)
    pub lines_added: isize,
    /// Total lines in the file after replacement
    pub total_lines: usize,
    /// Original line count before replacement
    pub original_lines: usize,
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
    ) -> Result<ReadResponse>;
}

/// Create files in the staged index.
pub trait CreateTool {
    fn run_create(&mut self, req: CreateRequest) -> Result<CreateResponse>;
}

/// Delete files from the staged index.
pub trait DeleteTool {
    fn run_delete(&mut self, req: DeleteRequest) -> Result<DeleteResponse>;
}

/// Replace specific lines in files.
pub trait ReplaceLinesTool {
    fn run_replace_lines(&mut self, req: ReplaceLinesRequest) -> Result<ReplaceLinesResponse>;
}

/// Delete specific lines from files.
pub trait DeleteLinesTool {
    fn run_delete_lines(&mut self, req: DeleteLinesRequest) -> Result<ReplaceLinesResponse>;
}

/// Insert lines into files.
pub trait InsertLinesTool {
    fn run_insert_lines(&mut self, req: InsertLinesRequest) -> Result<ReplaceLinesResponse>;
}

/// Compute diffs between active and staged versions of files.
pub trait DiffTool {
    /// Get summary of all modified files with line change statistics
    fn get_modified_files_summary(&self) -> Result<Vec<ModifiedFileSummary>>;

    /// Get detailed diff for a specific file
    fn get_file_diff(&self, path: &PathKey) -> Result<FileDiff>;
}

/// Summary of changes for a modified file
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModifiedFileSummary {
    /// Path of the file
    pub path: PathKey,
    /// Number of lines added
    pub lines_added: usize,
    /// Number of lines removed
    pub lines_removed: usize,
    /// File status (created, modified, deleted)
    pub status: FileChangeStatus,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeStatus {
    Created,
    Modified,
    Deleted,
}

/// Request to delete specific lines from a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeleteLinesRequest {
    /// Path of the file to modify
    pub path: PathKey,
    /// Line numbers to delete (1-based)
    pub line_numbers: Vec<usize>,
    /// Which buffer to target
    pub where_: SearchSpace,
}

/// Request to insert lines into a file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InsertLinesRequest {
    /// Path of the file to modify
    pub path: PathKey,
    /// Line number where to insert (1-based)
    pub line_number: usize,
    /// Content to insert
    pub content: String,
    /// Insert before or after the line
    pub position: InsertPosition,
    /// Which buffer to target
    pub where_: SearchSpace,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum InsertPosition {
    Before,
    After,
}

pub mod prelude {
    //! Common imports for consumers of this crate.
    pub use super::{
        AbortFlag, CreateRequest, CreateResponse, CreateTool, DeleteLinesRequest, DeleteLinesTool,
        DeleteRequest, DeleteResponse, DeleteTool, DiffTool, EditItem, EditRequest, EditResponse,
        EditTool, Error, FileChangeStatus, FileDiff, FindRequest, FindResponse, FindTool, Index,
        IndexManager, InsertLinesRequest, InsertLinesTool, InsertPosition, Match,
        ModifiedFileSummary, PathKey, PreviewBuilder, PreviewHunk, ReadRequest, ReadResponse,
        ReadTool, RegexEngineOpts, ReplaceLinesRequest, ReplaceLinesResponse, ReplaceLinesTool,
        Result, SearchSpace,
    };
}
