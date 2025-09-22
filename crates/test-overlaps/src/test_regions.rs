use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{SearcherBuilder, Sink, SinkMatch};

#[derive(Default)]
struct RegionSink {
    regions: Vec<(usize, usize, String)>,
}

impl Sink for RegionSink {
    type Error = Box<dyn std::error::Error>;

    fn matched(
        &mut self,
        _searcher: &grep_searcher::Searcher,
        mat: &SinkMatch<'_>,
    ) -> Result<bool, Self::Error> {
        let start = mat.absolute_byte_offset() as usize;
        let end = start + mat.bytes().len();
        let content = String::from_utf8_lossy(mat.bytes()).to_string();
        println!(
            "Region: bytes {}..{} lines {:?} = {:?}",
            start,
            end,
            mat.line_number(),
            content
        );
        self.regions.push((start, end, content));
        Ok(true)
    }
}

pub fn test_regions() -> Result<(), Box<dyn std::error::Error>> {
    println!("Testing how grep-searcher returns regions:");

    // Test with a pattern that matches on each line
    let haystack = b"foo bar\nbar baz\nbaz foo\nbar foo baz";
    let matcher = RegexMatcherBuilder::new()
        .multi_line(false) // Line-oriented mode (default)
        .build("bar")?;

    let mut searcher = SearcherBuilder::new()
        .multi_line(false) // Line-oriented mode
        .line_number(true)
        .build();

    let mut sink = RegionSink::default();
    searcher.search_slice(&matcher, haystack, &mut sink)?;

    println!("\nRegions found:");
    for (i, (start, end, _)) in sink.regions.iter().enumerate() {
        println!("  Region {}: bytes {}..{}", i, start, end);
    }

    // Check for overlaps
    println!("\nChecking for overlaps:");
    for i in 0..sink.regions.len() {
        for j in i + 1..sink.regions.len() {
            let (s1, e1, _) = &sink.regions[i];
            let (s2, e2, _) = &sink.regions[j];
            if s2 < e1 {
                println!(
                    "  OVERLAP FOUND: Region {} ({}..{}) overlaps with Region {} ({}..{})",
                    i, s1, e1, j, s2, e2
                );
            }
        }
    }

    // Now test with multiline mode
    println!("\n\nTesting with multiline mode:");
    let matcher2 = RegexMatcherBuilder::new().multi_line(true).build("bar")?;

    let mut searcher2 = SearcherBuilder::new()
        .multi_line(true)
        .line_number(true)
        .build();

    let mut sink2 = RegionSink::default();
    searcher2.search_slice(&matcher2, haystack, &mut sink2)?;

    println!("\nRegions found:");
    for (i, (start, end, _)) in sink2.regions.iter().enumerate() {
        println!("  Region {}: bytes {}..{}", i, start, end);
    }

    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    test_regions()
}
