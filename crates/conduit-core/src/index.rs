use im::{HashMap as IHashMap, OrdSet as IOrdSet};
use std::{
    ops::Bound::{Included, Unbounded},
    sync::Arc,
};

use crate::path::PathKey;

#[derive(Debug, Clone)]
pub struct FileEntry {
    ext: String,
    size: u64,
    mtime: i64, // unix epoch
    bytes: Option<Arc<[u8]>>,
}

#[derive(Debug, Default, Clone)]
pub struct Index {
    // exact lookups - use immutable for structural sharing
    files: IHashMap<PathKey, FileEntry>,
    // sorted paths for prefix/range queries
    prefixes: IOrdSet<PathKey>,
}

impl FileEntry {
    /// Metadata-only constructor (no bytes)
    pub fn new(ext: impl Into<String>, size: u64, mtime: i64) -> Self {
        Self {
            ext: ext.into(),
            size,
            mtime,
            bytes: None,
        }
    }

    /// Bytes-present constructor; size is computed from bytes to avoid mismatch
    pub fn from_bytes(ext: impl Into<String>, mtime: i64, bytes: Arc<[u8]>) -> Self {
        let size = bytes.len() as u64;
        Self {
            ext: ext.into(),
            size,
            mtime,
            bytes: Some(bytes),
        }
    }

    /// Update/replace bytes; optionally bump mtime
    pub fn update_bytes(&mut self, bytes: Arc<[u8]>, new_mtime: Option<i64>) {
        self.size = bytes.len() as u64;
        self.bytes = Some(bytes);
        if let Some(t) = new_mtime {
            self.mtime = t;
        }
    }

    /// Drop in-memory bytes if you want to keep metadata only
    pub fn clear_bytes(&mut self) {
        self.bytes = None;
    }

    /// Borrow the bytes without cloning the Arc
    pub fn bytes(&self) -> Option<&[u8]> {
        self.bytes.as_deref()
    }
}

impl Index {
    /// Get a file entry by path key
    pub fn get_file(&self, key: PathKey) -> Option<&FileEntry> {
        self.files.get(&key)
    }

    /// Upsert a file entry by path key
    pub fn upsert_file(&mut self, key: PathKey, entry: FileEntry) {
        self.files.insert(key, entry);
        self.prefixes.insert(key);
    }

    /// Remove a file by path key, if it exists
    pub fn remove_file(&mut self, key: PathKey) -> bool {
        let existed = self.files.remove(&key).is_some();
        if existed {
            self.prefixes.remove(&key);
        }
        existed
    }

    /// Get all entries that have a path starting with the specified prefix
    ///
    /// Used to implement `ls`-like operations. Uses a simple sequential
    /// scan and
    pub fn paths_by_prefix(&self, prefix: PathKey) -> Vec<PathKey> {
        // early terminate when we exit the prefix range
        self.prefixes
            .range((Included(prefix), Unbounded))
            .take_while(|p| p.as_str().starts_with(prefix.as_str()))
            .copied()
            .collect()
    }
}
