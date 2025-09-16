use std::sync::Arc;

use once_cell::sync::Lazy;
use parking_lot::RwLock;

use crate::error::{Error, Result};
use crate::index::Index;

#[derive(Debug, Default)]
struct IndexManager {
    current: Arc<Index>,
    staged: Option<Arc<Index>>,
}

static MANAGER: Lazy<RwLock<IndexManager>> = Lazy::new(|| RwLock::new(IndexManager::default()));

impl IndexManager {
    pub fn active_index(&self) -> Arc<Index> {
        self.staged
            .as_ref()
            .cloned()
            .unwrap_or_else(|| Arc::clone(&self.current))
    }

    pub fn current_index(&self) -> Arc<Index> {
        self.current.clone()
    }

    pub fn staged_index(&self) -> Option<Arc<Index>> {
        self.staged.clone()
    }

    pub fn has_staged(&self) -> bool {
        self.staged.is_some()
    }

    pub fn begin_staging(&mut self) -> Result<()> {
        if self.staged.is_some() {
            return Err(Error::StagingAlreadyActive);
        }
        self.staged = Some(Arc::new(self.current.clone_shallow()));
        Ok(())
    }

    pub fn promote_staged(&mut self) -> Result<()> {
        let staged = self.staged.take().ok_or(Error::StagingNotActive)?;
        self.current = staged;
        Ok(())
    }

    pub fn revert_staged(&mut self) -> Result<()> {
        if self.staged.is_none() {
            return Err(Error::StagingNotActive);
        }
        self.staged = None;
        Ok(())
    }
}
