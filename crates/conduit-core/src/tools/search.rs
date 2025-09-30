//! Search functionality using grep-searcher.

use crate::error::Result;
use crate::tools::{abort::AbortFlag, matcher::RegexMatcher, model::ByteSpan};
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkContext, SinkFinish, SinkMatch};

/// A matched region from grep-searcher.
#[derive(Debug)]
pub struct MatchRegion<'a> {
    /// 1-based first line number
    pub first_line: usize,
    /// The matched bytes (includes line terminators)
    pub bytes: &'a [u8],
    /// Number of lines in this region
    pub line_count: usize,
    /// Absolute byte offset in the haystack
    pub byte_offset: usize,
}

/// Search haystack for individual matches with line context.
///
/// This is a simplified interface for single-file search that yields
/// individual matches rather than regions. The callback receives:
/// - `span`: The byte span of the match in the haystack
/// - `line_start`: 1-based line number where the match starts
///
/// The callback should return Ok(true) to continue searching, Ok(false) to stop.
pub fn for_each_match(
    haystack: &[u8],
    matcher: &RegexMatcher,
    mut on_match: impl FnMut(ByteSpan, usize) -> Result<bool>,
) -> Result<()> {
    let abort = AbortFlag::new();

    search_regions(haystack, matcher, false, &abort, |region| {
        let mut continue_search = true;
        let mut error: Result<()> = Ok(());

        matcher.find_matches(region.bytes, |span| {
            // Short-circuit if we've already hit an error or stop
            if !continue_search {
                return false;
            }

            // Adjust span to absolute position in haystack
            let absolute_span = ByteSpan {
                start: region.byte_offset + span.start,
                end: region.byte_offset + span.end,
            };

            match on_match(absolute_span, region.first_line) {
                Ok(true) => true,
                Ok(false) => {
                    continue_search = false;
                    false
                }
                Err(e) => {
                    error = Err(e);
                    continue_search = false;
                    false
                }
            }
        })?;

        error?;
        Ok(continue_search)
    })
}

/// Search haystack for matching regions.
///
/// Callback returns true to continue searching, false to stop.
pub fn search_regions(
    haystack: &[u8],
    matcher: &RegexMatcher,
    multiline: bool,
    abort: &AbortFlag,
    on_region: impl FnMut(MatchRegion<'_>) -> Result<bool>,
) -> Result<()> {
    struct RegionSink<'a, F> {
        abort: &'a AbortFlag,
        on_region: F,
    }

    impl<F> Sink for RegionSink<'_, F>
    where
        F: FnMut(MatchRegion<'_>) -> Result<bool>,
    {
        type Error = crate::error::Error;

        fn matched(&mut self, _: &Searcher, m: &SinkMatch<'_>) -> Result<bool> {
            if self.abort.is_aborted() {
                return Ok(false);
            }

            let region = MatchRegion {
                first_line: m.line_number().unwrap_or(1) as usize,
                bytes: m.bytes(),
                line_count: m.lines().count(),
                byte_offset: m.absolute_byte_offset() as usize,
            };

            (self.on_region)(region)
        }

        fn context(&mut self, _: &Searcher, _: &SinkContext<'_>) -> Result<bool> {
            Ok(!self.abort.is_aborted())
        }

        fn finish(&mut self, _: &Searcher, _: &SinkFinish) -> Result<()> {
            Ok(())
        }
    }

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .multi_line(multiline)
        .build();

    let mut sink = RegionSink { abort, on_region };

    searcher.search_slice(matcher.as_grep_matcher(), haystack, &mut sink)?;

    Ok(())
}
