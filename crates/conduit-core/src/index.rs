use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};

#[derive(Debug)]
pub struct FileEntry {
    ext: String,
    size: u64,
    mtime: i64,
    bytes: Option<Arc<[u8]>>,
}

#[derive(Debug, Default)]
pub struct Index {
    // exact lookups
    files: HashMap<Utf8PathBuf, Arc<FileEntry>>,
    // sorted paths for prefix/range queries
    prefixes: BTreeSet<Utf8PathBuf>,
}

impl Index {
    pub fn get_entries_by_prefix(&self, prefix: &Utf8Path) -> Vec<Utf8PathBuf> {
        let mut entries = Vec::new();
        let start = prefix.to_path_buf();

        for p in self.prefixes.range(start..) {
            if !p.starts_with(prefix) {
                // abort when we reach the end of range
                break;
            }

            entries.push(p.to_path_buf());
        }
        entries
    }

    pub fn get_file(&self, path: &Utf8Path) -> Option<Arc<FileEntry>> {
        self.files.get(path).cloned()
    }

    pub(crate) fn clone_shallow(&self) -> Self {
        Self {
            files: self.files.clone(),
            prefixes: self.prefixes.clone(),
        }
    }
}
