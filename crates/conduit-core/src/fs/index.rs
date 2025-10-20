use globset::GlobSet;
use im::{HashMap as IHashMap, OrdSet as IOrdSet};
use std::{
    ops::Bound::{Included, Unbounded},
    path::Path,
    sync::Arc,
};

use crate::error::{Error, Result};
use crate::fs::PathKey;

/// File metadata with optional content.
#[derive(Debug, Clone)]
pub struct FileEntry {
    ext: String,
    mime_type: Option<String>,
    size: u64,
    mtime: i64, // unix epoch
    bytes: Option<Arc<[u8]>>,
    text_content: Option<Arc<[u8]>>,
    editable: bool,
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

    pub fn set_modified(&mut self, mtime: i64) {
        self.mtime = mtime;
    }

    /// Create metadata-only entry.
    pub fn new(ext: impl Into<String>, size: u64, mtime: i64, editable: bool) -> Self {
        Self {
            ext: ext.into(),
            mime_type: None,
            size,
            mtime,
            bytes: None,
            text_content: None,
            editable,
        }
    }

    /// Create metadata-only entry from a path.
    pub fn new_from_path(path: &PathKey, size: u64, mtime: i64, editable: bool) -> Self {
        Self::new(Self::get_extension(path.as_str()), size, mtime, editable)
    }

    /// Create metadata-only entry with MIME type.
    pub fn new_with_mime(
        ext: impl Into<String>,
        mime_type: impl Into<String>,
        size: u64,
        mtime: i64,
        editable: bool,
    ) -> Self {
        Self {
            ext: ext.into(),
            mime_type: Some(mime_type.into()),
            size,
            mtime,
            bytes: None,
            text_content: None,
            editable,
        }
    }

    /// Create entry with content.
    pub fn from_bytes(
        ext: impl Into<String>,
        mtime: i64,
        bytes: Arc<[u8]>,
        editable: bool,
    ) -> Self {
        let size = bytes.len() as u64;
        Self {
            ext: ext.into(),
            mime_type: None,
            size,
            mtime,
            bytes: Some(bytes),
            text_content: None,
            editable,
        }
    }

    /// Create entry with content from a path.
    pub fn from_bytes_and_path(
        path: &PathKey,
        mtime: i64,
        bytes: Arc<[u8]>,
        editable: bool,
    ) -> Self {
        Self::from_bytes(Self::get_extension(path.as_str()), mtime, bytes, editable)
    }

    /// Create entry with content and MIME type.
    pub fn from_bytes_with_mime(
        ext: impl Into<String>,
        mime_type: Option<String>,
        mtime: i64,
        bytes: Arc<[u8]>,
        editable: bool,
    ) -> Self {
        let size = bytes.len() as u64;
        Self {
            ext: ext.into(),
            mime_type,
            size,
            mtime,
            bytes: Some(bytes),
            text_content: None,
            editable,
        }
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
        self.text_content = None;
    }

    pub fn from_bytes_with_text(
        ext: impl Into<String>,
        mtime: i64,
        original_bytes: Arc<[u8]>,
        text_content: Arc<[u8]>,
        editable: bool,
    ) -> Self {
        let size = original_bytes.len() as u64;
        Self {
            ext: ext.into(),
            mime_type: None,
            size,
            mtime,
            bytes: Some(original_bytes),
            text_content: Some(text_content),
            editable,
        }
    }

    pub fn search_content(&self) -> Option<&[u8]> {
        self.text_content.as_deref().or(self.bytes.as_deref())
    }

    /// File content if loaded.
    pub fn bytes(&self) -> Option<&[u8]> {
        self.bytes.as_deref()
    }

    /// File extension.
    pub fn ext(&self) -> &str {
        &self.ext
    }

    /// MIME type if detected.
    pub fn mime_type(&self) -> Option<&str> {
        self.mime_type.as_deref()
    }

    /// Size in bytes.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Last modified time (unix epoch).
    pub fn mtime(&self) -> i64 {
        self.mtime
    }

    pub fn is_editable(&self) -> bool {
        self.editable
    }
}

impl Index {
    /// Lookup by exact path.
    pub fn get_file(&self, key: &PathKey) -> Option<&FileEntry> {
        self.files.get(key)
    }

    pub fn take_file(&mut self, key: &PathKey) -> Option<FileEntry> {
        self.files.remove(key)
    }

    /// Insert or update file.
    pub fn upsert_file(&mut self, key: PathKey, entry: FileEntry) -> Result<()> {
        // Check if we're trying to modify a read-only file
        if let Some(existing) = self.files.get(&key) {
            if !existing.is_editable() {
                return Err(Error::ReadOnlyFile(key.into()));
            }
        }
        let _old = self.files.insert(key.clone(), entry);
        let _ = self.prefixes.insert(key);
        Ok(())
    }

    /// Remove file. Returns whether it existed.
    pub fn remove_file(&mut self, key: &PathKey) -> Result<bool> {
        // we can still remove readonly files, just not update them
        // should eventually rename readonly to modifiable
        // if !self.can_edit_file(key) {
        //     return Err(Error::ReadOnlyFile(key.clone().into()));
        // }

        let existed = self.files.remove(key).is_some();
        if existed {
            let _ = self.prefixes.remove(key);
        }
        Ok(existed)
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

    /// Get the total number of files in the index.
    #[inline]
    pub fn len(&self) -> usize {
        self.files.len()
    }

    /// Check if the index is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Iterator over all files (unordered).
    pub fn iter(&self) -> impl Iterator<Item = (&PathKey, &FileEntry)> {
        self.files.iter()
    }

    /// Iterator over all files in sorted order by path.
    pub fn iter_sorted(&self) -> impl Iterator<Item = (&PathKey, &FileEntry)> + '_ {
        self.prefixes
            .iter()
            .filter_map(|path| self.get_file(path).map(|entry| (path, entry)))
    }
}
