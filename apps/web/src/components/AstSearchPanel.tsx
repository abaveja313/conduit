'use client';

import { useState, useCallback, useEffect } from 'react';
import { astService } from '@conduit/fs';
import type { AstQuery, AstMatch, AstStats, SupportedLanguage, PatternTemplates } from '@conduit/fs';

interface AstSearchPanelProps {
  onMatchSelect?: (match: AstMatch) => void;
  className?: string;
}

export default function AstSearchPanel({ onMatchSelect, className = '' }: AstSearchPanelProps) {
  const [initialized, setInitialized] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<AstMatch[]>([]);
  const [stats, setStats] = useState<AstStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Search parameters
  const [searchMode, setSearchMode] = useState<'pattern' | 'template'>('template');
  const [pattern, setPattern] = useState('');
  const [templateType, setTemplateType] = useState<'function' | 'class' | 'import' | 'variable'>('function');
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage | 'all'>('all');
  const [maxResults, setMaxResults] = useState(100);
  const [contextLines, setContextLines] = useState(2);
  
  // Available languages
  const languages = astService.getSupportedLanguages();
  const [templates, setTemplates] = useState<PatternTemplates | null>(null);
  const [parsedLanguages, setParsedLanguages] = useState<SupportedLanguage[]>([]);

  // Initialize AST service
  const initialize = useCallback(async () => {
    if (initialized || initializing) return;
    
    setInitializing(true);
    setError(null);
    
    try {
      const languagesToParse = selectedLanguage === 'all' 
        ? languages 
        : [selectedLanguage];
      
      const parsed = await astService.initialize({
        languages: languagesToParse,
        maxFiles: 1000
      });
      
      setInitialized(true);
      setParsedLanguages(astService.getParsedLanguages());
      updateStats();
      
      console.log(`AST service initialized with ${parsed} parsed files`);
    } catch (err) {
      console.error('Failed to initialize AST service:', err);
      setError(`Failed to initialize: ${err}`);
    } finally {
      setInitializing(false);
    }
  }, [selectedLanguage]);

  // Update statistics
  const updateStats = useCallback(() => {
    const newStats = astService.getStats();
    setStats(newStats);
  }, []);

  // Load pattern templates when language changes
  useEffect(() => {
    if (selectedLanguage !== 'all') {
      const newTemplates = astService.getPatternTemplates(selectedLanguage);
      setTemplates(newTemplates);
    }
  }, [selectedLanguage]);

  // Perform search
  const performSearch = useCallback(async () => {
    if (!initialized) {
      await initialize();
    }
    
    setSearching(true);
    setError(null);
    setMatches([]);
    
    try {
      let query: AstQuery;
      
      if (searchMode === 'pattern') {
        // Custom pattern search
        query = {
          pattern,
          language: selectedLanguage !== 'all' ? selectedLanguage : undefined,
          maxResults,
          contextLines
        };
      } else {
        // Template-based search
        if (!templates || selectedLanguage === 'all') {
          setError('Please select a specific language for template search');
          return;
        }
        
        const templatePattern = templates[
          templateType === 'function' ? 'functionDefinition' :
          templateType === 'class' ? 'classDefinition' :
          templateType === 'import' ? 'imports' :
          'variableDeclaration'
        ];
        
        query = {
          pattern: templatePattern,
          language: selectedLanguage,
          maxResults,
          contextLines
        };
      }
      
      const results = await astService.search(query);
      setMatches(results);
      updateStats();
      
      console.log(`Found ${results.length} matches`);
    } catch (err) {
      console.error('Search failed:', err);
      setError(`Search failed: ${err}`);
    } finally {
      setSearching(false);
    }
  }, [initialized, initialize, searchMode, pattern, templateType, selectedLanguage, maxResults, contextLines, templates]);

  // Handle match selection
  const handleMatchClick = useCallback((match: AstMatch) => {
    if (onMatchSelect) {
      onMatchSelect(match);
    }
  }, [onMatchSelect]);

  // Clear cache
  const clearCache = useCallback(() => {
    astService.clearCache();
    setInitialized(false);
    setMatches([]);
    setParsedLanguages([]);
    updateStats();
  }, [updateStats]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-lg font-semibold mb-4">AST-Based Code Search</h2>
        
        {/* Status */}
        <div className="flex items-center gap-4 mb-4 text-sm">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${initialized ? 'bg-green-500' : initializing ? 'bg-yellow-500 animate-pulse' : 'bg-gray-400'}`} />
            <span>{initialized ? 'Ready' : initializing ? 'Initializing...' : 'Not initialized'}</span>
          </div>
          {stats && (
            <>
              <span>Trees: {stats.cachedTrees}</span>
              <span>Cache Hit Rate: {(stats.hitRate * 100).toFixed(1)}%</span>
            </>
          )}
        </div>
        
        {/* Search Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSearchMode('template')}
            className={`px-3 py-1 rounded ${searchMode === 'template' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            Templates
          </button>
          <button
            onClick={() => setSearchMode('pattern')}
            className={`px-3 py-1 rounded ${searchMode === 'pattern' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            Custom Pattern
          </button>
        </div>
        
        {/* Search Controls */}
        <div className="space-y-3">
          {/* Language Selection */}
          <div>
            <label className="block text-sm font-medium mb-1">Language</label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage | 'all')}
              className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            >
              <option value="all">All Languages</option>
              {languages.map(lang => (
                <option key={lang} value={lang}>
                  {lang.charAt(0).toUpperCase() + lang.slice(1)}
                  {parsedLanguages.includes(lang) && ' ✓'}
                </option>
              ))}
            </select>
          </div>
          
          {/* Template Selection (when in template mode) */}
          {searchMode === 'template' && (
            <div>
              <label className="block text-sm font-medium mb-1">Template</label>
              <select
                value={templateType}
                onChange={(e) => setTemplateType(e.target.value as any)}
                className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                disabled={selectedLanguage === 'all'}
              >
                <option value="function">Function Definitions</option>
                <option value="class">Class Definitions</option>
                <option value="import">Import Statements</option>
                <option value="variable">Variable Declarations</option>
              </select>
            </div>
          )}
          
          {/* Pattern Input (when in pattern mode) */}
          {searchMode === 'pattern' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Tree-sitter Query Pattern
                <a 
                  href="https://tree-sitter.github.io/tree-sitter/using-parsers#pattern-matching-with-queries"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-blue-500 hover:underline text-xs"
                >
                  Help
                </a>
              </label>
              <textarea
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="(function_declaration name: (identifier) @name)"
                className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                rows={3}
              />
            </div>
          )}
          
          {/* Advanced Options */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Max Results</label>
              <input
                type="number"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                min={1}
                max={1000}
                className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Context Lines</label>
              <input
                type="number"
                value={contextLines}
                onChange={(e) => setContextLines(Number(e.target.value))}
                min={0}
                max={10}
                className="w-full px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={performSearch}
              disabled={searching || initializing || (searchMode === 'pattern' && !pattern)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
            {!initialized && (
              <button
                onClick={initialize}
                disabled={initializing}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
              >
                Initialize
              </button>
            )}
            <button
              onClick={clearCache}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Clear Cache
            </button>
          </div>
        </div>
        
        {/* Error Display */}
        {error && (
          <div className="mt-3 p-2 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
      
      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {matches.length > 0 ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Found {matches.length} matches
            </div>
            {matches.map((match, idx) => (
              <div
                key={idx}
                onClick={() => handleMatchClick(match)}
                className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-mono text-sm text-blue-600 dark:text-blue-400">
                    {match.path}
                  </div>
                  <div className="text-xs text-gray-500">
                    Line {match.line}, Col {match.column}
                  </div>
                </div>
                
                <div className="bg-white dark:bg-gray-800 p-2 rounded border border-gray-300 dark:border-gray-600">
                  {match.context ? (
                    <pre className="text-xs font-mono overflow-x-auto">
                      {match.context.before.map((line, i) => (
                        <div key={`before-${i}`} className="text-gray-500">
                          {line}
                        </div>
                      ))}
                      <div className="bg-yellow-100 dark:bg-yellow-900/30">
                        {match.context.line}
                      </div>
                      {match.context.after.map((line, i) => (
                        <div key={`after-${i}`} className="text-gray-500">
                          {line}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <pre className="text-xs font-mono overflow-x-auto">
                      {match.text}
                    </pre>
                  )}
                </div>
                
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                    {match.language}
                  </span>
                  <span className="text-gray-500">
                    {match.span.end - match.span.start} bytes
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : searching ? (
          <div className="text-center text-gray-500 mt-8">
            <div className="inline-block w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mb-2"></div>
            <div>Searching...</div>
          </div>
        ) : (
          <div className="text-center text-gray-500 mt-8">
            {initialized ? 'No matches found. Try a different search.' : 'Initialize the service to start searching.'}
          </div>
        )}
      </div>
    </div>
  );
}