use arc_swap::ArcSwap;
use once_cell::sync::Lazy;
use parking_lot::Mutex; // only guards staging state
use std::path::Path;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::fs::{FileEntry, Index};

/// Active index, atomically swappable for lock-free reads.
static ACTIVE: Lazy<ArcSwap<Index>> = Lazy::new(|| ArcSwap::from_pointee(Index::default()));

/// Manages staged index updates with copy-on-write semantics.
///
/// Architecture:
/// - Readers get lock-free snapshots via `ArcSwap`
/// - Writers stage changes on a cloned index (O(1) with `im`)
/// - Promotion atomically swaps in the new index
#[derive(Default)]
pub struct IndexManager {
    // Only writers touch this; protects the optional staged snapshot.
    staged: Mutex<Option<Arc<Index>>>,
}

/// Global index manager singleton.
static MANAGER: Lazy<IndexManager> = Lazy::new(IndexManager::default);

impl IndexManager {
    /// Current index snapshot (lock-free).
    pub fn active_index(&self) -> Arc<Index> {
        ACTIVE.load_full()
    }

    /// Start staging changes. Fails if already staging.
    ///
    /// Creates O(1) clone of current index for modifications.
    pub fn begin_staging(&self) -> Result<()> {
        let mut g = self.staged.lock();
        if g.is_some() {
            return Err(Error::StagingAlreadyActive);
        }
        // Start from current active snapshot
        *g = Some(ACTIVE.load_full());
        Ok(())
    }

    /// Add/update file in staging area.
    ///
    /// First write triggers COW split via `Arc::make_mut`.
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

    /// Remove file from staging area.
    pub fn remove_staged_file(&self, key: &PathKey) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx: &mut Index = Arc::make_mut(staged);
        let _ = idx.remove_file(key);
        Ok(())
    }

    /// Atomically replace active index with staged.
    ///
    /// Existing readers keep their snapshots until dropped.
    pub fn promote_staged(&self) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.take().ok_or(Error::StagingNotActive)?;
        // O(1) atomic swap; existing readers keep their old Arc<Index> until they drop it.
        ACTIVE.store(staged);
        Ok(())
    }

    /// Discard staged changes.
    pub fn revert_staged(&self) -> Result<()> {
        let mut g = self.staged.lock();
        if g.is_none() {
            return Err(Error::StagingNotActive);
        }
        *g = None;
        Ok(())
    }

    /// Get staged index snapshot (fails if not staging).
    ///
    /// This is a cheap Arc clone, safe to hold across operations.
    pub fn staged_index(&self) -> Result<Arc<Index>> {
        self.staged
            .lock()
            .as_ref()
            .cloned()
            .ok_or(Error::StagingNotActive)
    }
}

/// Get global manager instance.
pub fn manager() -> &'static IndexManager {
    &MANAGER
}

/// Shortcut for current index.
pub fn active_index() -> Arc<Index> {
    MANAGER.active_index()
}
