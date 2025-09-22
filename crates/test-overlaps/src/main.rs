use grep_regex::RegexMatcherBuilder;
use grep_searcher::{SearcherBuilder, Sink, SinkMatch};

#[derive(Default)]
struct CollectingSink {
    matches: Vec<(usize, usize)>,
}

impl Sink for CollectingSink {
    type Error = Box<dyn std::error::Error>;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        let start = mat.absolute_byte_offset() as usize;
        let end = start + mat.bytes().len();
        println!(
            "Match: bytes {}..{} = {:?}",
            start,
            end,
            String::from_utf8_lossy(mat.bytes())
        );
        self.matches.push((start, end));
        Ok(true)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Test 1: Simple pattern with multiline
    println!("Test 1: Simple pattern 'world' with multiline");
    let haystack = b"hello\nworld\nworld again";
    let matcher = RegexMatcherBuilder::new().multi_line(true).build("world")?;

    let mut searcher = SearcherBuilder::new().multi_line(true).build();

    let mut sink = CollectingSink::default();
    searcher.search_slice(&matcher, haystack, &mut sink)?;

    println!("Matches found: {:?}", sink.matches);

    // Test 2: Check if regions from grep-searcher can overlap
    println!("\nTest 2: Pattern '.+' with multiline to see region boundaries");
    let haystack2 = b"line1\nline2\nline3";
    let matcher2 = RegexMatcherBuilder::new()
        .multi_line(true)
        .dot_matches_new_line(true)
        .build(r".+")?;

    let mut sink2 = CollectingSink::default();
    searcher.search_slice(&matcher2, haystack2, &mut sink2)?;

    println!("Matches found: {:?}", sink2.matches);

    // Test 3: Pattern spanning lines
    println!("\nTest 3: Pattern 'world\\n' spanning lines");
    let haystack3 = b"hello\nworld\nworld\nagain";
    let matcher3 = RegexMatcherBuilder::new()
        .multi_line(true)
        .build(r"world\n")?;

    let mut sink3 = CollectingSink::default();
    searcher.search_slice(&matcher3, haystack3, &mut sink3)?;

    println!("Matches found: {:?}", sink3.matches);

    Ok(())
}
