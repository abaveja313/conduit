//! Orchestrator for coordinating search and edit operations.

use crate::{current_unix_timestamp, globals::get_index_manager};
use conduit_core::fs::FileEntry;
use conduit_core::prelude::*;
use conduit_core::tools::{extract_lines, for_each_match, LineIndex, PreviewBuilder};
use conduit_core::RegexMatcher;
use globset::{Glob, GlobSet, GlobSetBuilder};

/// Coordinates operations using global state.
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

        // TODO: Implement edit logic
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
        self.index_manager.stage_file(req.path.clone(), entry)?;

        Ok(CreateResponse {
            path: req.path,
            size,
            created: !exists,
        })
    }

    pub fn handle_delete(&self, req: DeleteRequest) -> Result<DeleteResponse> {
        // Ensure staging is active
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
