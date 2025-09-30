//! Orchestrator for coordinating search and edit operations.

use crate::globals::get_index_manager;
use conduit_core::prelude::*;
use conduit_core::tools::extract_lines;

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

        let _index = match req.where_ {
            SearchSpace::Active => self.index_manager.active_index(),
            SearchSpace::Staged => self.index_manager.staged_index()?,
        };

        // TODO: Implement search logic
        Ok(FindResponse {
            results: Vec::new(),
        })
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
        // Get the appropriate index
        let index = match where_ {
            SearchSpace::Active => self.index_manager.active_index(),
            SearchSpace::Staged => self.index_manager.staged_index()?,
        };

        // Get the file entry
        let entry = index
            .get_file(path)
            .ok_or_else(|| Error::InvalidPath(format!("File not found: {}", path.as_str())))?;

        // Get file content
        let content = entry.bytes().ok_or_else(|| {
            Error::MissingContent(format!("File has no content: {}", path.as_str()))
        })?;

        // Extract the requested lines
        extract_lines(path.clone(), content, start_line, end_line)
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
