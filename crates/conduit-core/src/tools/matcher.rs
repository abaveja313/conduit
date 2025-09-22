//! Regex matcher using grep-regex.

use crate::error::Result;
use crate::tools::model::ByteSpan;

use grep_matcher::{Captures as _, Matcher};
use grep_regex::{RegexMatcher as GrepMatcher, RegexMatcherBuilder};

/// Regex compilation options.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RegexEngineOpts {
    /// Whether to match case insensitively.
    pub case_insensitive: bool,
    /// Whether to match unicode characters.
    pub unicode: bool,
    /// Whether to match whole words only.
    pub word: bool,
    /// Whether to match CRLF as a single line terminator.
    pub crlf: bool,
    /// Whether to match multiple lines.
    pub multiline: bool,
    /// Whether to match . (dot) to match newlines.
    pub dot_all: bool, // More standard name
}

impl Default for RegexEngineOpts {
    fn default() -> Self {
        Self {
            case_insensitive: false,
            unicode: true,
            word: false,
            crlf: false,
            multiline: false,
            dot_all: false,
        }
    }
}

/// Compiled regex matcher.
pub struct RegexMatcher {
    inner: GrepMatcher,
}

impl RegexMatcher {
    /// Compile a pattern with default options.
    pub fn new(pattern: &str) -> Result<Self> {
        Self::compile(pattern, &RegexEngineOpts::default())
    }

    /// Compile a pattern with the given options.
    pub fn compile(pattern: &str, opts: &RegexEngineOpts) -> Result<Self> {
        let matcher = RegexMatcherBuilder::new()
            .case_insensitive(opts.case_insensitive)
            .unicode(opts.unicode)
            .word(opts.word)
            .crlf(opts.crlf)
            .multi_line(opts.multiline)
            .dot_matches_new_line(opts.dot_all)
            .build(pattern)?;

        Ok(Self { inner: matcher })
    }

    /// Find all matches in a region, calling the callback for each.
    pub fn find_matches(
        &self,
        region: &[u8],
        mut on_match: impl FnMut(ByteSpan) -> bool,
    ) -> Result<()> {
        self.inner.find_iter(region, |m| {
            let span = ByteSpan {
                start: m.start(),
                end: m.end(),
            };
            on_match(span)
        })?;
        Ok(())
    }

    /// Get capture groups for a match at the given position.
    pub fn captures_at(&self, region: &[u8], start: usize) -> Result<Vec<Option<ByteSpan>>> {
        let mut caps = self.inner.new_captures()?;

        if !self.inner.captures_at(region, start, &mut caps)? {
            return Ok(Vec::new());
        }

        // Skip $0 (whole match), return $1..$N
        (1..caps.len())
            .map(|i| {
                Ok(caps.get(i).map(|m| ByteSpan {
                    start: m.start(),
                    end: m.end(),
                }))
            })
            .collect()
    }

    /// Replace all matches in a region, writing to dst.
    pub fn replace_all(&self, region: &[u8], replacement: &str, dst: &mut Vec<u8>) -> Result<()> {
        let mut caps = self.inner.new_captures()?;
        let repl_bytes = replacement.as_bytes();

        self.inner
            .replace_with_captures(region, &mut caps, dst, |caps, out| {
                // Use interpolate for full $1, ${name}, $$ support
                // Note: interpolate handles numeric refs ($1) internally
                let mut name_to_index = |name: &str| self.inner.capture_index(name);
                caps.interpolate(&mut name_to_index, region, repl_bytes, out);
                true // Continue replacing
            })?;

        Ok(())
    }

    /// Replace a single match at the given position.
    pub fn replace_at(
        &self,
        region: &[u8],
        start: usize,
        replacement: &str,
        out: &mut Vec<u8>,
    ) -> Result<bool> {
        let mut caps = self.inner.new_captures()?;

        if !self.inner.captures_at(region, start, &mut caps)? {
            return Ok(false);
        }

        // Note: interpolate handles numeric refs ($1) internally
        let mut name_to_index = |name: &str| self.inner.capture_index(name);
        caps.interpolate(&mut name_to_index, region, replacement.as_bytes(), out);
        Ok(true)
    }

    /// Access to underlying matcher for use with grep_searcher.
    pub(crate) fn as_grep_matcher(&self) -> &GrepMatcher {
        &self.inner
    }
}
