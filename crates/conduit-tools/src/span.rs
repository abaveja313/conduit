use std::{
    cmp::{max, min},
    ops::Range,
};

use crate::error::{ToolError, ToolResult};

/// Half-open absolute byte range `[start, end)`.
///
/// Invariants:
/// - Units are **bytes**, not chars.
/// - `start <= end` always holds (empty spans are allowed).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Ord, PartialOrd)]
pub struct ByteSpan {
    pub start: usize,
    pub end: usize,
}

/// Line metadata for a matched line.
///
/// - `line` is **1-based**.
/// - `span` covers the **entire line** in bytes (half-open).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct LineSpan {
    pub line: usize,
    pub span: ByteSpan,
}

/// One concrete match found by the engine.
///
/// - `span` is the exact match bytes.
/// - `line` is the containing line (if collected).
/// - `captures`: outer `Option` = collected? inner `Option` per index = matched?
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    pub span: ByteSpan, // $0
    pub line: Option<LineSpan>,
    /// Only groups **≥ 1**; index 0 in this Vec corresponds to `$1`.
    pub captures: Option<Vec<Option<ByteSpan>>>,
}

impl ByteSpan {
    /// Create a span if `end >= start`; returns `InvalidRange` if `end < start`.
    #[inline]
    pub fn try_new(start: usize, end: usize) -> ToolResult<Self> {
        if end < start {
            return Err(ToolError::InvalidRange(start, end));
        }
        Ok(ByteSpan { start, end })
    }

    /// Length in bytes: `end - start` (0 for empty).
    #[inline]
    #[must_use]
    pub fn len(self) -> usize {
        self.end - self.start
    }

    /// True if `pos ∈ [start, end)`.
    #[inline]
    #[must_use]
    pub fn contains_offset(self, pos: usize) -> bool {
        self.start <= pos && pos < self.end
    }

    /// True if half-open intervals overlap:
    /// `self.start < other.end && other.start < self.end`.
    #[inline]
    #[must_use]
    pub fn overlaps(self, other: &ByteSpan) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// True if they are adjacent without overlap: `self.end == other.start` or vice versa.
    #[inline]
    #[must_use]
    pub fn touches(self, other: &ByteSpan) -> bool {
        self.end == other.start || other.end == self.start
    }

    /// Intersection of two spans (half-open), or `None` if disjoint or only touching.
    #[inline]
    #[must_use]
    pub fn intersection(self, other: &ByteSpan) -> Option<ByteSpan> {
        if !self.overlaps(other) {
            return None;
        }
        let start = max(self.start, other.start);
        let end = min(self.end, other.end);
        // start <= end must hold; if equal, the intersection is empty (we treat as None above).
        ByteSpan::try_new(start, end).ok()
    }

    /// Union when overlapping **or touching**; otherwise `None`.
    #[inline]
    #[must_use]
    pub fn union_closed(self, other: &ByteSpan) -> Option<ByteSpan> {
        if self.overlaps(other) || self.touches(other) {
            Some(self.join_covering(other))
        } else {
            None
        }
    }

    /// Covering join (always) — span from `min(start)` to `max(end)`.
    #[inline]
    #[must_use]
    pub fn join_covering(self, other: &ByteSpan) -> ByteSpan {
        ByteSpan {
            start: min(self.start, other.start),
            end: max(self.end, other.end),
        }
    }

    /// Clamp both ends into `[0, len]`. Returns a valid (possibly empty) span.
    #[inline]
    #[must_use]
    pub fn clamp_to_len(self, len: usize) -> ByteSpan {
        ByteSpan {
            start: min(self.start, len),
            end: min(self.end, len),
        }
    }

    /// Shift by signed `delta`, saturating at 0 on underflow.
    ///
    /// This does **not** clamp to an upper bound; call `clamp_to_len` when slicing.
    #[inline]
    #[must_use]
    pub fn shift_saturating(self, delta: isize) -> ByteSpan {
        let (mut s, mut e) = (self.start, self.end);
        if delta >= 0 {
            let d = delta as usize;
            s = s.saturating_add(d);
            e = e.saturating_add(d);
        } else {
            let d = delta.unsigned_abs();
            s = s.saturating_sub(d);
            e = e.saturating_sub(d);
        }
        ByteSpan { start: s, end: e }
    }

    /// Convert to `Range<usize>`.
    #[inline]
    #[must_use]
    pub fn to_range(self) -> Range<usize> {
        self.start..self.end
    }
}

impl TryFrom<Range<usize>> for ByteSpan {
    type Error = ToolError;

    #[inline]
    fn try_from(r: Range<usize>) -> Result<Self, Self::Error> {
        ByteSpan::try_new(r.start, r.end)
    }
}

impl From<ByteSpan> for Range<usize> {
    #[inline]
    fn from(s: ByteSpan) -> Self {
        s.start..s.end
    }
}

impl LineSpan {
    /// Construct from 1-based `line` and byte bounds; errors if `end < start`.
    #[inline]
    pub fn try_new(line: usize, byte_start: usize, byte_end: usize) -> ToolResult<Self> {
        Ok(LineSpan {
            line,
            span: ByteSpan::try_new(byte_start, byte_end)?,
        })
    }

    /// Construct from 1-based line and a pre-validated `ByteSpan`.
    #[inline]
    pub fn from_byte_span(line: usize, span: ByteSpan) -> Self {
        LineSpan { line, span }
    }

    /// Length of the line in bytes.
    #[inline]
    #[must_use]
    pub fn len(self) -> usize {
        self.span.len()
    }

    /// True if `pos` lies within the line bytes.
    #[inline]
    #[must_use]
    pub fn contains_offset(self, pos: usize) -> bool {
        self.span.contains_offset(pos)
    }

    /// Convert to `Range<usize>` of the line bytes.
    #[inline]
    #[must_use]
    pub fn to_range(self) -> Range<usize> {
        self.span.to_range()
    }

    /// Shift the line bytes by `delta` (saturating at 0).
    #[inline]
    #[must_use]
    pub fn shift_saturating(self, delta: isize) -> Self {
        LineSpan {
            line: self.line,
            span: self.span.shift_saturating(delta),
        }
    }

    /// Clamp the line bytes into `[0, len]`.
    #[inline]
    #[must_use]
    pub fn clamp_to_len(self, len: usize) -> Self {
        LineSpan {
            line: self.line,
            span: self.span.clamp_to_len(len),
        }
    }
}

impl Match {
    /// Build from the whole-match span only.
    #[inline]
    pub fn new(span: ByteSpan) -> Self {
        Match {
            span,
            line: None,
            captures: None,
        }
    }

    /// Attach line metadata (builder-style; consumes `self`).
    ///
    /// In debug builds, asserts that `self.span` lies within `line.span`.
    #[inline]
    #[must_use]
    pub fn with_line(mut self, line: LineSpan) -> Self {
        debug_assert!(line.span.start <= self.span.start && self.span.end <= line.span.end);
        self.line = Some(line);
        self
    }

    /// Mutating setter for line metadata.
    #[inline]
    pub fn set_line(&mut self, line: LineSpan) {
        debug_assert!(line.span.start <= self.span.start && self.span.end <= line.span.end);
        self.line = Some(line);
    }

    /// Attach capture spans (builder-style; consumes `self`).
    #[inline]
    #[must_use]
    pub fn with_captures(mut self, caps: Vec<Option<ByteSpan>>) -> Self {
        self.captures = Some(caps);
        self
    }

    /// Mutating setter for captures.
    #[inline]
    pub fn set_captures(&mut self, caps: Vec<Option<ByteSpan>>) {
        self.captures = Some(caps);
    }

    /// `$0` span (whole match). Prefer this over indexing captures.
    #[inline]
    #[must_use]
    pub fn whole(&self) -> ByteSpan {
        self.span
    }

    /// `$i` capture span if (a) collected and (b) this group matched.
    #[inline]
    #[must_use]
    pub fn capture(&self, i: usize) -> Option<ByteSpan> {
        self.captures
            .as_ref()
            .and_then(|caps| caps.get(i).copied().flatten())
    }

    /// True if captures were collected at all.
    #[inline]
    #[must_use]
    pub fn captures_collected(&self) -> bool {
        self.captures.is_some()
    }

    /// True if any capture group (≥1) matched.
    #[inline]
    #[must_use]
    pub fn any_group_matched(&self) -> bool {
        self.captures
            .as_ref()
            .map_or(false, |v| v.iter().skip(1).any(|c| c.is_some()))
    }

    /// Shift `span`, `line.span`, and all capture spans by `delta` (saturating).
    #[inline]
    pub fn shift_saturating(&mut self, delta: isize) {
        self.span = self.span.shift_saturating(delta);
        self.line = self.line.map(|n| n.shift_saturating(delta));

        if let Some(ref mut caps) = self.captures {
            for c in caps.iter_mut() {
                if let Some(s) = c {
                    *s = s.shift_saturating(delta);
                }
            }
        }
    }
}
