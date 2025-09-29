'use client';

import { useState, useEffect } from 'react';
import { FileService, FileScanner, astService } from '@conduit/fs';
import type { FileServiceStats, ScanOptions, FileMetadata, AstMatch } from '@conduit/fs';
import dynamic from 'next/dynamic';

// Dynamically import AST search panel to avoid SSR issues
const AstSearchPanel = dynamic(() => import('./AstSearchPanel'), { ssr: false });

interface FileInfo {
    path: string;
    size: number;
    mtime: number;
}

interface ScanProgress {
    current: number;
    total: number;
    percentage: number;
}

type WasmModule = typeof import('@conduit/wasm');

export default function FileUploader() {
    const [wasmReady, setWasmReady] = useState(false);
    const [fileService, setFileService] = useState<FileService | null>(null);
    const [wasmModule, setWasmModule] = useState<WasmModule | null>(null);
    const [scanning, setScanning] = useState(false);
    const [stats, setStats] = useState<FileServiceStats | null>(null);
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [recentFiles, setRecentFiles] = useState<FileInfo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [supportedBrowser, setSupportedBrowser] = useState(true);
    const [accessMode, setAccessMode] = useState<'read' | 'readwrite'>('read');
    const [excludePatterns, setExcludePatterns] = useState<string[]>(['node_modules', '.git', 'dist', 'build', '.next']);
    const [includePatterns, setIncludePatterns] = useState<string[]>([]);
    const [searchResults, setSearchResults] = useState<FileMetadata[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [showAstSearch, setShowAstSearch] = useState(false);
    const [selectedMatch, setSelectedMatch] = useState<AstMatch | null>(null);

    // Initialize FileService and WASM
    useEffect(() => {
        const init = async () => {
            try {
                // Check browser support for File System Access API
                if (!FileScanner.isSupported()) {
                    setSupportedBrowser(false);
                    setError('Your browser does not support the File System Access API. Please use Chrome, Edge, or another Chromium-based browser.');
                    return;
                }

                console.log('Initializing WASM module...');

                // Initialize WASM module with proper path
                const wasm = await import('@conduit/wasm');
                const wasmInit = wasm.default;

                // Initialize with the WASM file path
                await wasmInit('/workers/conduit.wasm');

                // Call the init function to set up the module
                wasm.init();

                setWasmModule(wasm);
                console.log('WASM module loaded successfully');

                // Create FileService instance
                const service = new FileService({
                    batchSize: 50,
                    onProgress: (current: number, total: number) => {
                        setScanProgress({
                            current,
                            total,
                            percentage: Math.round((current / total) * 100)
                        });
                    }
                });

                setFileService(service);
                setWasmReady(true);
                console.log('FileService and WASM module initialized successfully');
            } catch (err) {
                console.error('Failed to initialize:', err);
                setError(`Failed to initialize: ${err}`);
                setWasmReady(false);
            }
        };
        init();
    }, []);

    const selectDirectory = async () => {
        if (!fileService || !supportedBrowser) return;

        try {
            // Request directory access using File System Access API
            const directoryHandle = await window.showDirectoryPicker({
                mode: accessMode,
                startIn: 'documents',
            });

            setScanning(true);
            setError(null);
            setScanProgress(null);
            setRecentFiles([]);

            const scanOptions: ScanOptions = {
                exclude: excludePatterns,
                maxDepth: 10,
                includeHidden: false,
                maxFileSize: 10 * 1024 * 1024, // 10MB
                concurrency: 3,
            };

            // Initialize and scan the directory
            const scanStats = await fileService.initialize(directoryHandle, scanOptions);

            setStats(scanStats);
            setScanning(false);

            // Get some sample files to display
            const allMetadata = fileService.getAllMetadata();

            const sampleFiles: FileInfo[] = allMetadata.slice(0, 10).map(metadata => ({
                path: metadata.path,
                size: metadata.size,
                mtime: metadata.lastModified
            }));
            setRecentFiles(sampleFiles);

            console.log('Scan complete:', scanStats);
        } catch (err: unknown) {
            setScanning(false);
            const error = err as Error;
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                console.log('Directory selection cancelled by user');
                setError('Directory selection was cancelled');
            } else {
                console.error('Failed to scan directory:', error);
                setError(`Failed to scan directory: ${error.message || error}`);
            }
        }
    };

    const getStats = () => {
        if (!wasmModule || !stats) return;

        try {
            const fileCount = wasmModule.file_count();
            const indexStats = wasmModule.get_index_stats();

            console.log('Index stats:', indexStats);
            alert(`Index Statistics:\nTotal files indexed: ${fileCount}\nTotal scanned: ${stats.filesScanned}`);
        } catch (err) {
            setError(`Failed to get stats: ${err}`);
        }
    };

    const searchPattern = async () => {
        if (!fileService) return;

        const pattern = prompt('Enter file name pattern (e.g., *.tsx, test):');
        if (!pattern) return;

        try {
            // Filter metadata based on pattern
            const allMetadata = fileService.getAllMetadata();
            const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
            const results = allMetadata.filter(m => regex.test(m.path));

            if (results.length === 0) {
                alert('No files found matching the pattern');
                setSearchResults([]);
                setShowResults(false);
            } else {
                setSearchResults(results.slice(0, 100)); // Show first 100 results
                setShowResults(true);
            }
        } catch (err) {
            setError(`Search failed: ${err}`);
        }
    };

    const showFileInfo = (file: FileInfo) => {
        const metadata = fileService?.getMetadata(file.path);
        if (!metadata) return;

        alert(`File Information:\n
Path: ${metadata.path}
Size: ${(metadata.size / 1024).toFixed(2)} KB
Type: ${metadata.type}
Modified: ${new Date(metadata.lastModified).toLocaleString()}
${metadata.handle ? 'Handle: Available for reading' : 'Handle: Not available'}`);
    };


    const clearAll = async () => {
        if (!confirm('This will clear the current session. Are you sure?')) return;

        try {
            // Reset state
            setStats(null);
            setRecentFiles([]);
            setScanProgress(null);

            // Create new service instance for fresh start
            const service = new FileService({
                batchSize: 50,
                onProgress: (current: number, total: number) => {
                    setScanProgress({
                        current,
                        total,
                        percentage: Math.round((current / total) * 100)
                    });
                }
            });

            setFileService(service);
            console.log('Session cleared');
            setError(null);
        } catch (err) {
            setError(`Failed to clear: ${err}`);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4">File System Scanner with WASM</h2>

                {/* WASM Loading Message */}
                {!wasmReady && supportedBrowser && (
                    <div className="mb-4 p-4 bg-blue-100 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg">
                        <p className="text-blue-700 dark:text-blue-400 flex items-center gap-2">
                            <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
                            Loading WASM module... This may take a moment on first load.
                        </p>
                    </div>
                )}

                {/* Browser compatibility warning */}
                {!supportedBrowser && (
                    <div className="mb-4 p-4 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                        <p className="text-yellow-700 dark:text-yellow-400">
                            Your browser does not support the File System Access API.
                            Please use a Chromium-based browser (Chrome, Edge, Brave, etc.) to test this feature.
                        </p>
                    </div>
                )}

                {/* Status indicators */}
                <div className="flex gap-4 mb-6">
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${wasmReady ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                        <span className="text-sm">WASM {wasmReady ? 'Ready' : 'Loading...'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${scanning ? 'bg-yellow-500 animate-pulse' : 'bg-gray-400'}`} />
                        <span className="text-sm">{scanning ? 'Scanning...' : 'Idle'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm">
                            Mode: <span className="font-medium">{accessMode === 'read' ? 'Read-only' : 'Read & Write'}</span>
                        </span>
                    </div>
                    {stats && (
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                                Files Indexed: {stats.filesLoaded}/{stats.filesScanned}
                            </span>
                        </div>
                    )}
                </div>

                {/* Access Mode Selection */}
                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <label className="block text-sm font-medium mb-2">Directory Access Mode</label>
                    <div className="flex gap-4">
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="radio"
                                name="accessMode"
                                value="read"
                                checked={accessMode === 'read'}
                                onChange={(e) => setAccessMode(e.target.value as 'read')}
                                className="mr-2"
                            />
                            <div>
                                <span className="font-medium">Read-only</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">View files only (safer)</span>
                            </div>
                        </label>
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="radio"
                                name="accessMode"
                                value="readwrite"
                                checked={accessMode === 'readwrite'}
                                onChange={(e) => setAccessMode(e.target.value as 'readwrite')}
                                className="mr-2"
                            />
                            <div>
                                <span className="font-medium">Read & Write</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">View and edit files</span>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Pattern Filters - Compact */}
                <div className="mb-4 p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs text-gray-600 dark:text-gray-400">Exclude:</label>
                            <input
                                type="text"
                                value={excludePatterns.join(' ')}
                                onChange={(e) => {
                                    const patterns = e.target.value.split(' ').filter(p => p.trim());
                                    setExcludePatterns(patterns);
                                }}
                                placeholder="node_modules .git dist build .next"
                                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-gray-600 dark:text-gray-400">Include (optional):</label>
                            <input
                                type="text"
                                value={includePatterns.join(' ')}
                                onChange={(e) => {
                                    const patterns = e.target.value.split(' ').filter(p => p.trim());
                                    setIncludePatterns(patterns);
                                }}
                                placeholder="*.ts *.tsx src/**"
                                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                            />
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <button
                            onClick={selectDirectory}
                            disabled={!wasmReady || scanning || !supportedBrowser}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {scanning ? 'Scanning...' : 'Select Directory'}
                        </button>
                        <button
                            onClick={searchPattern}
                            disabled={!wasmReady || !stats || scanning}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Search Files
                        </button>
                        <button
                            onClick={() => setShowAstSearch(!showAstSearch)}
                            disabled={!wasmReady || !stats}
                            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {showAstSearch ? 'Hide' : 'Show'} AST Search
                        </button>
                        <button
                            onClick={getStats}
                            disabled={!wasmReady || !stats}
                            className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Get Stats
                        </button>
                        <button
                            onClick={clearAll}
                            disabled={!wasmReady}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Clear Session
                        </button>
                    </div>

                    {/* WASM Test Button */}
                    <div className="flex gap-4 mt-2">
                        <button
                            onClick={() => {
                                try {
                                    if (!wasmModule) {
                                        setError('WASM module not initialized');
                                        return;
                                    }
                                    const startTime = performance.now();
                                    const result = wasmModule.ping();
                                    const duration = (performance.now() - startTime).toFixed(2);
                                    console.log('WASM Ping result:', result);
                                    alert(`WASM Ping: ${result}\nResponse time: ${duration}ms`);
                                } catch (err) {
                                    console.error('WASM Ping failed:', err);
                                    setError(`WASM Ping failed: ${err}`);
                                }
                            }}
                            disabled={!wasmReady || !wasmModule}
                            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Test WASM (Ping)
                        </button>
                        <button
                            onClick={() => {
                                try {
                                    if (!wasmModule) {
                                        setError('WASM module not initialized');
                                        return;
                                    }
                                    const stats = wasmModule.get_index_stats();
                                    const count = wasmModule.file_count();
                                    console.log('WASM Stats:', { stats, count });
                                    alert(`WASM Index Stats:\nFile count: ${count}\nRaw stats: ${JSON.stringify(stats, null, 2)}`);
                                } catch (err) {
                                    console.error('WASM Stats failed:', err);
                                    setError(`WASM Stats failed: ${err}`);
                                }
                            }}
                            disabled={!wasmReady || !wasmModule}
                            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            WASM Index Stats
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                {scanning && scanProgress && (
                    <div className="mt-4">
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                            <span>Loading files to WASM...</span>
                            <span>{scanProgress.current}/{scanProgress.total} ({scanProgress.percentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${scanProgress.percentage}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Statistics */}
                {stats && !scanning && (
                    <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <h3 className="font-semibold mb-2">Scan Statistics</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>Text Files Scanned: <span className="font-mono">{stats.filesScanned}</span></div>
                            <div>Files Loaded to WASM: <span className="font-mono">{stats.filesLoaded}</span></div>
                            <div>Total Size: <span className="font-mono">{(stats.totalSize / 1024 / 1024).toFixed(2)} MB</span></div>
                            <div>Duration: <span className="font-mono">{(stats.duration / 1000).toFixed(2)}s</span></div>
                        </div>
                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300">
                            <strong>Note:</strong> Scanner is configured to only accept text files (source code, config files, markdown, etc.)
                        </div>
                    </div>
                )}

                {/* Search Results with MIME Types */}
                {showResults && searchResults.length > 0 && (
                    <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-semibold">Search Results ({searchResults.length} text files)</h3>
                            <button
                                onClick={() => setShowResults(false)}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                                    <tr>
                                        <th className="text-left p-2">File Path</th>
                                        <th className="text-left p-2">MIME Type</th>
                                        <th className="text-right p-2">Size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((file, idx) => (
                                        <tr key={idx} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
                                            <td className="p-2 font-mono text-xs truncate max-w-md" title={file.path}>
                                                {file.path}
                                            </td>
                                            <td className="p-2 text-xs">
                                                <span className={`inline-block px-2 py-1 rounded ${file.mimeType?.startsWith('text/') ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                                    file.mimeType?.includes('json') ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                                                        file.mimeType?.includes('javascript') || file.mimeType?.includes('typescript') ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                                                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                                    }`}>
                                                    {file.mimeType || 'unknown'}
                                                </span>
                                            </td>
                                            <td className="p-2 text-right font-mono text-xs">
                                                {(file.size / 1024).toFixed(1)} KB
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Error display */}
                {error && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                        <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
                    </div>
                )}

                {/* Recent files list */}
                {recentFiles.length > 0 && (
                    <div className="mt-6">
                        <h3 className="text-lg font-semibold mb-3">
                            Sample Files (showing {recentFiles.length} of {stats?.filesLoaded || 0})
                        </h3>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {recentFiles.map((file, index) => (
                                <div
                                    key={index}
                                    className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer"
                                    onClick={() => showFileInfo(file)}
                                >
                                    <div className="flex-1">
                                        <p className="font-mono text-sm">{file.path}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {(file.size / 1024).toFixed(2)} KB · Modified: {new Date(file.mtime).toLocaleString()}
                                        </p>
                                    </div>
                                    <button className="text-blue-500 hover:text-blue-600 text-sm px-2">
                                        Info
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
            
            {/* AST Search Panel */}
            {showAstSearch && stats && (
                <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                    <AstSearchPanel
                        onMatchSelect={(match) => {
                            setSelectedMatch(match);
                            console.log('Selected match:', match);
                        }}
                        className="h-[600px]"
                    />
                </div>
            )}
            
            {/* Selected Match Display */}
            {selectedMatch && (
                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <h4 className="font-semibold mb-2">Selected Match</h4>
                    <div className="text-sm space-y-1">
                        <div><strong>File:</strong> {selectedMatch.path}</div>
                        <div><strong>Line:</strong> {selectedMatch.line}, <strong>Column:</strong> {selectedMatch.column}</div>
                        <div><strong>Language:</strong> {selectedMatch.language}</div>
                        <pre className="mt-2 p-2 bg-white dark:bg-gray-800 rounded text-xs overflow-x-auto">
                            {selectedMatch.text}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}