//! AST-based search functionality using tree-sitter.
//!
//! This module provides structural code search capabilities across multiple languages,
//! enabling pattern-based searches that understand code syntax and structure.

use std::sync::Arc;
use tree_sitter::{Language, Parser, Tree};
use crate::error::{Error, Result};
use crate::fs::PathKey;

pub mod language;
pub mod search;
pub mod cache;
pub mod pattern;

pub use language::{SupportedLanguage, LanguageConfig};
pub use search::{AstSearcher, AstQuery, AstMatch};
pub use cache::ParseTreeCache;
pub use pattern::{Pattern, PatternMatcher};

/// Parse tree wrapper that holds the parsed AST and its metadata.
#[derive(Clone)]
pub struct ParseTree {
    /// The tree-sitter parse tree
    tree: Arc<Tree>,
    /// The original source code
    source: Arc<[u8]>,
    /// The language used for parsing
    language: SupportedLanguage,
    /// Path of the source file
    path: PathKey,
}

impl ParseTree {
    /// Create a new parse tree from source code.
    pub fn parse(
        source: Arc<[u8]>,
        language: SupportedLanguage,
        path: PathKey,
    ) -> Result<Self> {
        let mut parser = Parser::new();
        let ts_language = language.tree_sitter_language();
        
        parser.set_language(ts_language)
            .map_err(|e| Error::ParseError(format!("Failed to set language: {}", e)))?;
        
        let tree = parser.parse(&source[..], None)
            .ok_or_else(|| Error::ParseError("Failed to parse source code".into()))?;
        
        Ok(Self {
            tree: Arc::new(tree),
            source,
            language,
            path,
        })
    }
    
    /// Get the root node of the parse tree.
    pub fn root_node(&self) -> tree_sitter::Node {
        self.tree.root_node()
    }
    
    /// Get the source code.
    pub fn source(&self) -> &[u8] {
        &self.source
    }
    
    /// Get the language.
    pub fn language(&self) -> SupportedLanguage {
        self.language
    }
    
    /// Get the file path.
    pub fn path(&self) -> &PathKey {
        &self.path
    }
    
    /// Get the source as a string (if valid UTF-8).
    pub fn source_str(&self) -> Result<&str> {
        std::str::from_utf8(&self.source)
            .map_err(|e| Error::ParseError(format!("Invalid UTF-8 in source: {}", e)))
    }
}

/// Statistics about AST operations.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct AstStats {
    /// Number of files parsed
    pub files_parsed: usize,
    /// Number of parse trees cached
    pub trees_cached: usize,
    /// Total parsing time in milliseconds
    pub parse_time_ms: u64,
    /// Total search time in milliseconds
    pub search_time_ms: u64,
    /// Cache hit rate (0.0 to 1.0)
    pub cache_hit_rate: f64,
}