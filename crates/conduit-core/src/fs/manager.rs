use arc_swap::ArcSwap;
use im::OrdSet as IOrdSet;
use parking_lot::Mutex; // only guards staging state
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
            // noting to do
            return Ok(());
        }
        *g = Some(StagingState {
            snapshot: self.active.load_full(),
            modified: IOrdSet::new(),
        });
        Ok(())
    }

    /// Add/update file in staging area.
    ///
    /// First write triggers COW split via `Arc::make_mut`.
    pub fn stage_file(&self, key: PathKey, entry: FileEntry) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx = Arc::make_mut(&mut staged.snapshot); // split on first write

        staged.modified.insert(key.clone());
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

    /// Bulk load files into the index.
    ///
    /// This method:
    /// 1. Begins fresh staging (clears any existing staging)
    /// 2. Adds all provided files to staging
    /// 3. Automatically commits to the active index
    ///
    /// This is designed for initial file loading. It replaces the entire
    /// index with the provided files.
    pub fn load_files(&self, files: Vec<(PathKey, FileEntry)>) -> Result<()> {
        // Clear any existing staging and start fresh
        {
            let mut g = self.staged.lock();
            *g = None;
        }
        self.begin_staging()?;

        for (key, entry) in files {
            self.stage_file(key, entry)?;
        }

        self.promote_staged()?;

        Ok(())
    }

    /// Add files to the current staging area without committing.
    ///
    /// This is for incremental loading across multiple batches.
    /// Call `begin_staging()` first, then multiple `add_files_to_staging()`,
    /// then `promote_staged()` when done.
    pub fn add_files_to_staging(&self, files: Vec<(PathKey, FileEntry)>) -> Result<()> {
        if self.staged.lock().is_none() {
            return Err(Error::StagingNotActive);
        }

        for (key, entry) in files {
            self.stage_file(key, entry)?;
        }

        Ok(())
    }

    /// Get modified files from staging with their content.
    pub fn get_staged_modifications(&self) -> Result<Vec<(PathKey, Vec<u8>)>> {
        let g = self.staged.lock();
        let staged = g.as_ref().ok_or(Error::StagingNotActive)?;

        Ok(staged
            .modified
            .iter()
            .filter_map(|path| {
                staged
                    .snapshot
                    .get_file(path)
                    .and_then(|entry| entry.bytes())
                    .map(|bytes| (path.clone(), bytes.to_vec()))
            })
            .collect())
    }

    /// Get paths that were removed in staging.
    pub fn get_staged_deletions(&self) -> Result<Vec<PathKey>> {
        let g = self.staged.lock();
        let staged = g.as_ref().ok_or(Error::StagingNotActive)?;

        Ok(staged
            .modified
            .iter()
            .filter(|path| staged.snapshot.get_file(path).is_none())
            .cloned()
            .collect())
    }
}
