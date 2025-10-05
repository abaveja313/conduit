//! Line-based text operations with range support

/// Operations that can be performed on line ranges
#[derive(Debug, Clone)]
pub enum LineOperation {
    /// Replace lines from start to end (inclusive) with new content
    ReplaceRange {
        start: usize, // 1-based, inclusive
        end: usize,   // 1-based, inclusive
        content: String,
    },
    /// Delete lines from start to end (inclusive)
    DeleteRange {
        start: usize, // 1-based, inclusive
        end: usize,   // 1-based, inclusive
    },
    /// Insert content before the specified line
    InsertBefore {
        line: usize, // 1-based
        content: String,
    },
    /// Insert content after the specified line
    InsertAfter {
        line: usize, // 1-based
        content: String,
    },
}

/// Apply line operations to text content
///
/// Returns: (modified_content, lines_added, lines_removed)
pub fn apply_line_operations(
    content: &str,
    operations: Vec<LineOperation>,
) -> (String, usize, usize) {
    // Check if original content ends with a newline
    let ends_with_newline = content.ends_with('\n');

    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Sort operations by starting line (descending) to avoid index shifting issues
    let mut sorted_ops = operations;
    sorted_ops.sort_by(|a, b| {
        let a_start = match a {
            LineOperation::ReplaceRange { start, .. }
            | LineOperation::DeleteRange { start, .. } => *start,
            LineOperation::InsertBefore { line, .. } | LineOperation::InsertAfter { line, .. } => {
                *line
            }
        };
        let b_start = match b {
            LineOperation::ReplaceRange { start, .. }
            | LineOperation::DeleteRange { start, .. } => *start,
            LineOperation::InsertBefore { line, .. } | LineOperation::InsertAfter { line, .. } => {
                *line
            }
        };
        b_start.cmp(&a_start) // Descending order
    });

    let mut total_lines_added = 0;
    let mut total_lines_removed = 0;

    for operation in sorted_ops {
        match operation {
            LineOperation::ReplaceRange {
                start,
                end,
                content,
            } => {
                if start > 0 && start <= lines.len() && start <= end {
                    // Calculate how many lines to remove (inclusive range)
                    let lines_to_remove = (end - start + 1).min(lines.len() - (start - 1));
                    total_lines_removed += lines_to_remove;

                    // Remove the lines in the range
                    for _ in 0..lines_to_remove {
                        if start - 1 < lines.len() {
                            lines.remove(start - 1);
                        }
                    }

                    // Insert new content at the same position
                    if !content.is_empty() {
                        let new_lines: Vec<String> =
                            content.lines().map(|s| s.to_string()).collect();
                        total_lines_added += new_lines.len();
                        for (i, line) in new_lines.iter().enumerate() {
                            lines.insert(start - 1 + i, line.clone());
                        }
                    }
                }
            }
            LineOperation::DeleteRange { start, end } => {
                if start > 0 && start <= lines.len() && start <= end {
                    let lines_to_remove = (end - start + 1).min(lines.len() - (start - 1));
                    total_lines_removed += lines_to_remove;
                    for _ in 0..lines_to_remove {
                        if start - 1 < lines.len() {
                            lines.remove(start - 1);
                        }
                    }
                }
            }
            LineOperation::InsertBefore { line, content } => {
                if line > 0 && line <= lines.len() + 1 {
                    let new_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                    total_lines_added += new_lines.len();
                    for (i, new_line) in new_lines.iter().enumerate() {
                        lines.insert(line - 1 + i, new_line.clone());
                    }
                }
            }
            LineOperation::InsertAfter { line, content } => {
                if line > 0 && line <= lines.len() {
                    let new_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
                    total_lines_added += new_lines.len();
                    for (i, new_line) in new_lines.iter().enumerate() {
                        lines.insert(line + i, new_line.clone());
                    }
                }
            }
        }
    }

    let mut modified_content = lines.join("\n");

    // Preserve trailing newline if the original had one
    if ends_with_newline && !modified_content.is_empty() {
        modified_content.push('\n');
    }

    (modified_content, total_lines_added, total_lines_removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_single_line() {
        let content = "line 1\nline 2\nline 3";
        let ops = vec![LineOperation::ReplaceRange {
            start: 2,
            end: 2,
            content: "modified line 2".to_string(),
        }];

        let (result, added, removed) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nmodified line 2\nline 3");
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn test_replace_line_range() {
        // Test the key feature: replacing a range of lines
        let content = "line 1\nline 2\nline 3\nline 4\nline 5";
        let ops = vec![LineOperation::ReplaceRange {
            start: 2,
            end: 4,
            content: "replaced line 2\nreplaced line 3\nreplaced line 4".to_string(),
        }];

        let (result, added, removed) = apply_line_operations(content, ops);

        assert_eq!(
            result,
            "line 1\nreplaced line 2\nreplaced line 3\nreplaced line 4\nline 5"
        );
        assert_eq!(added, 3); // Added 3 new lines
        assert_eq!(removed, 3); // Removed 3 old lines
    }

    #[test]
    fn test_delete_range() {
        let content = "line 1\nline 2\nline 3\nline 4\nline 5";
        let ops = vec![LineOperation::DeleteRange { start: 2, end: 4 }];

        let (result, added, removed) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nline 5");
        assert_eq!(added, 0);
        assert_eq!(removed, 3);
    }

    #[test]
    fn test_insert_operations() {
        let content = "line 1\nline 2";

        // Test InsertBefore
        let ops = vec![LineOperation::InsertBefore {
            line: 2,
            content: "before 2".to_string(),
        }];
        let (result, _, _) = apply_line_operations(content, ops);
        assert_eq!(result, "line 1\nbefore 2\nline 2");

        // Test InsertAfter
        let ops = vec![LineOperation::InsertAfter {
            line: 1,
            content: "after 1".to_string(),
        }];
        let (result, _, _) = apply_line_operations(content, ops);
        assert_eq!(result, "line 1\nafter 1\nline 2");
    }

    #[test]
    fn test_submission_py_scenario() {
        // Test replacing lines 25-27 with implementation
        let mut lines = Vec::new();
        for i in 1..=30 {
            if i == 25 {
                lines.push("    # BEGIN_YOUR_CODE".to_string());
            } else if i == 26 {
                lines.push("    # TODO: Implement".to_string());
            } else if i == 27 {
                lines.push("    # END_YOUR_CODE".to_string());
            } else {
                lines.push(format!("line {i}"));
            }
        }
        let content = lines.join("\n");

        // Replace lines 25-27 with the implementation
        let replacement = [
            "    # BEGIN_YOUR_CODE",
            "    y = einsum(x, W, 'batch d_in, d_in d_out -> batch d_out')",
            "    y = y + b",
            "    return y",
            "    # END_YOUR_CODE",
        ]
        .join("\n");

        let ops = vec![LineOperation::ReplaceRange {
            start: 25,
            end: 27,
            content: replacement,
        }];

        let (result, added, removed) = apply_line_operations(&content, ops);

        assert!(result.contains("y = einsum"));
        assert!(result.contains("return y"));
        assert!(result.contains("line 28")); // Line after should be unchanged
        assert_eq!(added, 5); // We added 5 lines
        assert_eq!(removed, 3); // We removed 3 lines
    }

    #[test]
    fn test_preserve_trailing_newline() {
        let content = "line 1\nline 2\n";
        let ops = vec![LineOperation::ReplaceRange {
            start: 2,
            end: 2,
            content: "modified line 2".to_string(),
        }];

        let (result, _, _) = apply_line_operations(content, ops);

        assert!(result.ends_with('\n'));
        assert_eq!(result, "line 1\nmodified line 2\n");
    }
}
