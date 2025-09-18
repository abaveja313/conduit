//! FS layer: path types, in-memory index, and the index manager
//! used by search/replace tools. Keep IO-free; all bytes are
//! already resident in memory.

pub mod index;
pub mod manager;
pub mod path;

// Re-exports for ergonomic downstream imports:
// `use conduit_core::fs::{PathKey, Index, IndexManager};`
pub use index::{FileEntry, Index};
pub use manager::IndexManager;
pub use path::PathKey;

// Optional: a focused prelude for FS pieces only.
// Consumers can `use conduit_core::fs::prelude::*;`
pub mod prelude {
    pub use super::{Index, IndexManager, PathKey};
}
