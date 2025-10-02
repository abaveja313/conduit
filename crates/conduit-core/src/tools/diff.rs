//! Line-based diffing utilities using the `similar` crate.

use crate::fs::PathKey;
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

/// A region of change in a file diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffRegion {
    /// 1-based start line in the original content.
    pub original_start: usize,
    /// Number of lines removed from the original content.
    pub lines_removed: usize,
    /// 1-based start line in the modified content.
    pub modified_start: usize,
    /// Number of lines added to the modified content.
    pub lines_added: usize,
    /// The actual lines removed from the original content.
    pub removed_lines: Vec<String>,
    /// The actual lines added to the modified content.
    pub added_lines: Vec<String>,
}

/// Summary statistics for a file diff.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiffStats {
    /// Total lines added across all regions.
    pub lines_added: usize,
    /// Total lines removed across all regions.
    pub lines_removed: usize,
    /// Total number of distinct change regions.
    pub regions_changed: usize,
}

/// A complete file diff, including stats and regions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    /// Path of the file.
    pub path: PathKey,
    /// Summary statistics for the diff.
    pub stats: DiffStats,
    /// All diff regions in the file.
    pub regions: Vec<DiffRegion>,
}

/// Compute line-based diff between two text contents using the `similar` crate
pub fn compute_diff(path: PathKey, original: &str, modified: &str) -> FileDiff {
    let diff = TextDiff::from_lines(original, modified);

    let mut regions = Vec::new();
    let mut current_region: Option<(usize, usize, Vec<String>, Vec<String>)> = None;

    let mut original_line = 1;
    let mut modified_line = 1;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                // If we have a current region, close it
                if let Some((orig_start, mod_start, removed, added)) = current_region.take() {
                    if !removed.is_empty() || !added.is_empty() {
                        regions.push(DiffRegion {
                            original_start: orig_start,
                            lines_removed: removed.len(),
                            modified_start: mod_start,
                            lines_added: added.len(),
                            removed_lines: removed,
                            added_lines: added,
                        });
                    }
                }

                // Advance both line counters for equal lines
                original_line += 1;
                modified_line += 1;
            }
            ChangeTag::Delete => {
                // Start a new region if needed, tracking the actual line where deletion starts
                let region = current_region.get_or_insert((
                    original_line,
                    modified_line,
                    Vec::new(),
                    Vec::new(),
                ));

                // Update region start if this is the first removal in this region
                if region.2.is_empty() && !region.3.is_empty() {
                    region.0 = original_line;
                }

                // Don't trim - preserve the exact line content
                let line = change.value();
                // Remove only the trailing newline if present
                let line = line.strip_suffix('\n').unwrap_or(line);
                region.2.push(line.to_string());
                original_line += 1;
            }
            ChangeTag::Insert => {
                // Start a new region if needed
                let region = current_region.get_or_insert((
                    original_line,
                    modified_line,
                    Vec::new(),
                    Vec::new(),
                ));

                // Update region start if this is the first addition in this region
                if region.3.is_empty() && region.2.is_empty() {
                    region.1 = modified_line;
                }

                // Don't trim - preserve the exact line content
                let line = change.value();
                // Remove only the trailing newline if present
                let line = line.strip_suffix('\n').unwrap_or(line);
                region.3.push(line.to_string());
                modified_line += 1;
            }
        }
    }

    // Close any remaining region
    if let Some((orig_start, mod_start, removed, added)) = current_region {
        if !removed.is_empty() || !added.is_empty() {
            regions.push(DiffRegion {
                original_start: orig_start,
                lines_removed: removed.len(),
                modified_start: mod_start,
                lines_added: added.len(),
                removed_lines: removed,
                added_lines: added,
            });
        }
    }

    // Calculate stats
    let stats = DiffStats {
        lines_added: regions.iter().map(|r| r.lines_added).sum(),
        lines_removed: regions.iter().map(|r| r.lines_removed).sum(),
        regions_changed: regions.len(),
    };

    FileDiff {
        path,
        stats,
        regions,
    }
}

/// Compute diffs for multiple files
pub fn compute_diffs(files: Vec<(PathKey, String, String)>) -> Vec<FileDiff> {
    files
        .into_iter()
        .map(|(path, original, modified)| compute_diff(path, &original, &modified))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn create_test_path(path: &str) -> PathKey {
        PathKey::from_arc(Arc::from(path))
    }

    #[test]
    fn test_simple_replacement() {
        let original = "line 1\nline 2\nline 3";
        let modified = "line 1\nline 2 modified\nline 3";

        let diff = compute_diff(create_test_path("test.txt"), original, modified);

        assert_eq!(diff.stats.lines_removed, 1);
        assert_eq!(diff.stats.lines_added, 1);
        assert_eq!(diff.stats.regions_changed, 1);

        let region = &diff.regions[0];
        assert_eq!(region.original_start, 2);
        assert_eq!(region.modified_start, 2);
        assert_eq!(region.removed_lines, vec!["line 2"]);
        assert_eq!(region.added_lines, vec!["line 2 modified"]);
    }

    #[test]
    fn test_multi_line_replacement() {
        let original = r#"SUNet ID: & [your SUNet ID] \\
Name: & [your first and last name] \\
Collaborators: & [list all the people you worked with]"#;

        let modified = r#"SUNet ID: & [Please fill in your SUNet ID] \\
Name: & [Please fill in your first and last name] \\
Collaborators: & [Please list all the people you worked with, or write "None"]"#;

        let diff = compute_diff(create_test_path("test.tex"), original, modified);

        assert_eq!(diff.stats.lines_removed, 3);
        assert_eq!(diff.stats.lines_added, 3);
        assert_eq!(diff.stats.regions_changed, 1);
    }

    #[test]
    fn test_file_deletion() {
        let original = "line 1\nline 2\nline 3";
        let modified = "";

        let diff = compute_diff(create_test_path("test.txt"), original, modified);

        assert_eq!(diff.stats.lines_removed, 3);
        assert_eq!(diff.stats.lines_added, 0);
        assert_eq!(diff.stats.regions_changed, 1);
    }

    #[test]
    fn test_file_creation() {
        let original = "";
        let modified = "line 1\nline 2\nline 3";

        let diff = compute_diff(create_test_path("test.txt"), original, modified);

        assert_eq!(diff.stats.lines_removed, 0);
        assert_eq!(diff.stats.lines_added, 3);
        assert_eq!(diff.stats.regions_changed, 1);
    }

    #[test]
    fn test_no_changes() {
        let original = "line 1\nline 2\nline 3";
        let modified = "line 1\nline 2\nline 3";

        let diff = compute_diff(create_test_path("test.txt"), original, modified);

        assert_eq!(diff.stats.lines_removed, 0);
        assert_eq!(diff.stats.lines_added, 0);
        assert_eq!(diff.stats.regions_changed, 0);
        assert_eq!(diff.regions.len(), 0);
    }

    #[test]
    fn test_consecutive_additions() {
        let path = create_test_path("test.txt");
        let original = "line 1\nline 2\nline 3";
        let modified = "line 1\nadded line A\nadded line B\nline 2\nline 3";

        let diff = compute_diff(path, original, modified);

        assert_eq!(diff.stats.lines_added, 2);
        assert_eq!(diff.stats.lines_removed, 0);
        assert_eq!(diff.regions.len(), 1);

        let region = &diff.regions[0];
        assert_eq!(region.lines_added, 2);
        assert_eq!(region.modified_start, 2); // After line 1
        assert_eq!(region.added_lines, vec!["added line A", "added line B"]);

        // Print the diff for debugging
        println!("Diff regions: {:?}", diff.regions);
    }

    #[test]
    fn test_mixed_changes() {
        let path = create_test_path("submission.py");
        let original =
            "    # TODO: Implement\n\n\ndef split_last_dim_pattern() -> str:\n    \"\"\"";
        let modified = "    # Compute x * W using einsum: (batch, d_in) * (d_in, d_out) -> (batch, d_out)\n    y = einsum(x, W, 'batch d_in, d_in d_out -> batch d_out')\n    # Add bias using broadcasting\n    y = y + b\n    return y";

        let diff = compute_diff(path, original, modified);

        println!("Original:\n{original}");
        println!("\nModified:\n{modified}");
        println!("\nDiff stats: {:?}", diff.stats);
        println!("Diff regions: {:?}", diff.regions);

        // We should see all lines removed and all new lines added
        assert!(diff.stats.lines_removed > 0);
        assert!(diff.stats.lines_added > 0);
    }

    #[test]
    fn test_submission_py_exact_case() {
        let path = create_test_path("submission.py");
        // Context around line 26
        let original = r#"    # BEGIN_YOUR_CODE
    # TODO: Implement
    # END_YOUR_CODE


def split_last_dim_pattern() -> str:"#;

        let modified = r#"    # BEGIN_YOUR_CODE
    # Compute x * W using einsum: (batch, d_in) * (d_in, d_out) -> (batch, d_out)
    y = einsum(x, W, 'batch d_in, d_in d_out -> batch d_out')
    # Add bias using broadcasting
    y = y + b
    return y
    # END_YOUR_CODE


def split_last_dim_pattern() -> str:"#;

        let diff = compute_diff(path, original, modified);

        println!("\nSubmission.py exact case:");
        let original_lines = original.lines().count();
        let modified_lines = modified.lines().count();
        println!("Original lines: {original_lines}");
        println!("Modified lines: {modified_lines}");
        println!("\nDiff stats: {:?}", diff.stats);
        println!("\nDiff regions:");
        for (i, region) in diff.regions.iter().enumerate() {
            println!("Region {i}:");
            println!(
                "  Original start: {}, lines removed: {}",
                region.original_start, region.lines_removed
            );
            println!(
                "  Modified start: {}, lines added: {}",
                region.modified_start, region.lines_added
            );
            println!("  Removed lines: {:?}", region.removed_lines);
            println!("  Added lines: {:?}", region.added_lines);
        }
    }
}
