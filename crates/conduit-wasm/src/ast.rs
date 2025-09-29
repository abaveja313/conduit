//! WASM bindings for AST-based search functionality.

use conduit_core::ast::{
    AstMatch, AstQuery, AstSearcher, ParseTree, ParseTreeCache, Pattern, SupportedLanguage,
};
use conduit_core::fs::FileEntry;
use js_sys::Array;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;
use std::sync::Arc;

use crate::globals::{create_path_key, get_index_manager};

/// Global parse tree cache for performance.
static PARSE_TREE_CACHE: once_cell::sync::Lazy<ParseTreeCache> = 
    once_cell::sync::Lazy::new(ParseTreeCache::new);

/// Parse files in the index and prepare them for AST search.
/// Returns the number of files successfully parsed.
#[wasm_bindgen]
pub fn parse_indexed_files(
    language_filter: Option<String>,
    max_files: Option<usize>,
) -> Result<usize, JsValue> {
    let manager = get_index_manager();
    let index = manager.active_index();
    let mut parsed_count = 0;
    let mut processed = 0;
    
    // Parse language filter if provided
    let lang_filter = if let Some(lang_str) = language_filter {
        Some(parse_language(&lang_str)?)
    } else {
        None
    };
    
    // Iterate through files in the index
    for (path, entry) in index.iter_files() {
        if let Some(max) = max_files {
            if processed >= max {
                break;
            }
        }
        
        // Check if file has content
        let content = match entry.bytes() {
            Some(bytes) => bytes,
            None => continue,
        };
        
        // Detect language from extension
        let ext = entry.ext();
        let language = match SupportedLanguage::from_extension(ext) {
            Some(lang) => lang,
            None => continue,
        };
        
        // Apply language filter
        if let Some(filter) = lang_filter {
            if language != filter {
                continue;
            }
        }
        
        // Try to parse the file
        match ParseTree::parse(Arc::from(content), language, path.clone()) {
            Ok(tree) => {
                // Cache the parse tree
                PARSE_TREE_CACHE.insert(
                    path.clone(),
                    tree,
                    entry.mtime(),
                    entry.size(),
                );
                parsed_count += 1;
            }
            Err(e) => {
                // Log parse error but continue
                web_sys::console::warn_1(
                    &format!("Failed to parse {}: {}", path.as_str(), e).into()
                );
            }
        }
        
        processed += 1;
    }
    
    Ok(parsed_count)
}

/// Search for patterns in parsed files using AST queries.
/// Returns an array of matches.
#[wasm_bindgen]
pub fn ast_search(query_json: &str) -> Result<JsValue, JsValue> {
    // Parse the query
    let query: AstQuery = serde_json::from_str(query_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid query: {}", e)))?;
    
    // Create searcher and add cached trees
    let mut searcher = AstSearcher::new();
    let cache_stats = PARSE_TREE_CACHE.stats();
    
    // Get trees from cache (we'll need to modify cache to expose trees)
    // For now, re-parse from index
    let manager = get_index_manager();
    let index = manager.active_index();
    
    for (path, entry) in index.iter_files() {
        // Check if we have a cached tree
        if let Some(tree) = PARSE_TREE_CACHE.get(&path, entry.mtime(), entry.size()) {
            searcher.add_tree(tree);
        }
    }
    
    // Execute search
    let matches = searcher.search(&query)
        .map_err(|e| JsValue::from_str(&format!("Search failed: {}", e)))?;
    
    // Convert matches to JS array
    let js_array = Array::new();
    for match_result in matches {
        let js_match = to_value(&match_result)
            .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)))?;
        js_array.push(&js_match);
    }
    
    Ok(js_array.into())
}

/// Get statistics about parsed files and cache.
#[wasm_bindgen]
pub fn get_ast_stats() -> Result<JsValue, JsValue> {
    let stats = PARSE_TREE_CACHE.stats();
    let manager = get_index_manager();
    let index = manager.active_index();
    
    let obj = js_sys::Object::new();
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("cacheHits"),
        &JsValue::from(stats.hits),
    )?;
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("cacheMisses"),
        &JsValue::from(stats.misses),
    )?;
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("cachedTrees"),
        &JsValue::from(stats.tree_count),
    )?;
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("cacheMemoryUsage"),
        &JsValue::from(stats.memory_usage),
    )?;
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("hitRate"),
        &JsValue::from(PARSE_TREE_CACHE.hit_rate()),
    )?;
    
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("totalFiles"),
        &JsValue::from(index.len()),
    )?;
    
    Ok(obj.into())
}

/// Clear the parse tree cache.
#[wasm_bindgen]
pub fn clear_ast_cache() {
    PARSE_TREE_CACHE.clear();
}

/// Get supported languages as a JSON array.
#[wasm_bindgen]
pub fn get_supported_languages() -> JsValue {
    let languages: Vec<&str> = SupportedLanguage::all()
        .iter()
        .map(|lang| lang.display_name())
        .collect();
    
    to_value(&languages).unwrap_or(JsValue::NULL)
}

/// Parse a single file and return whether it was successful.
#[wasm_bindgen]
pub fn parse_file(path: &str, content: &[u8], language: &str) -> Result<bool, JsValue> {
    let path_key = create_path_key(path)
        .map_err(|e| JsValue::from_str(&format!("Invalid path: {}", e)))?;
    
    let lang = parse_language(language)?;
    
    match ParseTree::parse(Arc::from(content), lang, path_key.clone()) {
        Ok(tree) => {
            // Cache the tree with current timestamp
            let mtime = js_sys::Date::now() as i64 / 1000;
            let size = content.len() as u64;
            PARSE_TREE_CACHE.insert(path_key, tree, mtime, size);
            Ok(true)
        }
        Err(e) => {
            web_sys::console::warn_1(&format!("Parse failed: {}", e).into());
            Ok(false)
        }
    }
}

/// Helper function to parse language string.
fn parse_language(lang_str: &str) -> Result<SupportedLanguage, JsValue> {
    match lang_str.to_lowercase().as_str() {
        "javascript" | "js" => Ok(SupportedLanguage::JavaScript),
        "typescript" | "ts" => Ok(SupportedLanguage::TypeScript),
        "rust" | "rs" => Ok(SupportedLanguage::Rust),
        "python" | "py" => Ok(SupportedLanguage::Python),
        "go" => Ok(SupportedLanguage::Go),
        "java" => Ok(SupportedLanguage::Java),
        _ => Err(JsValue::from_str(&format!("Unsupported language: {}", lang_str))),
    }
}

/// Get common pattern templates for a language.
#[wasm_bindgen]
pub fn get_pattern_templates(language: &str) -> Result<JsValue, JsValue> {
    use conduit_core::ast::pattern::templates;
    
    let lang = parse_language(language)?;
    
    let obj = js_sys::Object::new();
    
    // Add function pattern
    let func_pattern = templates::function_definition(lang);
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("functionDefinition"),
        &JsValue::from_str(func_pattern.pattern()),
    )?;
    
    // Add class pattern
    let class_pattern = templates::class_definition(lang);
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("classDefinition"),
        &JsValue::from_str(class_pattern.pattern()),
    )?;
    
    // Add import pattern
    let import_pattern = templates::imports(lang);
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("imports"),
        &JsValue::from_str(import_pattern.pattern()),
    )?;
    
    // Add variable pattern
    let var_pattern = templates::variable_declaration(lang);
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("variableDeclaration"),
        &JsValue::from_str(var_pattern.pattern()),
    )?;
    
    Ok(obj.into())
}