use crate::tools::model::ByteSpan;
use memchr::memchr_iter;

#[derive(Debug, Clone)]
pub struct LineIndex {
    // 0-based byte offsets; strictly increasing; first is always 0
    line_starts: Vec<usize>,
    total_bytes: usize,
}

impl LineIndex {
    /// Build by scanning for '\n' only. Rebuild only when bytes change.
    pub fn build(bytes: &[u8]) -> Self {
        let mut starts = Vec::with_capacity(16);
        starts.push(0);
        for nl in memchr_iter(b'\n', bytes) {
            let next = nl.saturating_add(1);
            if next < bytes.len() {
                starts.push(next);
            }
        }
        Self {
            line_starts: starts,
            total_bytes: bytes.len(),
        }
    }

    /// Build from pre-computed line starts and total bytes.
    #[inline]
    pub fn from_parts(line_starts: Vec<usize>, total_bytes: usize) -> Self {
        Self {
            line_starts,
            total_bytes,
        }
    }

    /// Accessor for the line starts.
    #[inline]
    #[must_use]
    pub fn line_starts(&self) -> &[usize] {
        &self.line_starts
    }

    /// Accessor for the total bytes.
    #[inline]
    #[must_use]
    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    /// Accessor for the line count.
    #[inline]
    #[must_use]
    pub fn line_count(&self) -> usize {
        self.line_starts.len()
    }

    /// Get the byte offset of the start of the given line (1-based)
    #[inline]
    pub fn byte_of_line_start(&self, line: usize) -> Option<usize> {
        // 1-based line numbering => index = line-1
        self.line_starts.get(line.checked_sub(1)?).copied()
    }

    /// Get the byte offset of the end of the given line (1-based)
    #[inline]
    pub fn byte_of_line_end(&self, line: usize) -> Option<usize> {
        let i = line.checked_sub(1)?;
        if i + 1 < self.line_starts.len() {
            Some(self.line_starts[i + 1])
        } else {
            Some(self.total_bytes)
        }
    }

    /// Get the byte range of the given line (1-based)
    /// Returns `None` if the line is out of range.
    #[inline]
    pub fn byte_range_of(&self, line: usize) -> Option<(usize, usize)> {
        Some((self.byte_of_line_start(line)?, self.byte_of_line_end(line)?))
    }

    /// Get the line number of the given byte (1-based)
    ///
    /// Uses binary search to obtain O(log n) performance.
    #[inline]
    pub fn line_of_byte(&self, byte: usize) -> Option<usize> {
        if byte >= self.total_bytes {
            return None;
        }
        let i = self.line_starts.partition_point(|&s| s <= byte);
        // i is count of starts <= byte ⇒ 1-based line number
        Some(i.max(1))
    }

    /// Byte span (half-open) → inclusive 1-based line range.
    #[inline]
    pub fn lines_of_span(&self, span: ByteSpan) -> Option<(usize, usize)> {
        if span.start >= span.end || span.start >= self.total_bytes {
            return None;
        }
        let end_inclusive = span.end.min(self.total_bytes).saturating_sub(1);
        Some((
            self.line_of_byte(span.start)?,
            self.line_of_byte(end_inclusive)?,
        ))
    }

    /// Inclusive 1-based line range → byte span (half-open).
    #[inline]
    pub fn span_of_lines(&self, start_line: usize, end_line: usize) -> Option<ByteSpan> {
        if start_line == 0 || end_line < start_line {
            return None;
        }
        Some(ByteSpan {
            start: self.byte_of_line_start(start_line)?,
            end: self.byte_of_line_end(end_line)?,
        })
    }

    /// Compute a preview window around a match line range, clamped to [1, line_count].
    #[inline]
    pub fn preview_window(
        &self,
        match_start_line: usize,
        match_end_line: usize,
        delta: usize,
    ) -> (usize, usize) {
        let lc = self.line_count();
        let start = match_start_line.saturating_sub(delta).max(1);
        let end = match_end_line.saturating_add(delta).min(lc);
        (start, end)
    }

    /// Display helper: content without trailing newline(s).
    #[inline]
    pub fn content_range_of_line(&self, bytes: &[u8], line: usize) -> Option<(usize, usize)> {
        let (start, mut end) = self.byte_range_of(line)?;
        if end > start && bytes[end - 1] == b'\n' {
            end -= 1;
            if end > start && bytes[end - 1] == b'\r' {
                end -= 1;
            }
        }
        Some((start, end))
    }
}
