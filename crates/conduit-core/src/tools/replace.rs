//! replace.rs — build and apply a staged replace plan over an in-memory buffer.

//! Notes:
//!   - Matches are gathered non-overlapping per the regex engine; we still sort+filter globally
//!     to guarantee a non-overlapping plan across regions.
//!   - `line_shift` is (# '\n' in replacement) − (# '\n' in original span). This is useful
//!     when composing previews or updating external line metadata after apply.

use crate::error::Result;
use crate::tools::abort::AbortFlag;
use crate::tools::matcher::RegexMatcher;
use crate::tools::model::ByteSpan;
use crate::tools::search::{search_regions, MatchRegion};
use memchr::memchr_iter;

/// One concrete edit to apply to the haystack.
#[derive(Debug, Clone)]
pub struct EditOp {
    /// Absolute byte range to replace (half-open).
    pub span: ByteSpan,
    /// Replacement bytes for this span.
    pub replacement: Vec<u8>,
    /// Net line delta introduced by this op: newlines(replacement) − newlines(original).
    pub line_shift: isize,
}

/// A set of non-overlapping, start-sorted edits.
#[derive(Debug, Clone, Default)]
pub struct ReplacePlan {
    pub ops: Vec<EditOp>,
}

impl ReplacePlan {
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }
}

#[inline]
fn count_newlines(bytes: &[u8]) -> usize {
    memchr_iter(b'\n', bytes).count()
}

/// Build a replace plan over `haystack`.
///
/// Returns a **non-overlapping, start-sorted** plan.
pub fn plan_in_bytes(
    haystack: &[u8],
    re: &RegexMatcher,
    replacement_tpl: &str,
    allow_multiline_matches: bool,
    abort: &AbortFlag,
) -> Result<ReplacePlan> {
    let mut ops: Vec<EditOp> = Vec::new();

    search_regions(
        haystack,
        re,
        allow_multiline_matches,
        abort,
        |region: MatchRegion<'_>| -> Result<bool> {
            let mut matches = Vec::new();
            re.find_matches(region.bytes, |span| {
                if abort.is_aborted() {
                    return false;
                }
                matches.push(span);
                true
            })?;

            // Now process each match and expand replacements
            let mut tmp = Vec::<u8>::with_capacity(128);
            for span in matches {
                tmp.clear();
                match re.replace_at(region.bytes, span.start, replacement_tpl, &mut tmp) {
                    Ok(replaced) => {
                        if replaced {
                            let abs = ByteSpan {
                                start: region.byte_offset + span.start,
                                end: region.byte_offset + span.end,
                            };

                            let old = &region.bytes[span.start..span.end];
                            let line_shift =
                                count_newlines(&tmp) as isize - count_newlines(old) as isize;

                            ops.push(EditOp {
                                span: abs,
                                replacement: tmp.clone(),
                                line_shift,
                            });
                        }
                    }
                    Err(e) => return Err(e),
                }
            }

            Ok(true)
        },
    )?;

    // Globally sort and drop overlaps (keep the earliest, left-to-right).
    if ops.len() > 1 {
        ops.sort_by_key(|op| op.span.start);
        let mut filtered = Vec::with_capacity(ops.len());
        let mut last_end = 0usize;
        for op in ops.into_iter() {
            if op.span.start >= last_end {
                last_end = op.span.end;
                filtered.push(op);
            }
        }
        Ok(ReplacePlan { ops: filtered })
    } else {
        Ok(ReplacePlan { ops })
    }
}

/// Apply a previously built plan to `haystack` in a single pass.
///
/// If the plan is empty, returns a clone of the input.
pub fn apply_plan(haystack: &[u8], plan: &ReplacePlan) -> Vec<u8> {
    if plan.ops.is_empty() {
        return haystack.to_vec();
    }

    // Capacity heuristic: grow only by net positive deltas.
    let mut cap = haystack.len();
    for op in &plan.ops {
        let old_len = op.span.end - op.span.start;
        if op.replacement.len() > old_len {
            cap += op.replacement.len() - old_len;
        }
    }
    let mut out = Vec::with_capacity(cap);

    let mut cursor = 0usize;
    for op in &plan.ops {
        if op.span.start > cursor {
            out.extend_from_slice(&haystack[cursor..op.span.start]);
        }
        out.extend_from_slice(&op.replacement);
        cursor = op.span.end;
    }

    if cursor < haystack.len() {
        out.extend_from_slice(&haystack[cursor..]);
    }
    out
}
