use normalize_path::NormalizePath;
use path_slash::PathExt;
use std::{path::Path, sync::Arc};

use crate::error::{Error, Result};

use globset::GlobSet;

/// Represents a normalized path in the virtual file system.
///
/// Serialized transparently as a plain JSON string.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct PathKey(Arc<str>);

/// Normalize the provided path to the canonical format.
///
/// Rules:
/// - Must be non-empty, no control characters
/// - Normalize OS separators, collapse `.`/`..`
/// - Convert to POSIX slashes
/// - Strip trailing slashes (except root)
pub fn normalize_path(s: &str) -> Result<String> {
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

impl PathKey {
    /// Construct from a **pre-normalized** string with a given Arc.
    ///
    /// This is used when the string has already been interned elsewhere.
    #[inline]
    pub fn from_arc(arc: Arc<str>) -> Self {
        Self(arc)
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
