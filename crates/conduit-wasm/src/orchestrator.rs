//! Orchestrator for search and edit operations.

use crate::{current_unix_timestamp, globals::get_index_manager};
use conduit_core::fs::FileEntry;
use conduit_core::prelude::*;
use conduit_core::tools::{
    apply_line_operations, compute_diff, extract_lines, for_each_match, LineIndex, LineOperation,
    PreviewBuilder,
};
use conduit_core::{MoveFilesTool, RegexMatcher};
use globset::{Glob, GlobSet, GlobSetBuilder};

pub struct Orchestrator {
    index_manager: &'static IndexManager,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self {
            index_manager: get_index_manager(),
        }
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

            let content = match entry.search_content() {
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
                    &span,
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

    pub fn handle_edit(&self, _req: EditRequest, abort: &AbortFlag) -> Result<EditResponse> {
        abort.reset();
        // not implemented
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
            .ok_or_else(|| Error::FileNotFound(path.as_str().to_string()))?;

        let content = entry.search_content().ok_or_else(|| {
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
            Some(bytes) => {
                FileEntry::from_bytes_and_path(&req.path, current_time, bytes.into(), true)
            }
            None => FileEntry::new_from_path(&req.path, 0, current_time, true),
        };

        let size = entry.size();

        let line_count = if let Some(bytes) = entry.search_content() {
            bytes.iter().filter(|&&b| b == b'\n').count() + 1
        } else {
            0
        };

        self.index_manager.stage_file(req.path.clone(), entry)?;

        if !exists {
            // New file - all lines are added
            self.index_manager
                .update_line_stats(&req.path, line_count as isize, 0, line_count)?;
        } else {
            // Overwriting existing file - need to calculate the delta
            if let Ok(active_content) = self.get_file_content(&req.path, SearchSpace::Active) {
                let original_lines = active_content.lines().count();
                self.index_manager.update_line_stats(
                    &req.path,
                    line_count as isize,
                    original_lines as isize,
                    line_count,
                )?;
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

    fn copy_single_file(&self, src: &PathKey, dst: &PathKey) -> Result<()> {
        let staged = self.index_manager.staged_index()?;
        let src_entry = staged
            .get_file(src)
            .ok_or_else(|| Error::FileNotFound(src.as_str().to_string()))?;

        let original_bytes = src_entry.bytes().ok_or_else(|| {
            Error::MissingContent(format!("No original bytes for: {}", src.as_str()))
        })?;

        let line_count = original_bytes.iter().filter(|&&b| b == b'\n').count() + 1;
        let src_content = String::from_utf8_lossy(original_bytes).to_string();

        self.stage_file_with_content(dst, src_content)?;

        if let Ok(active_content) = self.get_file_content(dst, SearchSpace::Active) {
            let original_lines = active_content.lines().count();
            self.index_manager.update_line_stats(
                dst,
                line_count as isize,
                original_lines as isize,
                line_count,
            )?;
        } else {
            self.index_manager
                .update_line_stats(dst, line_count as isize, 0, line_count)?;
        }

        Ok(())
    }

    pub fn handle_copy_files(&self, req: BatchCopyRequest) -> Result<BatchOperationResponse> {
        let count = req.operations.len();
        self.index_manager.with_snapshot(|| {
            for operation in &req.operations {
                self.copy_single_file(&operation.src, &operation.dst)?;
            }
            Ok(BatchOperationResponse { count })
        })
    }

    pub fn handle_move_files(&self, req: BatchMoveRequest) -> Result<BatchOperationResponse> {
        let count = req.operations.len();
        self.index_manager.with_snapshot(|| {
            for operation in &req.operations {
                self.index_manager.move_staged_file(
                    &operation.src,
                    &operation.dst,
                    current_unix_timestamp(),
                )?;
            }
            Ok(BatchOperationResponse { count })
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

        let content = entry.search_content().ok_or_else(|| {
            Error::MissingContent(format!("File has no content: {}", path.as_str()))
        })?;

        Ok(String::from_utf8_lossy(content).into_owned())
    }

    fn stage_file_with_content(&self, path: &PathKey, content: String) -> Result<()> {
        // Get the existing file's editable status from staged index
        let editable = self
            .index_manager
            .staged_index()?
            .get_file(path)
            .map(|entry| entry.is_editable())
            .unwrap_or(true); // Default to editable if file doesn't exist yet

        let current_time = current_unix_timestamp();
        let modified_bytes = content.into_bytes();
        let modified_entry =
            FileEntry::from_bytes_and_path(path, current_time, modified_bytes.into(), editable);
        self.index_manager.stage_file(path.clone(), modified_entry)
    }

    pub fn handle_replace_lines(&self, req: ReplaceLinesRequest) -> Result<ReplaceLinesResponse> {
        self.index_manager.with_snapshot(|| {
            let content = self.get_file_content(&req.path, SearchSpace::Staged)?;
            let original_lines = content.lines().count();

            let operations: Vec<LineOperation> = req
                .replacements
                .into_iter()
                .map(
                    |(start_line, end_line, content)| LineOperation::ReplaceRange {
                        start: start_line,
                        end: end_line,
                        content,
                    },
                )
                .collect();

            let (modified_content, lines_added, lines_removed) =
                apply_line_operations(&content, operations);
            let total_lines = modified_content.lines().count();

            self.stage_file_with_content(&req.path, modified_content)?;
            self.index_manager.update_line_stats(
                &req.path,
                lines_added as isize,
                lines_removed as isize,
                total_lines,
            )?;

            Ok(ReplaceLinesResponse {
                path: req.path,
                lines_replaced: lines_removed,
                lines_added: lines_added as isize - lines_removed as isize,
                total_lines,
                original_lines,
            })
        })
    }

    pub fn handle_delete_lines(&self, req: DeleteLinesRequest) -> Result<ReplaceLinesResponse> {
        self.index_manager.with_snapshot(|| {
            let content = self.get_file_content(&req.path, SearchSpace::Staged)?;
            let original_lines = content.lines().count();

            let mut sorted_lines = req.line_numbers;
            sorted_lines.sort_unstable();
            sorted_lines.dedup();

            let mut operations = Vec::new();
            let mut iter = sorted_lines.into_iter();

            if let Some(mut start) = iter.next() {
                let mut end = start;

                for line in iter {
                    if line == end + 1 {
                        end = line;
                    } else {
                        operations.push(LineOperation::DeleteRange { start, end });
                        start = line;
                        end = line;
                    }
                }
                operations.push(LineOperation::DeleteRange { start, end });
            }

            let (modified_content, lines_added, lines_removed) =
                apply_line_operations(&content, operations);
            let total_lines = modified_content.lines().count();

            self.stage_file_with_content(&req.path, modified_content)?;
            self.index_manager.update_line_stats(
                &req.path,
                lines_added as isize,
                lines_removed as isize,
                total_lines,
            )?;

            Ok(ReplaceLinesResponse {
                path: req.path,
                lines_replaced: lines_removed,
                lines_added: -(lines_removed as isize),
                total_lines,
                original_lines,
            })
        })
    }

    pub fn handle_insert_lines(&self, req: InsertLinesRequest) -> Result<ReplaceLinesResponse> {
        self.index_manager.with_snapshot(|| {
            let content = self.get_file_content(&req.path, SearchSpace::Staged)?;
            let original_lines = content.lines().count();

            let operations: Vec<LineOperation> = req
                .insertions
                .into_iter()
                .map(|insertion| match insertion.position {
                    InsertPosition::Before => LineOperation::InsertBefore {
                        line: insertion.line_number,
                        content: insertion.content,
                    },
                    InsertPosition::After => LineOperation::InsertAfter {
                        line: insertion.line_number,
                        content: insertion.content,
                    },
                })
                .collect();

            let (modified_content, lines_added, lines_removed) =
                apply_line_operations(&content, operations);
            let total_lines = modified_content.lines().count();

            self.stage_file_with_content(&req.path, modified_content)?;
            self.index_manager.update_line_stats(
                &req.path,
                lines_added as isize,
                lines_removed as isize,
                total_lines,
            )?;

            Ok(ReplaceLinesResponse {
                path: req.path,
                lines_replaced: 0,
                lines_added: lines_added as isize,
                total_lines,
                original_lines,
            })
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

impl MoveFilesTool for Orchestrator {
    fn run_copy_files(&mut self, req: BatchCopyRequest) -> Result<BatchOperationResponse> {
        self.handle_copy_files(req)
    }

    fn run_move_files(&mut self, req: BatchMoveRequest) -> Result<BatchOperationResponse> {
        self.handle_move_files(req)
    }
}

impl DiffTool for Orchestrator {
    fn get_modified_files_summary(&self) -> Result<Vec<ModifiedFileSummary>> {
        let active_index = self.index_manager.active_index();
        let staged_index = self.index_manager.staged_index()?;
        let change_stats = self.index_manager.get_change_stats()?;
        let deletions = self.index_manager.get_staged_deletions()?;
        let moves = self.index_manager.get_staged_moves()?;

        let mut summaries = Vec::new();
        let deletion_set: std::collections::HashSet<_> = deletions.iter().cloned().collect();
        let mut processed_moves = std::collections::HashSet::new();

        // Process moves first
        for (src, dst) in &moves {
            if deletion_set.contains(src) && staged_index.get_file(dst).is_some() {
                processed_moves.insert(src.clone());
                processed_moves.insert(dst.clone());

                // Check if file was also modified during move
                let stats = change_stats
                    .iter()
                    .find(|(p, _)| p == dst)
                    .map(|(_, s)| s.clone());

                let (lines_added, lines_removed) = if let Some(stats) = stats {
                    (
                        stats.lines_added.max(0) as usize,
                        stats.lines_removed.unsigned_abs(),
                    )
                } else {
                    (0, 0)
                };

                summaries.push(ModifiedFileSummary {
                    path: src.clone(),
                    lines_added,
                    lines_removed,
                    status: FileChangeStatus::Moved,
                    moved_to: Some(dst.clone()),
                });
            }
        }

        // Process other changes
        for (path, stats) in change_stats {
            if deletion_set.contains(&path) || processed_moves.contains(&path) {
                continue;
            }

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
                moved_to: None,
            });
        }

        // Process deletions (excluding moves)
        for path in deletions {
            if processed_moves.contains(&path) {
                continue;
            }

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
                moved_to: None,
            });
        }

        Ok(summaries)
    }

    fn get_file_diff(&self, path: &PathKey) -> Result<FileDiff> {
        let active_index = self.index_manager.active_index();
        let staged_index = self.index_manager.staged_index()?;

        // Get content, treating missing files as empty
        let active_content = match active_index.get_file(path) {
            Some(entry) => match entry.search_content() {
                Some(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                None => String::new(),
            },
            None => String::new(),
        };

        let staged_content = match staged_index.get_file(path) {
            Some(entry) => match entry.search_content() {
                Some(bytes) => String::from_utf8_lossy(bytes).into_owned(),
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
