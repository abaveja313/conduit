pub mod abort;
pub mod line_index;
pub mod matcher;
pub mod model;
pub mod preview;

pub use abort::AbortFlag;
pub use line_index::LineIndex;
pub use matcher::{RegexEngineOpts, RegexMatcher};
pub use model::{ByteSpan, LineSpan, Match};
pub use preview::{PreviewBuilder, PreviewHunk};

pub mod prelude {
    pub use super::{
        AbortFlag, ByteSpan, LineIndex, LineSpan, Match, PreviewBuilder, PreviewHunk,
        RegexEngineOpts, RegexMatcher,
    };
}
