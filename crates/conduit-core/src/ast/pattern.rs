//! Pattern matching for AST nodes using tree-sitter queries.

use tree_sitter::{Node, Query, QueryCursor, QueryMatch};
use crate::error::{Error, Result};
use super::SupportedLanguage;

/// A pattern for matching AST nodes.
#[derive(Debug, Clone)]
pub struct Pattern {
    /// The pattern string (tree-sitter query syntax)
    pattern: String,
    /// The language this pattern is for
    language: SupportedLanguage,
}

impl Pattern {
    /// Create a new pattern.
    pub fn new(pattern: impl Into<String>, language: SupportedLanguage) -> Self {
        Self {
            pattern: pattern.into(),
            language,
        }
    }
    
    /// Get the pattern string.
    pub fn pattern(&self) -> &str {
        &self.pattern
    }
    
    /// Get the language.
    pub fn language(&self) -> SupportedLanguage {
        self.language
    }
    
    /// Compile this pattern into a tree-sitter query.
    pub fn compile(&self) -> Result<Query> {
        let ts_language = self.language.tree_sitter_language();
        Query::new(&ts_language, &self.pattern)
            .map_err(|e| Error::ParseError(format!("Invalid pattern: {}", e)))
    }
}

/// Pattern matcher that can find matches in AST nodes.
pub struct PatternMatcher {
    query: Query,
    cursor: QueryCursor,
}

impl PatternMatcher {
    /// Create a new pattern matcher from a pattern.
    pub fn new(pattern: &Pattern) -> Result<Self> {
        let query = pattern.compile()?;
        let cursor = QueryCursor::new();
        Ok(Self { query, cursor })
    }
    
    /// Find all matches in the given node.
    pub fn find_matches<'a>(
        &'a mut self,
        node: Node<'a>,
        source: &'a [u8],
    ) -> impl Iterator<Item = QueryMatch<'a, 'a>> + 'a {
        self.cursor.matches(&self.query, node, source)
    }
    
    /// Check if the pattern matches anywhere in the node.
    pub fn has_match(&mut self, node: Node, source: &[u8]) -> bool {
        self.cursor.matches(&self.query, node, source).next().is_some()
    }
    
    /// Count the number of matches in the node.
    pub fn count_matches(&mut self, node: Node, source: &[u8]) -> usize {
        self.cursor.matches(&self.query, node, source).count()
    }
}

/// Common pattern templates for different languages.
pub mod templates {
    use super::*;
    
    /// Create a pattern for finding function definitions.
    pub fn function_definition(language: SupportedLanguage) -> Pattern {
        let pattern = match language {
            SupportedLanguage::JavaScript | SupportedLanguage::TypeScript => {
                r#"[
                    (function_declaration name: (identifier) @name)
                    (arrow_function)
                    (function_expression name: (identifier)? @name)
                    (method_definition key: (property_identifier) @name)
                ]"#
            }
            SupportedLanguage::Rust => {
                r#"(function_item name: (identifier) @name)"#
            }
            SupportedLanguage::Python => {
                r#"(function_definition name: (identifier) @name)"#
            }
            SupportedLanguage::Go => {
                r#"[
                    (function_declaration name: (identifier) @name)
                    (method_declaration name: (field_identifier) @name)
                ]"#
            }
            SupportedLanguage::Java => {
                r#"(method_declaration name: (identifier) @name)"#
            }
        };
        Pattern::new(pattern, language)
    }
    
    /// Create a pattern for finding class definitions.
    pub fn class_definition(language: SupportedLanguage) -> Pattern {
        let pattern = match language {
            SupportedLanguage::JavaScript | SupportedLanguage::TypeScript => {
                r#"(class_declaration name: (identifier) @name)"#
            }
            SupportedLanguage::Rust => {
                r#"[
                    (struct_item name: (type_identifier) @name)
                    (enum_item name: (type_identifier) @name)
                    (trait_item name: (type_identifier) @name)
                ]"#
            }
            SupportedLanguage::Python => {
                r#"(class_definition name: (identifier) @name)"#
            }
            SupportedLanguage::Go => {
                r#"(type_declaration (type_spec name: (type_identifier) @name))"#
            }
            SupportedLanguage::Java => {
                r#"[
                    (class_declaration name: (identifier) @name)
                    (interface_declaration name: (identifier) @name)
                ]"#
            }
        };
        Pattern::new(pattern, language)
    }
    
    /// Create a pattern for finding imports.
    pub fn imports(language: SupportedLanguage) -> Pattern {
        let pattern = match language {
            SupportedLanguage::JavaScript | SupportedLanguage::TypeScript => {
                r#"[
                    (import_statement)
                    (import_clause)
                ]"#
            }
            SupportedLanguage::Rust => {
                r#"(use_declaration)"#
            }
            SupportedLanguage::Python => {
                r#"[
                    (import_statement)
                    (import_from_statement)
                ]"#
            }
            SupportedLanguage::Go => {
                r#"(import_declaration)"#
            }
            SupportedLanguage::Java => {
                r#"(import_declaration)"#
            }
        };
        Pattern::new(pattern, language)
    }
    
    /// Create a pattern for finding variable declarations.
    pub fn variable_declaration(language: SupportedLanguage) -> Pattern {
        let pattern = match language {
            SupportedLanguage::JavaScript | SupportedLanguage::TypeScript => {
                r#"[
                    (variable_declaration)
                    (lexical_declaration)
                ]"#
            }
            SupportedLanguage::Rust => {
                r#"(let_declaration pattern: (identifier) @name)"#
            }
            SupportedLanguage::Python => {
                r#"(assignment left: (identifier) @name)"#
            }
            SupportedLanguage::Go => {
                r#"[
                    (var_declaration)
                    (short_var_declaration)
                ]"#
            }
            SupportedLanguage::Java => {
                r#"(variable_declarator name: (identifier) @name)"#
            }
        };
        Pattern::new(pattern, language)
    }
}