//! FS layer: path types, in-memory index, and the index manager
//! used by search/replace tools. Keep IO-free; all bytes are
//! already resident in memory.

pub mod index;
pub mod manager;
pub mod path;

pub use index::{FileEntry, Index};
pub use manager::{FileChangeStats, IndexManager};
pub use path::{normalize_path, PathKey};

pub mod prelude {
    pub use super::{Index, IndexManager, PathKey};
}
