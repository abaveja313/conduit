//! abort.rs — Cooperative cancellation flag
//!
//! Invariants:
//! - Cheap to clone; all clones observe the same underlying state.
//! - Setting the flag is idempotent; once aborted, it stays set until `reset()`.
//!
//! Concurrency & Memory:
//! - Lock-free and thread-safe via `AtomicBool` with `SeqCst` for clarity.
//! - No allocation after construction; operations are O(1).
//!
//! Usage:
//! - Call `abort()` from a controller; poll `is_aborted()` in hot loops or long-running tasks.
//! - Use `reset()` only when intentionally reusing the same flag instance.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Cooperative cancellation flag shared across threads.
///
/// Cloning an `AbortFlag` is cheap and preserves shared state: aborting via any
/// clone is visible to all others.
#[derive(Debug, Clone)]
pub struct AbortFlag(Arc<AtomicBool>);

impl Default for AbortFlag {
    /// Create a new, non-aborted flag.
    fn default() -> Self {
        AbortFlag(Arc::new(AtomicBool::new(false)))
    }
}

impl AbortFlag {
    #[inline]
    /// Construct a new flag in the non-aborted state.
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    /// Mark the flag as aborted.
    ///
    /// This operation is idempotent and visible to all clones.
    pub fn abort(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    #[inline]
    /// Clear the aborted state.
    ///
    /// Intended for controlled reuse of the same flag instance.
    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    #[inline]
    /// Return whether the flag has been aborted.
    ///
    /// Safe to call from hot paths; uses `SeqCst` for simple, strong ordering.
    pub fn is_aborted(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
