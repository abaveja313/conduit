//! intern.rs — Process-wide path interning (leak-forever)
//!
//! Invariants:
//! - Global pool; identical inputs return pointer-equal strings.
//! - Thread-safe: reads via shared lock; insertions take write lock with double-check.
//!
//! Safety & Memory:
//! - Leaky by design: entries live until process exit (bounded by unique inputs).
//!
//! Complexity:
//! - Hit: O(1) avg hash lookup, no alloc.  Miss: O(1) avg + 1 alloc + short write lock.

use normalize_path::NormalizePath;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use path_slash::PathExt;
use std::{collections::HashSet, path::Path};

use crate::error::{Error, Result};

/// Represents a normalized path in the virtual file system
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct PathKey(&'static str);

/// A static pool of static paths we can use to avoid duplication
static INTERN_POOL: Lazy<RwLock<HashSet<&'static str>>> = Lazy::new(|| RwLock::new(HashSet::new()));

/// Normalize the provided path to the canonical format
fn normalize_for_index(s: &str) -> Result<String> {
    // sanity checks
    if s.is_empty() {
        return Err(Error::InvalidPath("empty path".to_string()));
    }

    if s.chars().any(|c| c.is_control()) {
        return Err(Error::InvalidPath("contains control chars".to_string()));
    }

    let mut out = Path::new(s).normalize().to_slash_lossy().into_owned();

    // remove trailing slashes
    if out.len() > 1 {
        while out.ends_with('/') {
            out.pop();
        }
    }

    Ok(out)
}

/// Intern the provided normalized string
fn intern(target: &str) -> &'static str {
    // fast path - we already have path interned
    if let Some(&hit) = INTERN_POOL.read().get(target) {
        return hit;
    }

    // slow path - need to intern path
    let mut pool = INTERN_POOL.write();
    // double check to see if data changed
    if let Some(&hit) = pool.get(target) {
        return hit;
    }

    // prevent deallocation
    let leaked: &'static str = Box::leak(target.to_owned().into_boxed_str());
    pool.insert(leaked);
    leaked
}

impl PathKey {
    /// Create a path key from the provided normalized string
    pub fn from_normalized(normalized: &str) -> Self {
        Self(intern(normalized))
    }

    /// Get string representation of the path key
    pub fn as_str(&self) -> &str {
        self.0
    }

    pub fn starts_with(&self, prefix: &PathKey) -> bool {
        self.as_str().starts_with(prefix.as_str())
    }

    pub fn matches(&self, glob: &globset::GlobSet) -> bool {
        glob.is_match(self.as_str())
    }
}

impl TryFrom<&str> for PathKey {
    type Error = Error;

    fn try_from(value: &str) -> Result<Self> {
        let s = &normalize_for_index(value)?;
        Ok(Self::from_normalized(s))
    }
}
