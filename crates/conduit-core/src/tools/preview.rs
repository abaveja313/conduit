//! Line-aware preview excerpts for search results.

use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::tools::line_index::LineIndex;

/// A preview excerpt showing a match with surrounding context lines.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PreviewHunk {
    pub path: PathKey,
    /// Inclusive 1-based line range for the preview.
    pub preview_start_line: usize,
    pub preview_end_line: usize,
    /// Line ranges of actual matches within the preview (for highlighting).
    /// Each tuple is (start_line, end_line) inclusive, 1-based.
    pub matched_line_ranges: Vec<(usize, usize)>,
    /// UTF-8 text excerpt, with invalid sequences replaced by �.
    pub excerpt: String,
}

/// Builds preview windows around matches with configurable context.
#[derive(Debug, Clone)]
pub struct PreviewBuilder {
    /// Number of context lines before/after the match.
    pub delta: usize,
}

impl Default for PreviewBuilder {
    fn default() -> Self {
        Self { delta: 2 }
    }
}

impl PreviewBuilder {
    pub fn new(delta: usize) -> Self {
        Self { delta }
    }

    /// Build a preview excerpt for a match.
    ///
    /// Creates a window of `match ± delta` lines, clamped to valid line bounds.
    /// Non-UTF-8 bytes are replaced with � rather than failing.
    pub fn build_hunk(
        &self,
        path: PathKey,
        line_index: &LineIndex,
        bytes: &[u8],
        match_start_line: usize,
        match_end_line: usize,
    ) -> Result<PreviewHunk> {
        // Calculate preview window with context
        let (p_start, p_end) =
            line_index.preview_window(match_start_line, match_end_line, self.delta);

        // Get byte range for the preview lines
        let byte_range = line_index
            .span_of_lines(p_start, p_end)
            .ok_or(Error::InvalidRange(p_start, p_end))?;

        // Extract and convert to UTF-8 (lossy for non-UTF-8 files)
        let excerpt_bytes = &bytes[byte_range.to_range()];
        let excerpt = String::from_utf8_lossy(excerpt_bytes).into_owned();

        Ok(PreviewHunk {
            path,
            preview_start_line: p_start,
            preview_end_line: p_end,
            matched_line_ranges: vec![(match_start_line, match_end_line)],
            excerpt,
        })
    }
}
