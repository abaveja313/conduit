//! Line-based text operations

/// Operations that can be performed on specific lines
#[derive(Debug, Clone)]
pub enum LineOperation {
    Replace(String),
    Delete,
    InsertBefore(String),
    InsertAfter(String),
}

/// Apply line operations to text content
///
/// Returns: (modified_content, lines_modified, line_delta)
pub fn apply_line_operations(
    content: &str,
    operations: Vec<(usize, LineOperation)>,
) -> (String, usize, isize) {
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Sort operations by line number (descending) to avoid index shifting
    let mut sorted_ops = operations;
    sorted_ops.sort_by(|a, b| b.0.cmp(&a.0));

    let mut lines_modified = 0;
    let mut total_delta = 0isize;

    for (line_num, operation) in sorted_ops {
        if line_num > 0 && line_num <= lines.len() {
            match operation {
                LineOperation::Replace(new_content) => {
                    lines.remove(line_num - 1);
                    if !new_content.is_empty() {
                        let new_lines: Vec<&str> = new_content.lines().collect();
                        for (i, line) in new_lines.iter().enumerate() {
                            lines.insert(line_num - 1 + i, line.to_string());
                        }
                        total_delta += new_lines.len() as isize - 1;
                    } else {
                        total_delta -= 1;
                    }
                    lines_modified += 1;
                }
                LineOperation::Delete => {
                    lines.remove(line_num - 1);
                    total_delta -= 1;
                    lines_modified += 1;
                }
                LineOperation::InsertBefore(content) => {
                    let new_lines: Vec<&str> = content.lines().collect();
                    for (i, line) in new_lines.iter().enumerate() {
                        lines.insert(line_num - 1 + i, line.to_string());
                    }
                    total_delta += new_lines.len() as isize;
                    lines_modified += 1;
                }
                LineOperation::InsertAfter(content) => {
                    let new_lines: Vec<&str> = content.lines().collect();
                    for (i, line) in new_lines.iter().enumerate() {
                        lines.insert(line_num + i, line.to_string());
                    }
                    total_delta += new_lines.len() as isize;
                    lines_modified += 1;
                }
            }
        }
    }

    let modified_content = lines.join("\n");
    (modified_content, lines_modified, total_delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_replace_single_line() {
        let content = "line 1\nline 2\nline 3";
        let ops = vec![(2, LineOperation::Replace("modified line 2".to_string()))];

        let (result, modified, delta) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nmodified line 2\nline 3");
        assert_eq!(modified, 1);
        assert_eq!(delta, 0);
    }

    #[test]
    fn test_replace_with_multiple_lines() {
        let content = "line 1\nline 2\nline 3";
        let ops = vec![(
            2,
            LineOperation::Replace("new line 2a\nnew line 2b".to_string()),
        )];

        let (result, modified, delta) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nnew line 2a\nnew line 2b\nline 3");
        assert_eq!(modified, 1);
        assert_eq!(delta, 1); // Added one extra line
    }

    #[test]
    fn test_delete_line() {
        let content = "line 1\nline 2\nline 3";
        let ops = vec![(2, LineOperation::Delete)];

        let (result, modified, delta) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nline 3");
        assert_eq!(modified, 1);
        assert_eq!(delta, -1);
    }

    #[test]
    fn test_insert_before_and_after() {
        let content = "line 1\nline 2";

        // Test InsertBefore
        let ops = vec![(2, LineOperation::InsertBefore("before 2".to_string()))];
        let (result, _, _) = apply_line_operations(content, ops);
        assert_eq!(result, "line 1\nbefore 2\nline 2");

        // Test InsertAfter
        let ops = vec![(1, LineOperation::InsertAfter("after 1".to_string()))];
        let (result, _, _) = apply_line_operations(content, ops);
        assert_eq!(result, "line 1\nafter 1\nline 2");
    }

    #[test]
    fn test_multiple_operations() {
        let content = "line 1\nline 2\nline 3\nline 4\nline 5";
        let ops = vec![
            (2, LineOperation::Delete),
            (4, LineOperation::Replace("modified line 4".to_string())),
        ];

        let (result, modified, delta) = apply_line_operations(content, ops);

        // After deleting line 2, line 4 becomes line 3, so it should be:
        assert_eq!(result, "line 1\nline 3\nmodified line 4\nline 5");
        assert_eq!(modified, 2);
        assert_eq!(delta, -1);
    }

    #[test]
    fn test_out_of_bounds_operations() {
        let content = "line 1\nline 2";
        let ops = vec![(5, LineOperation::Replace("should not work".to_string()))];

        let (result, modified, delta) = apply_line_operations(content, ops);

        assert_eq!(result, "line 1\nline 2");
        assert_eq!(modified, 0);
        assert_eq!(delta, 0);
    }
}
