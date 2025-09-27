use globset::GlobSet;
use im::{HashMap as IHashMap, OrdSet as IOrdSet};
use std::{
    ops::Bound::{Included, Unbounded},
    path::Path,
    sync::Arc,
};

use crate::fs::PathKey;

/// File metadata with optional content.
#[derive(Debug, Clone)]
pub struct FileEntry {
    ext: String,
    size: u64,
    mtime: i64, // unix epoch
    bytes: Option<Arc<[u8]>>,
}

/// Path-indexed file collection with efficient prefix queries.
///
/// Uses persistent data structures for cheap cloning.
#[derive(Debug, Default, Clone)]
pub struct Index {
    // exact lookups - persistent map, but ops mutate in place
    files: IHashMap<PathKey, FileEntry>,
    // sorted paths for prefix/range queries
    prefixes: IOrdSet<PathKey>,
}

impl FileEntry {
    /// Extract extension from a path string.
    pub fn get_extension(path: &str) -> String {
        Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_owned()
    }

    /// Create metadata-only entry.
    pub fn new(ext: impl Into<String>, size: u64, mtime: i64) -> Self {
        Self {
            ext: ext.into(),
            size,
            mtime,
            bytes: None,
        }
    }

    /// Create metadata-only entry from a path.
    pub fn new_from_path(path: &PathKey, size: u64, mtime: i64) -> Self {
        Self::new(Self::get_extension(path.as_str()), size, mtime)
    }

    /// Create entry with content.
    pub fn from_bytes(ext: impl Into<String>, mtime: i64, bytes: Arc<[u8]>) -> Self {
        let size = bytes.len() as u64;
        Self {
            ext: ext.into(),
            size,
            mtime,
            bytes: Some(bytes),
        }
    }

    /// Create entry with content from a path.
    pub fn from_bytes_and_path(path: &PathKey, mtime: i64, bytes: Arc<[u8]>) -> Self {
        Self::from_bytes(Self::get_extension(path.as_str()), mtime, bytes)
    }

    /// Replace content, optionally updating mtime.
    pub fn update_bytes(&mut self, bytes: Arc<[u8]>, new_mtime: Option<i64>) {
        self.size = bytes.len() as u64;
        self.bytes = Some(bytes);
        if let Some(t) = new_mtime {
            self.mtime = t;
        }
    }

    /// Drop content, keep metadata.
    pub fn clear_bytes(&mut self) {
        self.bytes = None;
    }

    /// File content if loaded.
    pub fn bytes(&self) -> Option<&[u8]> {
        self.bytes.as_deref()
    }

    /// File extension.
    pub fn ext(&self) -> &str {
        &self.ext
    }

    /// Size in bytes.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Last modified time (unix epoch).
    pub fn mtime(&self) -> i64 {
        self.mtime
    }
}

impl Index {
    /// Lookup by exact path.
    pub fn get_file(&self, key: &PathKey) -> Option<&FileEntry> {
        self.files.get(key)
    }

    /// Insert or update file.
    pub fn upsert_file(&mut self, key: PathKey, entry: FileEntry) {
        // im::HashMap::insert mutates self and returns the old value
        let _old = self.files.insert(key.clone(), entry);
        // im::OrdSet::insert mutates self and returns whether it was newly inserted
        let _ = self.prefixes.insert(key);
    }

    /// Remove file. Returns whether it existed.
    pub fn remove_file(&mut self, key: &PathKey) -> bool {
        // returns Option<FileEntry>
        let existed = self.files.remove(key).is_some();
        if existed {
            let _ = self.prefixes.remove(key);
        }
        existed
    }

    /// All paths with given prefix.
    pub fn paths_by_prefix(&self, prefix: &PathKey) -> Vec<PathKey> {
        self.prefixes
            .range((Included(prefix.clone()), Unbounded))
            .take_while(|p| p.as_str().starts_with(prefix.as_str()))
            .cloned() // range yields &PathKey
            .collect()
    }

    /// Filtered paths matching prefix and glob patterns.
    ///
    /// Applies includes first, then excludes. All filters optional.
    pub fn candidates<'a>(
        &'a self,
        prefix: Option<&'a PathKey>,
        includes: Option<&'a [GlobSet]>,
        excludes: Option<&'a [GlobSet]>,
    ) -> impl Iterator<Item = (PathKey, &'a FileEntry)> + 'a {
        let lower = prefix.cloned().map_or(Unbounded, Included);

        self.prefixes
            .range((lower, Unbounded))
            .take_while(move |k| prefix.is_none_or(|p| k.starts_with(p)))
            .filter(move |k| {
                if let Some(globs) = includes {
                    globs.iter().any(|g| k.matches(g))
                } else {
                    true
                }
            })
            .filter(move |k| {
                if let Some(globs) = excludes {
                    !globs.iter().any(|g| k.matches(g))
                } else {
                    true
                }
            })
            .filter_map(move |k| self.get_file(k).map(|file| (k.clone(), file)))
    }
}
