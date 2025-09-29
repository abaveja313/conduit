//! Cache management for parse trees to improve performance.

use std::sync::Arc;
use std::collections::HashMap;
use parking_lot::RwLock;
use crate::fs::PathKey;
use super::{ParseTree, SupportedLanguage};

/// Cache for parse trees to avoid re-parsing files.
pub struct ParseTreeCache {
    /// Cached parse trees by file path
    trees: Arc<RwLock<HashMap<PathKey, CachedTree>>>,
    /// Cache configuration
    config: CacheConfig,
    /// Cache statistics
    stats: Arc<RwLock<CacheStats>>,
}

/// A cached parse tree with metadata.
#[derive(Clone)]
struct CachedTree {
    /// The parse tree
    tree: ParseTree,
    /// Last modified time of the source file
    mtime: i64,
    /// Size of the source file
    size: u64,
    /// Number of times this tree has been accessed
    access_count: usize,
    /// Last access time (for LRU eviction)
    last_access: std::time::Instant,
}

/// Configuration for the parse tree cache.
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /// Maximum number of trees to cache
    pub max_trees: usize,
    /// Maximum total memory usage in bytes
    pub max_memory: usize,
    /// Whether to use LRU eviction
    pub use_lru: bool,
    /// Time-to-live for cached trees in seconds
    pub ttl_seconds: Option<u64>,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            max_trees: 1000,
            max_memory: 512 * 1024 * 1024, // 512MB
            use_lru: true,
            ttl_seconds: Some(3600), // 1 hour
        }
    }
}

/// Statistics about cache usage.
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Number of cache hits
    pub hits: usize,
    /// Number of cache misses
    pub misses: usize,
    /// Number of evictions
    pub evictions: usize,
    /// Current number of cached trees
    pub tree_count: usize,
    /// Current memory usage in bytes
    pub memory_usage: usize,
}

impl ParseTreeCache {
    /// Create a new parse tree cache with default configuration.
    pub fn new() -> Self {
        Self::with_config(CacheConfig::default())
    }
    
    /// Create a new parse tree cache with custom configuration.
    pub fn with_config(config: CacheConfig) -> Self {
        Self {
            trees: Arc::new(RwLock::new(HashMap::new())),
            config,
            stats: Arc::new(RwLock::new(CacheStats::default())),
        }
    }
    
    /// Get a parse tree from the cache.
    pub fn get(&self, path: &PathKey, mtime: i64, size: u64) -> Option<ParseTree> {
        let mut trees = self.trees.write();
        let mut stats = self.stats.write();
        
        if let Some(cached) = trees.get_mut(path) {
            // Check if the cached tree is still valid
            if cached.mtime == mtime && cached.size == size {
                // Check TTL if configured
                if let Some(ttl) = self.config.ttl_seconds {
                    let age = cached.last_access.elapsed().as_secs();
                    if age > ttl {
                        trees.remove(path);
                        stats.misses += 1;
                        stats.tree_count = trees.len();
                        return None;
                    }
                }
                
                // Update access metadata
                cached.access_count += 1;
                cached.last_access = std::time::Instant::now();
                
                stats.hits += 1;
                return Some(cached.tree.clone());
            } else {
                // File has changed, remove stale entry
                trees.remove(path);
                stats.tree_count = trees.len();
            }
        }
        
        stats.misses += 1;
        None
    }
    
    /// Insert a parse tree into the cache.
    pub fn insert(&self, path: PathKey, tree: ParseTree, mtime: i64, size: u64) {
        let mut trees = self.trees.write();
        let mut stats = self.stats.write();
        
        // Check if we need to evict entries
        if trees.len() >= self.config.max_trees {
            self.evict_one(&mut trees, &mut stats);
        }
        
        // Check memory usage
        let tree_memory = self.estimate_memory(&tree);
        if stats.memory_usage + tree_memory > self.config.max_memory {
            self.evict_until_memory_available(&mut trees, &mut stats, tree_memory);
        }
        
        let cached = CachedTree {
            tree,
            mtime,
            size,
            access_count: 0,
            last_access: std::time::Instant::now(),
        };
        
        trees.insert(path, cached);
        stats.tree_count = trees.len();
        stats.memory_usage += tree_memory;
    }
    
    /// Clear all cached parse trees.
    pub fn clear(&self) {
        let mut trees = self.trees.write();
        let mut stats = self.stats.write();
        
        trees.clear();
        stats.tree_count = 0;
        stats.memory_usage = 0;
        stats.evictions += trees.len();
    }
    
    /// Get cache statistics.
    pub fn stats(&self) -> CacheStats {
        self.stats.read().clone()
    }
    
    /// Get cache hit rate (0.0 to 1.0).
    pub fn hit_rate(&self) -> f64 {
        let stats = self.stats.read();
        let total = stats.hits + stats.misses;
        if total == 0 {
            0.0
        } else {
            stats.hits as f64 / total as f64
        }
    }
    
    /// Evict one entry using LRU policy.
    fn evict_one(
        &self,
        trees: &mut HashMap<PathKey, CachedTree>,
        stats: &mut CacheStats,
    ) {
        if !self.config.use_lru || trees.is_empty() {
            return;
        }
        
        // Find the least recently used entry
        let lru_key = trees
            .iter()
            .min_by_key(|(_, cached)| cached.last_access)
            .map(|(key, _)| key.clone());
        
        if let Some(key) = lru_key {
            if let Some(cached) = trees.remove(&key) {
                stats.memory_usage = stats.memory_usage.saturating_sub(self.estimate_memory(&cached.tree));
                stats.evictions += 1;
            }
        }
    }
    
    /// Evict entries until enough memory is available.
    fn evict_until_memory_available(
        &self,
        trees: &mut HashMap<PathKey, CachedTree>,
        stats: &mut CacheStats,
        required: usize,
    ) {
        while stats.memory_usage + required > self.config.max_memory && !trees.is_empty() {
            self.evict_one(trees, stats);
        }
    }
    
    /// Estimate memory usage of a parse tree.
    fn estimate_memory(&self, tree: &ParseTree) -> usize {
        // Rough estimate: source size + overhead for tree nodes
        // Tree nodes typically add 2-3x overhead
        tree.source().len() * 3
    }
}

impl Default for ParseTreeCache {
    fn default() -> Self {
        Self::new()
    }
}