//! Language configuration and support for AST parsing.

use tree_sitter::Language;
use crate::error::{Error, Result};

/// Supported programming languages for AST-based search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportedLanguage {
    JavaScript,
    TypeScript,
    Rust,
    Python,
    Go,
    Java,
}

impl SupportedLanguage {
    /// Get all supported languages.
    pub fn all() -> &'static [SupportedLanguage] {
        &[
            SupportedLanguage::JavaScript,
            SupportedLanguage::TypeScript,
            SupportedLanguage::Rust,
            SupportedLanguage::Python,
            SupportedLanguage::Go,
            SupportedLanguage::Java,
        ]
    }
    
    /// Detect language from file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "js" | "mjs" | "cjs" => Some(SupportedLanguage::JavaScript),
            "jsx" => Some(SupportedLanguage::JavaScript),
            "ts" | "mts" | "cts" => Some(SupportedLanguage::TypeScript),
            "tsx" => Some(SupportedLanguage::TypeScript),
            "rs" => Some(SupportedLanguage::Rust),
            "py" | "pyw" => Some(SupportedLanguage::Python),
            "go" => Some(SupportedLanguage::Go),
            "java" => Some(SupportedLanguage::Java),
            _ => None,
        }
    }
    
    /// Get the tree-sitter language for this language.
    pub fn tree_sitter_language(&self) -> Language {
        unsafe {
            match self {
                SupportedLanguage::JavaScript => tree_sitter_javascript::LANGUAGE,
                SupportedLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TSX,
                SupportedLanguage::Rust => tree_sitter_rust::LANGUAGE,
                SupportedLanguage::Python => tree_sitter_python::LANGUAGE,
                SupportedLanguage::Go => tree_sitter_go::LANGUAGE,
                SupportedLanguage::Java => tree_sitter_java::LANGUAGE,
            }
        }
    }
    
    
    /// Get the display name for this language.
    pub fn display_name(&self) -> &'static str {
        match self {
            SupportedLanguage::JavaScript => "JavaScript",
            SupportedLanguage::TypeScript => "TypeScript",
            SupportedLanguage::Rust => "Rust",
            SupportedLanguage::Python => "Python",
            SupportedLanguage::Go => "Go",
            SupportedLanguage::Java => "Java",
        }
    }
    
    /// Get the file extensions for this language.
    pub fn extensions(&self) -> &'static [&'static str] {
        match self {
            SupportedLanguage::JavaScript => &["js", "mjs", "cjs", "jsx"],
            SupportedLanguage::TypeScript => &["ts", "tsx", "mts", "cts"],
            SupportedLanguage::Rust => &["rs"],
            SupportedLanguage::Python => &["py", "pyw"],
            SupportedLanguage::Go => &["go"],
            SupportedLanguage::Java => &["java"],
        }
    }
}

/// Configuration for language-specific AST operations.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LanguageConfig {
    /// The language
    pub language: SupportedLanguage,
    /// Whether to enable incremental parsing
    pub incremental: bool,
    /// Maximum file size to parse (in bytes)
    pub max_file_size: usize,
    /// Whether to cache parse trees
    pub cache_enabled: bool,
}

impl Default for LanguageConfig {
    fn default() -> Self {
        Self {
            language: SupportedLanguage::JavaScript,
            incremental: true,
            max_file_size: 10 * 1024 * 1024, // 10MB
            cache_enabled: true,
        }
    }
}

impl LanguageConfig {
    /// Create a new language configuration.
    pub fn new(language: SupportedLanguage) -> Self {
        Self {
            language,
            ..Default::default()
        }
    }
    
    /// Check if a file should be parsed based on its size.
    pub fn should_parse(&self, file_size: usize) -> bool {
        file_size <= self.max_file_size
    }
}