use arc_swap::ArcSwap;
use im::OrdSet as IOrdSet;
use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::fs::{FileEntry, Index};
use crate::tools::LineIndex;

#[derive(Default, Clone)]
pub struct StagingState {
    snapshot: Arc<Index>,
    modified: IOrdSet<PathKey>,
    /// Track line changes per file for efficient diff stats
    change_stats: im::HashMap<PathKey, FileChangeStats>,
}

/// Statistics about changes to a file
#[derive(Default, Clone, Debug)]
pub struct FileChangeStats {
    /// Total lines added across all operations
    pub lines_added: isize,
    /// Total lines removed across all operations  
    pub lines_removed: isize,
    /// Original line count when staging began
    pub original_line_count: usize,
    /// Current line count
    pub current_line_count: usize,
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
    // Cache of line indices for files, keyed by (PathKey, mtime)
    // Using RwLock for concurrent reads
    line_index_cache: RwLock<HashMap<(PathKey, i64), Arc<LineIndex>>>,
}

impl Default for IndexManager {
    fn default() -> Self {
        Self {
            active: ArcSwap::from_pointee(Index::default()),
            staged: Mutex::new(None),
            line_index_cache: RwLock::new(HashMap::new()),
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
            change_stats: im::HashMap::new(),
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

        // Invalidate line index cache for this file since it's being modified
        // This is critical for consecutive line operations to work correctly
        {
            let mut cache = self.line_index_cache.write();
            // Remove all entries for this path (any mtime)
            cache.retain(|(path, _), _| path != &key);
        }

        idx.upsert_file(key, entry)?;
        Ok(())
    }

    /// Update line change statistics for a file
    pub fn update_line_stats(
        &self,
        key: &PathKey,
        _lines_added: isize,   // Not used for cumulative tracking
        _lines_removed: isize, // Not used for cumulative tracking
        current_line_count: usize,
    ) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;

        // Get the active index for comparison
        let active_index = self.active.load_full();

        // Get original content from active index
        let (original_content, original_line_count) = match active_index.get_file(key) {
            Some(entry) => match entry.bytes() {
                Some(bytes) => {
                    let content = String::from_utf8_lossy(bytes);
                    let line_count = content.lines().count();
                    (content.to_string(), line_count)
                }
                None => (String::new(), 0),
            },
            None => (String::new(), 0), // New file
        };

        // Get current staged content
        let staged_index = Arc::clone(&staged.snapshot);
        let (staged_content, _) = match staged_index.get_file(key) {
            Some(entry) => match entry.bytes() {
                Some(bytes) => {
                    let content = String::from_utf8_lossy(bytes);
                    let line_count = content.lines().count();
                    (content.to_string(), line_count)
                }
                None => (String::new(), 0),
            },
            None => (String::new(), 0),
        };

        // Compute actual diff to get accurate added/removed lines
        use crate::tools::diff::compute_diff;
        let diff = compute_diff(key.clone(), &original_content, &staged_content);

        // Update or create stats with actual diff numbers
        let stats = staged
            .change_stats
            .entry(key.clone())
            .or_insert(FileChangeStats {
                lines_added: 0,
                lines_removed: 0,
                original_line_count,
                current_line_count: original_line_count,
            });

        stats.lines_added = diff.stats.lines_added as isize;
        stats.lines_removed = diff.stats.lines_removed as isize;
        stats.original_line_count = original_line_count;
        stats.current_line_count = current_line_count;

        Ok(())
    }

    /// Remove file from staging area.
    pub fn remove_staged_file(&self, key: &PathKey) -> Result<()> {
        let mut g = self.staged.lock();
        let staged = g.as_mut().ok_or(Error::StagingNotActive)?;
        let idx = Arc::make_mut(&mut staged.snapshot);
        staged.modified.insert(key.clone());

        // Remove from change stats to prevent duplicates
        staged.change_stats.remove(key);

        // Clear line index cache for this file
        {
            let mut cache = self.line_index_cache.write();
            cache.retain(|(path, _), _| path != key);
        }

        let _ = idx.remove_file(key)?;
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
        // Clear line index cache since files have changed
        self.clear_line_index_cache();
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

    /// Get change statistics for all modified files
    pub fn get_change_stats(&self) -> Result<Vec<(PathKey, FileChangeStats)>> {
        let g = self.staged.lock();
        let staged = g.as_ref().ok_or(Error::StagingNotActive)?;

        Ok(staged
            .change_stats
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect())
    }

    /// Get change statistics for a specific file
    pub fn get_file_change_stats(&self, path: &PathKey) -> Result<Option<FileChangeStats>> {
        let g = self.staged.lock();
        let staged = g.as_ref().ok_or(Error::StagingNotActive)?;

        Ok(staged.change_stats.get(path).cloned())
    }

    /// Get or compute LineIndex for a file
    pub fn get_line_index(&self, path: &PathKey, index: &Index) -> Option<Arc<LineIndex>> {
        let entry = index.get_file(path)?;
        let bytes = entry.bytes()?;
        let mtime = entry.mtime();

        // Check cache first
        let cache_key = (path.clone(), mtime);
        {
            let cache = self.line_index_cache.read();
            if let Some(line_index) = cache.get(&cache_key) {
                return Some(Arc::clone(line_index));
            }
        }

        // Not in cache, compute it
        let line_index = Arc::new(LineIndex::build(bytes));

        // Store in cache
        {
            let mut cache = self.line_index_cache.write();
            cache.insert(cache_key, Arc::clone(&line_index));
        }

        Some(line_index)
    }

    /// Clear line index cache (e.g., when promoting staged changes)
    pub fn clear_line_index_cache(&self) {
        let mut cache = self.line_index_cache.write();
        cache.clear();
    }
}
