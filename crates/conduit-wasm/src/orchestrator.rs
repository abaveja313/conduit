//! Orchestrator for search and edit operations.

use crate::{current_unix_timestamp, globals::get_index_manager};
use conduit_core::fs::FileEntry;
use conduit_core::prelude::*;
use conduit_core::tools::{
    apply_line_operations, compute_diff, extract_lines, for_each_match, LineIndex, LineOperation,
    PreviewBuilder,
};
use conduit_core::RegexMatcher;
use globset::{Glob, GlobSet, GlobSetBuilder};

pub struct Orchestrator {
    index_manager: &'static IndexManager,
}

impl Orchestrator {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            index_manager: get_index_manager(),
        }
    }

    /// Helper to track line statistics after modifications
    fn track_line_stats(&self, path: &PathKey, delta: isize, current_lines: usize) -> Result<()> {
        let lines_added = delta.max(0);
        let lines_removed = (-delta).max(0);
        self.index_manager
            .update_line_stats(path, lines_added, lines_removed, current_lines)
    }

    pub fn handle_find(&self, req: FindRequest, abort: &AbortFlag) -> Result<FindResponse> {
        abort.reset();

        let index = match req.where_ {
            SearchSpace::Active => self.index_manager.active_index(),
            SearchSpace::Staged => self.index_manager.staged_index()?,
        };

        let matcher = RegexMatcher::compile(&req.find, &req.engine_opts)?;
        let include_globs = compile_globs(req.include_globs.as_deref())?;
        let exclude_globs = compile_globs(req.exclude_globs.as_deref())?;

        let mut results = Vec::new();
        let preview_builder = PreviewBuilder::new(req.delta);

        for (path, entry) in index.iter_sorted() {
            if abort.is_aborted() {
                break;
            }

            if let Some(prefix) = &req.prefix {
                if !path.as_str().starts_with(prefix) {
                    continue;
                }
            }

            if let Some(ref globs) = include_globs {
                if !globs.is_match(path.as_str()) {
                    continue;
                }
            }
            if let Some(ref globs) = exclude_globs {
                if globs.is_match(path.as_str()) {
                    continue;
                }
            }

            let content = match entry.bytes() {
                Some(bytes) => bytes,
                None => continue,
            };

            let line_index = LineIndex::build(content);

            for_each_match(content, &matcher, |span, line_start| {
                let line_end = line_index.line_of_byte(span.end).unwrap_or(line_start);

                match preview_builder.build_hunk(
                    path.clone(),
                    &line_index,
                    content,
                    line_start,
                    line_end,
                ) {
                    Ok(hunk) => {
                        results.push(hunk);
                        Ok(true)
                    }
                    Err(e) => {
                        eprintln!("Preview build error: {e}");
                        Ok(true)
                    }
                }
            })?;
        }

        Ok(FindResponse { results })
    }

    pub fn handle_edit(&self, req: EditRequest, abort: &AbortFlag) -> Result<EditResponse> {
        abort.reset();

        if req.where_ != SearchSpace::Staged {
            return Err(Error::InvalidPath(
                "Edit operations must target staged index".to_string(),
            ));
        }

        Ok(EditResponse { items: Vec::new() })
    }

    pub fn handle_read(
        &self,
        path: &PathKey,
        start_line: usize,
        end_line: usize,
        where_: SearchSpace,
    ) -> Result<ReadResponse> {
        let index = match where_ {
            SearchSpace::Active => self.index_manager.active_index(),
            SearchSpace::Staged => self.index_manager.staged_index()?,
        };

        let entry = index
            .get_file(path)
            .ok_or_else(|| Error::InvalidPath(format!("File not found: {}", path.as_str())))?;

        let content = entry.bytes().ok_or_else(|| {
            Error::MissingContent(format!("File has no content: {}", path.as_str()))
        })?;
        extract_lines(path.clone(), content, start_line, end_line)
    }

    pub fn handle_create(&self, req: CreateRequest) -> Result<CreateResponse> {
        let staged = self.index_manager.staged_index()?;
        let exists = staged.get_file(&req.path).is_some();

        if exists && !req.allow_overwrite {
            return Err(Error::FileAlreadyExists(req.path.as_str().to_string()));
        }

        let current_time = current_unix_timestamp();

        let entry = match req.content {
            Some(bytes) => FileEntry::from_bytes_and_path(&req.path, current_time, bytes.into()),
            None => FileEntry::new_from_path(&req.path, 0, current_time),
        };

        let size = entry.size();

        // Count lines in the new content
        let line_count = if let Some(bytes) = entry.bytes() {
            String::from_utf8_lossy(bytes).lines().count()
        } else {
            0
        };

        self.index_manager.stage_file(req.path.clone(), entry)?;

        // Track line stats for created or overwritten files
        if !exists {
            // New file - all lines are added
            self.track_line_stats(&req.path, line_count as isize, line_count)?;
        } else {
            // Overwriting existing file - need to calculate the delta
            if let Ok(active_content) = self.get_file_content(&req.path, SearchSpace::Active) {
                let original_lines = active_content.lines().count();
                let delta = (line_count as isize) - (original_lines as isize);
                self.track_line_stats(&req.path, delta, line_count)?;
            }
        }

        Ok(CreateResponse {
            path: req.path,
            size,
            created: !exists,
        })
    }

    pub fn handle_delete(&self, req: DeleteRequest) -> Result<DeleteResponse> {
        let staged = self.index_manager.staged_index()?;
        let existed = staged.get_file(&req.path).is_some();

        if existed {
            self.index_manager.remove_staged_file(&req.path)?;
        }

        Ok(DeleteResponse {
            path: req.path,
            existed,
        })
    }

    fn get_file_content(&self, path: &PathKey, where_: SearchSpace) -> Result<String> {
        let index = match where_ {
            SearchSpace::Staged => self.index_manager.staged_index()?,
            SearchSpace::Active => self.index_manager.active_index(),
        };

        let entry = index
            .get_file(path)
            .ok_or_else(|| Error::InvalidPath(format!("File not found: {}", path.as_str())))?;

        let content = entry.bytes().ok_or_else(|| {
            Error::MissingContent(format!("File has no content: {}", path.as_str()))
        })?;

        Ok(String::from_utf8_lossy(content).to_string())
    }

    fn stage_file_with_content(&self, path: &PathKey, content: String) -> Result<()> {
        let current_time = current_unix_timestamp();
        let modified_bytes = content.into_bytes();
        let modified_entry =
            FileEntry::from_bytes_and_path(path, current_time, modified_bytes.into());
        self.index_manager.stage_file(path.clone(), modified_entry)
    }

    pub fn handle_replace_lines(&self, req: ReplaceLinesRequest) -> Result<ReplaceLinesResponse> {
        if req.where_ != SearchSpace::Staged {
            return Err(Error::InvalidPath(
                "Replace lines operations must target staged index".to_string(),
            ));
        }

        let content = self.get_file_content(&req.path, req.where_)?;
        let original_lines = content.lines().count();

        let operations: Vec<(usize, LineOperation)> = req
            .replacements
            .into_iter()
            .map(|(line_num, content)| (line_num, LineOperation::Replace(content)))
            .collect();

        let (modified_content, lines_replaced, total_delta) =
            apply_line_operations(&content, operations);
        let total_lines = modified_content.lines().count();

        self.stage_file_with_content(&req.path, modified_content)?;
        self.track_line_stats(&req.path, total_delta, total_lines)?;

        Ok(ReplaceLinesResponse {
            path: req.path,
            lines_replaced,
            lines_added: total_delta,
            total_lines,
            original_lines,
        })
    }

    pub fn handle_delete_lines(&self, req: DeleteLinesRequest) -> Result<ReplaceLinesResponse> {
        if req.where_ != SearchSpace::Staged {
            return Err(Error::InvalidPath(
                "Delete lines operations must target staged index".to_string(),
            ));
        }

        let content = self.get_file_content(&req.path, req.where_)?;
        let original_lines = content.lines().count();

        let operations: Vec<(usize, LineOperation)> = req
            .line_numbers
            .into_iter()
            .map(|line_num| (line_num, LineOperation::Delete))
            .collect();

        let (modified_content, lines_replaced, total_delta) =
            apply_line_operations(&content, operations);
        let total_lines = modified_content.lines().count();

        self.stage_file_with_content(&req.path, modified_content)?;
        self.track_line_stats(&req.path, total_delta, total_lines)?;

        Ok(ReplaceLinesResponse {
            path: req.path,
            lines_replaced,
            lines_added: total_delta,
            total_lines,
            original_lines,
        })
    }

    pub fn handle_insert_lines(&self, req: InsertLinesRequest) -> Result<ReplaceLinesResponse> {
        if req.where_ != SearchSpace::Staged {
            return Err(Error::InvalidPath(
                "Insert lines operations must target staged index".to_string(),
            ));
        }

        let content = self.get_file_content(&req.path, req.where_)?;
        let original_lines = content.lines().count();

        let operation = match req.position {
            InsertPosition::Before => LineOperation::InsertBefore(req.content),
            InsertPosition::After => LineOperation::InsertAfter(req.content),
        };

        let operations = vec![(req.line_number, operation)];
        let (modified_content, lines_replaced, total_delta) =
            apply_line_operations(&content, operations);
        let total_lines = modified_content.lines().count();

        self.stage_file_with_content(&req.path, modified_content)?;
        self.track_line_stats(&req.path, total_delta, total_lines)?;

        Ok(ReplaceLinesResponse {
            path: req.path,
            lines_replaced,
            lines_added: total_delta,
            total_lines,
            original_lines,
        })
    }
}

impl FindTool for Orchestrator {
    fn run_find(&mut self, req: FindRequest, abort: &AbortFlag) -> Result<FindResponse> {
        self.handle_find(req, abort)
    }
}

impl EditTool for Orchestrator {
    fn run_edit(&mut self, req: EditRequest, abort: &AbortFlag) -> Result<EditResponse> {
        self.handle_edit(req, abort)
    }
}

impl ReadTool for Orchestrator {
    fn run_read(
        &mut self,
        path: &PathKey,
        start_line: usize,
        end_line: usize,
        where_: SearchSpace,
    ) -> Result<ReadResponse> {
        self.handle_read(path, start_line, end_line, where_)
    }
}

impl CreateTool for Orchestrator {
    fn run_create(&mut self, req: CreateRequest) -> Result<CreateResponse> {
        self.handle_create(req)
    }
}

impl DeleteTool for Orchestrator {
    fn run_delete(&mut self, req: DeleteRequest) -> Result<DeleteResponse> {
        self.handle_delete(req)
    }
}

impl ReplaceLinesTool for Orchestrator {
    fn run_replace_lines(&mut self, req: ReplaceLinesRequest) -> Result<ReplaceLinesResponse> {
        self.handle_replace_lines(req)
    }
}

impl DeleteLinesTool for Orchestrator {
    fn run_delete_lines(&mut self, req: DeleteLinesRequest) -> Result<ReplaceLinesResponse> {
        self.handle_delete_lines(req)
    }
}

impl InsertLinesTool for Orchestrator {
    fn run_insert_lines(&mut self, req: InsertLinesRequest) -> Result<ReplaceLinesResponse> {
        self.handle_insert_lines(req)
    }
}

impl DiffTool for Orchestrator {
    fn get_modified_files_summary(&self) -> Result<Vec<ModifiedFileSummary>> {
        let active_index = self.index_manager.active_index();
        let change_stats = self.index_manager.get_change_stats()?;
        let deletions = self.index_manager.get_staged_deletions()?;

        let mut summaries = Vec::new();

        // Process files with change stats (modified or created files)
        for (path, stats) in change_stats {
            let status = if active_index.get_file(&path).is_none() {
                FileChangeStatus::Created
            } else {
                FileChangeStatus::Modified
            };

            summaries.push(ModifiedFileSummary {
                path,
                lines_added: stats.lines_added.max(0) as usize,
                lines_removed: stats.lines_removed.unsigned_abs(),
                status,
            });
        }

        // Process deletions
        for path in deletions {
            // Get line count from active index using cached LineIndex
            let lines_removed = self
                .index_manager
                .get_line_index(&path, &active_index)
                .map(|idx| idx.line_count())
                .unwrap_or(0);

            summaries.push(ModifiedFileSummary {
                path,
                lines_added: 0,
                lines_removed,
                status: FileChangeStatus::Deleted,
            });
        }

        Ok(summaries)
    }

    fn get_file_diff(&self, path: &PathKey) -> Result<FileDiff> {
        let active_index = self.index_manager.active_index();
        let staged_index = self.index_manager.staged_index()?;

        // Get content, treating missing files as empty
        let active_content = match active_index.get_file(path) {
            Some(entry) => match entry.bytes() {
                Some(bytes) => std::str::from_utf8(bytes)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|_| String::from_utf8_lossy(bytes).to_string()),
                None => String::new(),
            },
            None => String::new(),
        };

        let staged_content = match staged_index.get_file(path) {
            Some(entry) => match entry.bytes() {
                Some(bytes) => std::str::from_utf8(bytes)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|_| String::from_utf8_lossy(bytes).to_string()),
                None => String::new(),
            },
            None => String::new(),
        };

        Ok(compute_diff(path.clone(), &active_content, &staged_content))
    }
}

fn compile_globs(patterns: Option<&[String]>) -> Result<Option<GlobSet>> {
    patterns
        .filter(|p| !p.is_empty())
        .map(|patterns| {
            let mut builder = GlobSetBuilder::new();
            for pattern in patterns {
                builder.add(Glob::new(pattern)?);
            }
            builder.build().map_err(Into::into)
        })
        .transpose()
}
