//! AST-based search implementation using tree-sitter patterns.

use std::sync::Arc;
use tree_sitter::{Node, QueryMatch};
use crate::error::{Error, Result};
use crate::fs::PathKey;
use crate::tools::model::ByteSpan;
use super::{ParseTree, SupportedLanguage, Pattern, PatternMatcher};

/// AST search query that can match structural patterns in code.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstQuery {
    /// The pattern to search for (ast-grep pattern syntax)
    pub pattern: String,
    /// Optional language filter
    pub language: Option<SupportedLanguage>,
    /// Maximum number of results to return
    pub max_results: Option<usize>,
    /// Include context lines around matches
    pub context_lines: usize,
}

impl AstQuery {
    /// Create a new AST query with the given pattern.
    pub fn new(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            language: None,
            max_results: None,
            context_lines: 2,
        }
    }
    
    /// Set the language filter.
    pub fn with_language(mut self, language: SupportedLanguage) -> Self {
        self.language = Some(language);
        self
    }
    
    /// Set the maximum number of results.
    pub fn with_max_results(mut self, max: usize) -> Self {
        self.max_results = Some(max);
        self
    }
    
    /// Set the number of context lines.
    pub fn with_context(mut self, lines: usize) -> Self {
        self.context_lines = lines;
        self
    }
}

/// A match found by AST search.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AstMatch {
    /// Path to the file containing the match
    pub path: PathKey,
    /// Byte span of the match in the source file
    pub span: ByteSpan,
    /// The matched text
    pub text: String,
    /// Line number where the match starts (1-based)
    pub line: usize,
    /// Column number where the match starts (1-based)
    pub column: usize,
    /// Language of the matched file
    pub language: SupportedLanguage,
    /// Optional context around the match
    pub context: Option<MatchContext>,
}

/// Context around a match for better understanding.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MatchContext {
    /// Lines before the match
    pub before: Vec<String>,
    /// The line containing the match
    pub line: String,
    /// Lines after the match
    pub after: Vec<String>,
}

/// AST searcher that can execute queries over parse trees.
pub struct AstSearcher {
    /// Cached parse trees
    trees: Vec<ParseTree>,
    /// Search configuration
    config: SearchConfig,
}

/// Configuration for AST search operations.
#[derive(Debug, Clone)]
pub struct SearchConfig {
    /// Whether to search in parallel
    pub parallel: bool,
    /// Maximum number of threads for parallel search
    pub max_threads: usize,
    /// Whether to stop on first match
    pub stop_on_first: bool,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            parallel: true,
            max_threads: 4,
            stop_on_first: false,
        }
    }
}

impl AstSearcher {
    /// Create a new AST searcher.
    pub fn new() -> Self {
        Self {
            trees: Vec::new(),
            config: SearchConfig::default(),
        }
    }
    
    /// Create a searcher with custom configuration.
    pub fn with_config(config: SearchConfig) -> Self {
        Self {
            trees: Vec::new(),
            config,
        }
    }
    
    /// Add a parse tree to search.
    pub fn add_tree(&mut self, tree: ParseTree) {
        self.trees.push(tree);
    }
    
    /// Add multiple parse trees.
    pub fn add_trees(&mut self, trees: impl IntoIterator<Item = ParseTree>) {
        self.trees.extend(trees);
    }
    
    /// Execute a search query over all added parse trees.
    pub fn search(&self, query: &AstQuery) -> Result<Vec<AstMatch>> {
        let mut results = Vec::new();
        let mut count = 0;
        
        for tree in &self.trees {
            // Skip if language filter doesn't match
            if let Some(lang) = query.language {
                if tree.language() != lang {
                    continue;
                }
            }
            
            // Create pattern matcher for this language
            let pattern = Pattern::new(&query.pattern, tree.language());
            let mut matcher = PatternMatcher::new(&pattern)?;
            
            // Find all matches in this tree
            let root = tree.root_node();
            let source = tree.source();
            let matches = matcher.find_matches(root, source);
            
            for mat in matches {
                if let Some(max) = query.max_results {
                    if count >= max {
                        return Ok(results);
                    }
                }
                
                // Get the first captured node or the root of the match
                let node = if mat.captures.len() > 0 {
                    mat.captures[0].node
                } else {
                    mat.pattern_index as usize;
                    root
                };
                
                let range = node.range();
                let span = ByteSpan::try_new(range.start_byte, range.end_byte)?;
                
                let text = node.utf8_text(source)
                    .map_err(|e| Error::ParseError(format!("Invalid UTF-8 in match: {}", e)))?
                    .to_string();
                
                let start_pos = range.start_point;
                let context = if query.context_lines > 0 {
                    Some(self.extract_context(tree, &span, query.context_lines)?)
                } else {
                    None
                };
                
                results.push(AstMatch {
                    path: tree.path().clone(),
                    span,
                    text,
                    line: start_pos.row + 1,
                    column: start_pos.column + 1,
                    language: tree.language(),
                    context,
                });
                
                count += 1;
                
                if self.config.stop_on_first {
                    return Ok(results);
                }
            }
        }
        
        Ok(results)
    }
    
    /// Extract context lines around a match.
    fn extract_context(
        &self,
        tree: &ParseTree,
        span: &ByteSpan,
        context_lines: usize,
    ) -> Result<MatchContext> {
        let source = std::str::from_utf8(tree.source())
            .map_err(|e| Error::ParseError(format!("Invalid UTF-8 in source: {}", e)))?;
        
        let lines: Vec<&str> = source.lines().collect();
        let byte_to_line = self.build_byte_to_line_map(source);
        
        let start_line = byte_to_line.get(&span.start).copied().unwrap_or(0);
        let before_start = start_line.saturating_sub(context_lines);
        let after_end = (start_line + context_lines + 1).min(lines.len());
        
        Ok(MatchContext {
            before: lines[before_start..start_line]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            line: lines.get(start_line).unwrap_or(&"").to_string(),
            after: lines[(start_line + 1)..after_end]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        })
    }
    
    /// Build a map from byte offset to line number.
    fn build_byte_to_line_map(&self, source: &str) -> std::collections::HashMap<usize, usize> {
        let mut map = std::collections::HashMap::new();
        let mut byte_offset = 0;
        
        for (line_num, line) in source.lines().enumerate() {
            for _ in 0..line.len() {
                map.insert(byte_offset, line_num);
                byte_offset += 1;
            }
            // Account for newline
            map.insert(byte_offset, line_num);
            byte_offset += 1;
        }
        
        map
    }
    
    /// Clear all parse trees from the searcher.
    pub fn clear(&mut self) {
        self.trees.clear();
    }
    
    /// Get the number of parse trees loaded.
    pub fn tree_count(&self) -> usize {
        self.trees.len()
    }
}