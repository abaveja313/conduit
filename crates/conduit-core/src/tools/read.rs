//! Read tool for extracting exact line ranges from files.

use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::tools::line_index::LineIndex;
use serde::{Deserialize, Serialize};

/// Request to read specific lines from a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadRequest {
    /// Path to the file to read
    pub path: PathKey,
    /// Starting line number (1-based, inclusive)
    pub start_line: usize,
    /// Ending line number (1-based, inclusive)
    pub end_line: usize,
}

/// Response containing the requested file content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResponse {
    /// Path to the file
    pub path: PathKey,
    /// Actual start line returned (may differ if clamped to file bounds)
    pub start_line: usize,
    /// Actual end line returned (may differ if clamped to file bounds)
    pub end_line: usize,
    /// The extracted content
    pub content: String,
    /// Total number of lines in the file
    pub total_lines: usize,
}

impl ReadRequest {
    pub fn new(path: PathKey, start_line: usize, end_line: usize) -> Self {
        Self {
            path,
            start_line,
            end_line,
        }
    }

    /// Validate the request parameters.
    pub fn validate(&self) -> Result<()> {
        if self.start_line == 0 {
            return Err(Error::InvalidRange(self.start_line, self.end_line));
        }

        if self.start_line > self.end_line {
            return Err(Error::InvalidRange(self.start_line, self.end_line));
        }

        Ok(())
    }
}

/// Extract exact line range from file content.
pub fn extract_lines(
    path: PathKey,
    content: &[u8],
    start_line: usize,
    end_line: usize,
) -> Result<ReadResponse> {
    // Build line index
    let line_index = LineIndex::build(content);
    let total_lines = line_index.line_count();

    // Validate and clamp line range
    if start_line == 0 || start_line > total_lines || start_line > end_line {
        return Err(Error::InvalidRange(start_line, end_line));
    }

    // Clamp end line to file bounds
    let actual_end = end_line.min(total_lines);

    // Get byte range for the requested lines
    let byte_range = line_index
        .span_of_lines(start_line, actual_end)
        .ok_or(Error::InvalidRange(start_line, actual_end))?;

    // Extract content
    let content_bytes = &content[byte_range.to_range()];
    let content = String::from_utf8_lossy(content_bytes).into_owned();

    Ok(ReadResponse {
        path,
        start_line,
        end_line: actual_end,
        content,
        total_lines,
    })
}
