use crate::error::Result;
use crate::tools::model::ByteSpan;

use grep_matcher::{Captures as _, Matcher};
use grep_regex::{RegexMatcher as GrepMatcher, RegexMatcherBuilder};

/// Configuration options for regex compilation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RegexEngineOpts {
    /// Case-insensitive ("i")
    pub case_insensitive: bool,
    /// Unicode classes/word boundaries
    pub unicode: bool,
    /// Whole-word matching
    pub word: bool,
    /// CRLF anchor semantics (affects ^/$ around \r\n)
    pub crlf: bool,
    /// Anchor-multiline ("m"): ^/$ match at internal line boundaries
    pub anchor_multiline: bool,
    /// Dot-all ("s"): `.` matches `\n`
    pub dot_matches_new_line: bool,
}

impl Default for RegexEngineOpts {
    fn default() -> Self {
        Self {
            case_insensitive: false,
            unicode: true,
            word: false,
            crlf: false,
            anchor_multiline: false,
            dot_matches_new_line: false,
        }
    }
}

/// Thin wrapper around `grep_regex::RegexMatcher`.
pub struct RegexMatcher {
    inner: GrepMatcher,
}

impl RegexMatcher {
    /// Compile a regex pattern into a matcher.
    pub fn compile(pattern: &str, opts: &RegexEngineOpts) -> Result<Self> {
        let mut b = RegexMatcherBuilder::new();
        b.case_insensitive(opts.case_insensitive)
            .unicode(opts.unicode)
            .word(opts.word)
            .crlf(opts.crlf)
            .multi_line(opts.anchor_multiline)
            .dot_matches_new_line(opts.dot_matches_new_line);

        let matcher = b.build(pattern)?;
        Ok(Self { inner: matcher })
    }

    /// Enumerate non-overlapping matches within `region` (relative offsets).
    ///
    /// Calls `on_match((start, end))` for each occurrence. Return `false`
    /// from the closure to stop early.
    pub fn find_in_region(
        &self,
        region: &[u8],
        mut on_match: impl FnMut((usize, usize)) -> bool,
    ) -> Result<()> {
        self.inner
            .find_iter(region, |m| on_match((m.start(), m.end())))?;
        Ok(())
    }

    /// Return capture spans ($1..$N) for the match that *begins at* `match_start`
    /// (relative to `region`). `$0` is omitted since the caller already knows it.
    ///
    /// The vector is indexed so that index 0 corresponds to `$1`, index 1 -> `$2`, etc.
    pub fn capture_spans_at(
        &self,
        region: &[u8],
        match_start: usize,
    ) -> Result<Option<Vec<Option<ByteSpan>>>> {
        let mut caps = self.inner.new_captures()?;
        let ok = self.inner.captures_at(region, match_start, &mut caps)?;
        if !ok {
            return Ok(None);
        }
        let n = caps.len();
        let mut out = Vec::with_capacity(n.saturating_sub(1));
        for i in 1..n {
            let bs = caps.get(i).map(|m| ByteSpan {
                start: m.start(),
                end: m.end(),
            });
            out.push(bs);
        }
        Ok(Some(out))
    }

    /// Expand a replacement template for the match that *begins at* `match_start`
    /// within `region`, appending the expansion to `out`.
    ///
    /// Supported forms: `$1`, `${1}`, `$name`, `${name}`, and `$$`.
    pub fn expand_captures(
        &self,
        region: &[u8],
        match_start: usize,
        replacement: &str,
        out: &mut Vec<u8>,
    ) -> Result<()> {
        let mut caps = self.inner.new_captures()?;
        if !self.inner.captures_at(region, match_start, &mut caps)? {
            return Ok(());
        }
        // Map $name → index (handles $1 and $foo).
        let mut name_to_index = |name: &str| {
            name.parse::<usize>()
                .ok()
                .or_else(|| self.inner.capture_index(name))
        };
        caps.interpolate(&mut name_to_index, region, replacement.as_bytes(), out);
        Ok(())
    }

    /// Access the underlying `grep_regex::RegexMatcher` if needed.
    #[inline]
    pub fn inner(&self) -> &GrepMatcher {
        &self.inner
    }
}
