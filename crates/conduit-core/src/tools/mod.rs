pub mod abort;
pub mod line_index;
pub mod matcher;
pub mod model;
pub mod preview;
pub mod read;
pub mod replace;
pub mod search;

pub use abort::AbortFlag;
pub use line_index::LineIndex;
pub use matcher::{RegexEngineOpts, RegexMatcher};
pub use model::{ByteSpan, LineSpan, Match};
pub use preview::{PreviewBuilder, PreviewHunk};
pub use read::{extract_lines, ReadRequest, ReadResponse};
pub use replace::{EditOp, ReplacePlan};
pub use search::{for_each_match, search_regions, MatchRegion};
pub mod prelude {
    pub use super::{
        extract_lines, AbortFlag, ByteSpan, LineIndex, LineSpan, Match, PreviewBuilder,
        PreviewHunk, ReadRequest, ReadResponse, RegexEngineOpts, RegexMatcher,
    };
}
