//! Search functionality using grep-searcher.

use crate::error::Result;
use crate::tools::{abort::AbortFlag, matcher::RegexMatcher};
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
