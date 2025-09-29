/**
 * TypeScript definitions for AST-based search functionality in WASM
 */

export type SupportedLanguage = 
  | 'javascript'
  | 'typescript' 
  | 'rust'
  | 'python'
  | 'go'
  | 'java';

export interface AstQuery {
  /** The pattern to search for (tree-sitter query syntax) */
  pattern: string;
  /** Optional language filter */
  language?: SupportedLanguage;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Include context lines around matches */
  contextLines?: number;
}

export interface AstMatch {
  /** Path to the file containing the match */
  path: string;
  /** Byte span of the match in the source file */
  span: {
    start: number;
    end: number;
  };
  /** The matched text */
  text: string;
  /** Line number where the match starts (1-based) */
  line: number;
  /** Column number where the match starts (1-based) */
  column: number;
  /** Language of the matched file */
  language: SupportedLanguage;
  /** Optional context around the match */
  context?: {
    before: string[];
    line: string;
    after: string[];
  };
}

export interface AstStats {
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
  /** Number of cached parse trees */
  cachedTrees: number;
  /** Cache memory usage in bytes */
  cacheMemoryUsage: number;
  /** Cache hit rate (0.0 to 1.0) */
  hitRate: number;
  /** Total files in index */
  totalFiles: number;
}

export interface PatternTemplates {
  /** Pattern for finding function definitions */
  functionDefinition: string;
  /** Pattern for finding class definitions */
  classDefinition: string;
  /** Pattern for finding imports */
  imports: string;
  /** Pattern for finding variable declarations */
  variableDeclaration: string;
}

// WASM function exports
export function parse_indexed_files(
  languageFilter?: string,
  maxFiles?: number
): number;

export function ast_search(queryJson: string): AstMatch[];

export function get_ast_stats(): AstStats;

export function clear_ast_cache(): void;

export function get_supported_languages(): string[];

export function parse_file(
  path: string,
  content: Uint8Array,
  language: string
): boolean;

export function get_pattern_templates(language: string): PatternTemplates;