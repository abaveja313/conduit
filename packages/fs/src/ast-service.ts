import * as wasm from '@conduit/wasm';
import type { 
  AstQuery, 
  AstMatch, 
  AstStats, 
  SupportedLanguage,
  PatternTemplates 
} from '@conduit/wasm/ast';
import { createLogger, ErrorCodes, wrapError } from '@conduit/shared';

const logger = createLogger('ast-service');

/**
 * Service for performing AST-based structural code searches using tree-sitter.
 */
export class AstService {
  private initialized = false;
  private parsedLanguages = new Set<SupportedLanguage>();

  /**
   * Initialize the AST service and parse indexed files.
   */
  async initialize(options?: {
    languages?: SupportedLanguage[];
    maxFiles?: number;
  }): Promise<number> {
    try {
      // Ensure WASM is initialized
      if (!this.initialized) {
        try {
          wasm.ping();
        } catch {
          await wasm.default();
          wasm.init();
        }
        this.initialized = true;
      }

      // Parse files for specified languages
      let totalParsed = 0;
      const languages = options?.languages || this.getSupportedLanguages();
      
      for (const lang of languages) {
        const parsed = wasm.parse_indexed_files(lang, options?.maxFiles);
        totalParsed += parsed;
        this.parsedLanguages.add(lang);
        logger.info(`Parsed ${parsed} ${lang} files`);
      }

      logger.info(`AST service initialized with ${totalParsed} parsed files`);
      return totalParsed;
    } catch (error) {
      throw wrapError(error, ErrorCodes.WASM_EXECUTION_ERROR, {
        operation: 'ast-initialize'
      });
    }
  }

  /**
   * Search for patterns in parsed files.
   */
  async search(query: AstQuery): Promise<AstMatch[]> {
    if (!this.initialized) {
      throw new Error('AST service not initialized. Call initialize() first.');
    }

    try {
      const queryJson = JSON.stringify(query);
      const results = wasm.ast_search(queryJson);
      
      logger.debug(`AST search found ${results.length} matches`, { query });
      return results;
    } catch (error) {
      throw wrapError(error, ErrorCodes.SEARCH_ERROR, {
        operation: 'ast-search',
        pattern: query.pattern
      });
    }
  }

  /**
   * Search for function definitions.
   */
  async findFunctions(options?: {
    language?: SupportedLanguage;
    maxResults?: number;
  }): Promise<AstMatch[]> {
    const templates = this.getPatternTemplates(options?.language || 'javascript');
    return this.search({
      pattern: templates.functionDefinition,
      language: options?.language,
      maxResults: options?.maxResults,
      contextLines: 2
    });
  }

  /**
   * Search for class definitions.
   */
  async findClasses(options?: {
    language?: SupportedLanguage;
    maxResults?: number;
  }): Promise<AstMatch[]> {
    const templates = this.getPatternTemplates(options?.language || 'javascript');
    return this.search({
      pattern: templates.classDefinition,
      language: options?.language,
      maxResults: options?.maxResults,
      contextLines: 2
    });
  }

  /**
   * Search for imports.
   */
  async findImports(options?: {
    language?: SupportedLanguage;
    maxResults?: number;
  }): Promise<AstMatch[]> {
    const templates = this.getPatternTemplates(options?.language || 'javascript');
    return this.search({
      pattern: templates.imports,
      language: options?.language,
      maxResults: options?.maxResults,
      contextLines: 0
    });
  }

  /**
   * Search for specific identifier usage.
   */
  async findIdentifier(
    identifier: string,
    options?: {
      language?: SupportedLanguage;
      maxResults?: number;
    }
  ): Promise<AstMatch[]> {
    // Create a pattern to find the identifier
    const pattern = `(identifier) @id (#eq? @id "${identifier}")`;
    
    return this.search({
      pattern,
      language: options?.language,
      maxResults: options?.maxResults,
      contextLines: 2
    });
  }

  /**
   * Parse a single file for AST search.
   */
  async parseFile(path: string, content: Uint8Array, language: SupportedLanguage): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const success = wasm.parse_file(path, content, language);
      if (success) {
        logger.debug(`Successfully parsed file: ${path}`);
      } else {
        logger.warn(`Failed to parse file: ${path}`);
      }
      return success;
    } catch (error) {
      throw wrapError(error, ErrorCodes.PARSE_ERROR, {
        operation: 'parse-file',
        path,
        language
      });
    }
  }

  /**
   * Get statistics about the AST service.
   */
  getStats(): AstStats {
    if (!this.initialized) {
      return {
        cacheHits: 0,
        cacheMisses: 0,
        cachedTrees: 0,
        cacheMemoryUsage: 0,
        hitRate: 0,
        totalFiles: 0
      };
    }

    return wasm.get_ast_stats();
  }

  /**
   * Clear the parse tree cache.
   */
  clearCache(): void {
    if (this.initialized) {
      wasm.clear_ast_cache();
      this.parsedLanguages.clear();
      logger.info('AST cache cleared');
    }
  }

  /**
   * Get supported languages.
   */
  getSupportedLanguages(): SupportedLanguage[] {
    if (!this.initialized) {
      return ['javascript', 'typescript', 'rust', 'python', 'go', 'java'];
    }
    return wasm.get_supported_languages() as SupportedLanguage[];
  }

  /**
   * Get pattern templates for a language.
   */
  getPatternTemplates(language: SupportedLanguage): PatternTemplates {
    if (!this.initialized) {
      // Return empty templates if not initialized
      return {
        functionDefinition: '',
        classDefinition: '',
        imports: '',
        variableDeclaration: ''
      };
    }
    
    return wasm.get_pattern_templates(language);
  }

  /**
   * Check if a language has been parsed.
   */
  isLanguageParsed(language: SupportedLanguage): boolean {
    return this.parsedLanguages.has(language);
  }

  /**
   * Get languages that have been parsed.
   */
  getParsedLanguages(): SupportedLanguage[] {
    return Array.from(this.parsedLanguages);
  }
}

// Export singleton instance
export const astService = new AstService();