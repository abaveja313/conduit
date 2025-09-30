//! replace.rs — build and apply a staged replace plan over an in-memory buffer.

use crate::error::Result;
use crate::tools::abort::AbortFlag;
use crate::tools::matcher::RegexMatcher;
use crate::tools::model::ByteSpan;
use crate::tools::search::{search_regions, MatchRegion};
use crate::Error;

/// One concrete edit to apply to the haystack.
#[derive(Debug, Clone)]
pub struct EditOp {
    /// Absolute byte range to replace (half-open).
    pub span: ByteSpan,
    /// Replacement bytes for this span.
    pub replacement: Vec<u8>,
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

/// Build a replace plan over `haystack`.
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
                        let abs = ByteSpan {
                            start: region.byte_offset + span.start,
                            end: region.byte_offset + span.end,
                        };

                        if replaced {
                            ops.push(EditOp {
                                span: abs,
                                replacement: tmp.clone(),
                            });
                        } else {
                            return Err(Error::NoReplacementFound(abs.start, abs.end));
                        }
                    }
                    Err(e) => return Err(e),
                }
            }

            Ok(true)
        },
    )?;

    // grep-searcher returns non-overlapping line-based regions, and the regex
    // engine returns non-overlapping matches within each region, so we shouldn't
    // have overlaps. This assertion verifies our assumption in debug builds.
    #[cfg(debug_assertions)]
    {
        for i in 1..ops.len() {
            if ops[i].span.start < ops[i - 1].span.end {
                panic!(
                    "Unexpected overlap: op[{}] starts at {} but op[{}] ends at {}",
                    i,
                    ops[i].span.start,
                    i - 1,
                    ops[i - 1].span.end
                );
            }
        }
    }

    Ok(ReplacePlan { ops })
}

/// Apply a previously built plan to `haystack` in a single pass.
///
/// If the plan is empty, returns a clone of the input.
pub fn apply_plan(haystack: &[u8], plan: &ReplacePlan) -> Vec<u8> {
    if plan.ops.is_empty() {
        return haystack.to_vec();
    }

    let mut out = Vec::with_capacity(haystack.len());

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
