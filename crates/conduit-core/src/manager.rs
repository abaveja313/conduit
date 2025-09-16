use arc_swap::ArcSwap;
use once_cell::sync::Lazy;
use parking_lot::Mutex; // only guards staging state
use std::path::Path;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::index::{FileEntry, Index};
use crate::path::PathKey;

static ACTIVE: Lazy<ArcSwap<Index>> = Lazy::new(|| ArcSwap::from_pointee(Index::default()));

#[derive(Default)]
pub struct IndexManager {
    // Only writers touch this; protects the optional staged snapshot.
    staged: Mutex<Option<Arc<Index>>>,
}

static MANAGER: Lazy<IndexManager> = Lazy::new(IndexManager::default);

impl IndexManager {
    // Readers: lock-free snapshot
    pub fn active_index(&self) -> Arc<Index> {
        ACTIVE.load_full()
    }

    pub fn begin_staging(&self) -> Result<()> {
        let mut g = self.staged.lock();
        if g.is_some() {
            return Err(Error::StagingAlreadyActive);
        }
        // Start from current active snapshot
        *g = Some(ACTIVE.load_full());
        Ok(())
    }

    pub fn stage_file(&self, key: PathKey, bytes: Arc<[u8]>, mtime: i64) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx: &mut Index = Arc::make_mut(staged); // split on first write

        let ext = Path::new(key.as_str())
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_owned();

        let entry = FileEntry::from_bytes(ext, mtime, bytes);
        idx.upsert_file(key, entry);
        Ok(())
    }

    pub fn remove_staged_file(&self, key: PathKey) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx: &mut Index = Arc::make_mut(staged);
        let _ = idx.remove_file(key);
        Ok(())
    }

    pub fn promote_staged(&self) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.take().ok_or(Error::StagingNotActive)?;
        // O(1) atomic swap; existing readers keep their old Arc<Index> until they drop it.
        ACTIVE.store(staged);
        Ok(())
    }

    pub fn revert_staged(&self) -> Result<()> {
        let mut g = self.staged.lock();
        if g.is_none() {
            return Err(Error::StagingNotActive);
        }
        *g = None;
        Ok(())
    }
}
