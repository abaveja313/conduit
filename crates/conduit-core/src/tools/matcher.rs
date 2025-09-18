//! Regex matcher using grep-regex.

use crate::error::Result;
use grep_regex::RegexMatcher as GrepMatcher;

/// Configuration options for regex compilation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RegexEngineOpts {
    pub case_insensitive: bool,
    pub unicode: bool,
    pub word: bool,
    pub crlf: bool,
    pub multiline: bool,
}

impl Default for RegexEngineOpts {
    fn default() -> Self {
        Self {
            case_insensitive: false,
            unicode: true,
            word: false,
            crlf: false,
            multiline: false,
        }
    }
}

/// Compiled regex matcher.
pub struct RegexMatcher {
    inner: GrepMatcher,
}

impl RegexMatcher {
    pub fn compile(pattern: &str, opts: &RegexEngineOpts) -> Result<Self> {
        todo!()
    }

    pub fn find_in_region(
        &self,
        region: &[u8],
        on_match: &mut dyn FnMut((usize, usize)) -> bool,
    ) -> Result<()> {
        todo!()
    }

    pub fn expand_captures(
        &self,
        region: &[u8],
        replacement: &str,
        out: &mut Vec<u8>,
    ) -> Result<()> {
        todo!()
    }
}
