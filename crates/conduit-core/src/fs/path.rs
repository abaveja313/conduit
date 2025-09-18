use normalize_path::NormalizePath;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use path_slash::PathExt;
use std::{collections::HashSet, path::Path, sync::Arc};

use crate::error::{Error, Result};

// Needed for `matches(&GlobSet)`
use globset::GlobSet;

/// Represents a normalized path in the virtual file system.
///
/// Serialized transparently as a plain JSON string.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct PathKey(pub Arc<str>);

/// Global pool of interned paths.
static INTERN_POOL: Lazy<RwLock<HashSet<Arc<str>>>> = Lazy::new(|| RwLock::new(HashSet::new()));

/// Normalize the provided path to the canonical format.
///
/// Rules:
/// - Must be non-empty, no control characters
/// - Normalize OS separators, collapse `.`/`..`
/// - Convert to POSIX slashes
/// - Strip trailing slashes (except root)
fn normalize_for_index(s: &str) -> Result<String> {
    if s.is_empty() {
        return Err(Error::InvalidPath("empty path".to_string()));
    }
    if s.chars().any(|c| c.is_control()) {
        return Err(Error::InvalidPath("contains control chars".to_string()));
    }

    let mut out = Path::new(s).normalize().to_slash_lossy().into_owned();

    // remove trailing slashes (keep "/" as-is)
    if out.len() > 1 {
        while out.ends_with('/') {
            out.pop();
        }
    }

    Ok(out)
}

/// Intern a normalized string into the global pool and return an Arc.
fn intern(normalized: &str) -> Arc<str> {
    // fast path: reader lock
    if let Some(existing) = INTERN_POOL.read().get(normalized) {
        return Arc::clone(existing);
    }

    // slow path: writer lock with double-check
    let mut pool = INTERN_POOL.write();
    if let Some(existing) = pool.get(normalized) {
        return Arc::clone(existing);
    }

    let arc: Arc<str> = Arc::<str>::from(normalized);
    pool.insert(Arc::clone(&arc));
    arc
}

impl PathKey {
    /// Construct from a **pre-normalized** string without re-validating.
    #[inline]
    pub fn from_normalized(normalized: &str) -> Self {
        Self(intern(normalized))
    }

    /// Normalized string slice.
    #[inline]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns whether this path starts with the given prefix.
    #[inline]
    pub fn starts_with(&self, prefix: &PathKey) -> bool {
        self.as_str().starts_with(prefix.as_str())
    }

    /// Matches a compiled globset.
    #[inline]
    pub fn matches(&self, glob: &GlobSet) -> bool {
        glob.is_match(self.as_str())
    }
}

impl TryFrom<&str> for PathKey {
    type Error = Error;

    fn try_from(value: &str) -> Result<Self> {
        let normalized = normalize_for_index(value)?;
        Ok(PathKey::from_normalized(&normalized))
    }
}

impl TryFrom<String> for PathKey {
    type Error = Error;

    fn try_from(value: String) -> Result<Self> {
        PathKey::try_from(value.as_str())
    }
}

impl From<PathKey> for String {
    fn from(k: PathKey) -> Self {
        k.0.as_ref().to_owned()
    }
}

impl AsRef<str> for PathKey {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}
