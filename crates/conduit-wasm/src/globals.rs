//! Global state management for the WASM module.
//!
//! These globals are initialized lazily on first access and persist
//! for the lifetime of the WASM instance.

use conduit_core::error::Result;
use conduit_core::fs::{normalize_path, IndexManager, PathKey};
use once_cell::sync::Lazy;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

thread_local! {
    /// Path interning pool.
    static PATH_POOL: RefCell<HashMap<String, Arc<str>>> = RefCell::new(HashMap::new());
}

/// Global index manager for file management.
pub(crate) static INDEX_MANAGER: Lazy<IndexManager> = Lazy::new(IndexManager::default);

/// Get a reference to the global index manager.
pub fn get_index_manager() -> &'static IndexManager {
    &INDEX_MANAGER
}

/// Intern a normalized path string.
pub fn intern_path(normalized: &str) -> Arc<str> {
    PATH_POOL.with(|pool| {
        let mut pool = pool.borrow_mut();

        pool.entry(normalized.to_string())
            .or_insert_with(|| Arc::from(normalized))
            .clone()
    })
}

/// Create a PathKey from a raw path string.
///
/// This handles normalization and interning in one step.
pub fn create_path_key(path: &str) -> Result<PathKey> {
    let normalized = normalize_path(path)?;
    let arc = intern_path(&normalized);
    Ok(PathKey::from_arc(arc))
}
