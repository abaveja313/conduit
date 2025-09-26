use arc_swap::ArcSwap;
use im::OrdSet as IOrdSet;
use parking_lot::Mutex; // only guards staging state
use std::path::Path;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::fs::{FileEntry, Index};

#[derive(Default, Clone)]
pub struct StagingState {
    snapshot: Arc<Index>,
    modified: IOrdSet<PathKey>,
}
/// Manages staged index updates with copy-on-write semantics.
///
/// Architecture:
/// - Readers get lock-free snapshots via `ArcSwap`
/// - Writers stage changes on a cloned index (O(1) with `im`)
/// - Promotion atomically swaps in the new index
pub struct IndexManager {
    // Active index, atomically swappable for lock-free reads.
    active: ArcSwap<Index>,
    // Only writers touch this; protects the optional staged snapshot.
    staged: Mutex<Option<StagingState>>,
}

impl Default for IndexManager {
    fn default() -> Self {
        Self {
            active: ArcSwap::from_pointee(Index::default()),
            staged: Mutex::new(None),
        }
    }
}

impl IndexManager {
    /// Current index snapshot (lock-free).
    pub fn active_index(&self) -> Arc<Index> {
        self.active.load_full()
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
        *g = Some(StagingState {
            snapshot: self.active.load_full(),
            modified: IOrdSet::new(),
        });
        Ok(())
    }

    /// Add/update file in staging area.
    ///
    /// First write triggers COW split via `Arc::make_mut`.
    pub fn stage_file(&self, key: PathKey, bytes: Arc<[u8]>, mtime: i64) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx = Arc::make_mut(&mut staged.snapshot); // split on first write

        // track modification
        staged.modified.insert(key.clone());

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
        let idx = Arc::make_mut(&mut staged.snapshot);
        staged.modified.insert(key.clone());
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
        self.active.store(staged.snapshot);
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
            .map(|s| s.snapshot)
    }
}
