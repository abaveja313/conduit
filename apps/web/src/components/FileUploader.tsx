'use client';

import { useState, useEffect, useRef } from 'react';
import { FileService, FileScanner } from '@conduit/fs';
import type { FileServiceStats, ScanOptions, FileMetadata } from '@conduit/fs';
import Modal from './Modal';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';

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

type ScanPhase = 'idle' | 'selecting' | 'scanning' | 'loading' | 'complete' | 'error';

interface ScanningStats {
    filesFound: number;
    directoriesProcessed: number;
    currentPath?: string;
    startTime?: number;
    bytesProcessed?: number;
}

type WasmModule = typeof import('@conduit/wasm');

export default function FileUploader() {
    const [wasmReady, setWasmReady] = useState(false);
    const [fileService, setFileService] = useState<FileService | null>(null);
    const [wasmModule, setWasmModule] = useState<WasmModule | null>(null);
    const [scanning, setScanning] = useState(false);
    const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
    const [stats, setStats] = useState<FileServiceStats | null>(null);
    const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
    const [scanningStats, setScanningStats] = useState<ScanningStats>({
        filesFound: 0,
        directoriesProcessed: 0,
    });
    const [recentFiles, setRecentFiles] = useState<FileInfo[]>([]);
    const [showAllFiles, setShowAllFiles] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [supportedBrowser, setSupportedBrowser] = useState(true);
    const [accessMode, setAccessMode] = useState<'read' | 'readwrite'>('read');
    const [excludePatterns, setExcludePatterns] = useState<string[]>([
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
    ]);
    const [includePatterns, setIncludePatterns] = useState<string[]>([]);
    const [searchResults, setSearchResults] = useState<FileMetadata[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const filesPerPage = 10;

    // Read file modal state
    const [showReadModal, setShowReadModal] = useState(false);
    const [readPath, setReadPath] = useState('');
    const [readStartLine, setReadStartLine] = useState('1');
    const [readEndLine, setReadEndLine] = useState('10');
    const [readUseStaged, setReadUseStaged] = useState(false);
    const [readResult, setReadResult] = useState<{
        content: string;
        startLine: number;
        endLine: number;
        totalLines: number;
    } | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const codeContainerRef = useRef<HTMLElement | null>(null);

    // Modal states
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showFileInfoModal, setShowFileInfoModal] = useState(false);
    const [selectedFileInfo, setSelectedFileInfo] = useState<FileMetadata | null>(null);
    const [showWasmPingModal, setShowWasmPingModal] = useState(false);
    const [wasmPingResult, setWasmPingResult] = useState<{ result: string; duration: number } | null>(
        null,
    );
    const [showWasmStatsModal, setShowWasmStatsModal] = useState(false);
    const [wasmStats, setWasmStats] = useState<{
        count: number;
        stats: { fileCount: number };
    } | null>(null);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [searchPatternInput, setSearchPatternInput] = useState('');

    // Staging state
    const [isStaging, setIsStaging] = useState(false);
    const [stagedFiles, setStagedFiles] = useState<Array<{ path: string; content: Uint8Array }>>([]);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
    const [showStagedFilesModal, setShowStagedFilesModal] = useState(false);
    const canWrite = accessMode === 'readwrite';

    // Update elapsed time during scanning
    useEffect(() => {
        if (scanPhase === 'scanning' && scanningStats.startTime) {
            timerRef.current = setInterval(() => {
                setElapsedTime(Math.round((Date.now() - scanningStats.startTime!) / 1000));
            }, 100);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setElapsedTime(0);
        }

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, [scanPhase, scanningStats.startTime]);

    // Highlight code when readResult changes
    useEffect(() => {
        if (readResult && codeContainerRef.current) {
            Prism.highlightElement(codeContainerRef.current);
        }
    }, [readResult]);

    // Initialize FileService and WASM
    useEffect(() => {
        const init = async () => {
            try {
                if (!FileScanner.isSupported()) {
                    setSupportedBrowser(false);
                    setError(
                        'Your browser does not support the File System Access API. Please use Chrome, Edge, or another Chromium-based browser.',
                    );
                    return;
                }

                // Initialize WASM module with proper path
                const wasm = await import('@conduit/wasm');
                const wasmInit = wasm.default;

                // Initialize with the WASM file path
                await wasmInit('/workers/conduit.wasm');

                wasm.init();

                setWasmModule(wasm);

                const service = new FileService({
                    batchSize: 50,
                    onProgress: (current: number, total: number) => {
                        setScanProgress({
                            current,
                            total,
                            percentage: Math.round((current / total) * 100),
                        });
                    },
                    onScanProgress: (filesFound: number, currentPath?: string, fileSize?: number) => {
                        setScanningStats((prev) => ({
                            ...prev,
                            filesFound,
                            currentPath,
                            bytesProcessed: (prev.bytesProcessed || 0) + (fileSize || 0),
                        }));
                    },
                });

                setFileService(service);
                setWasmReady(true);
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
            // Phase 1: Selecting directory
            setScanPhase('selecting');
            setScanning(true);
            setError(null);
            setScanProgress(null);
            setRecentFiles([]);
            setScanningStats({
                filesFound: 0,
                directoriesProcessed: 0,
                startTime: Date.now(),
            });

            // Request directory access using File System Access API
            const directoryHandle = await window.showDirectoryPicker({
                mode: accessMode,
                startIn: 'documents',
            });

            // Phase 2: Scanning files
            setScanPhase('scanning');

            const scanOptions: ScanOptions = {
                exclude: excludePatterns,
                maxDepth: 10,
                includeHidden: false,
                maxFileSize: 10 * 1024 * 1024, // 10MB
                concurrency: 3,
                fileFilter: (file: File, path: string) => {
                    // Only accept text files for the demo
                    const isTextFile =
                        file.type.startsWith('text/') ||
                        file.type === 'application/json' ||
                        file.type === 'application/javascript' ||
                        file.type === 'application/typescript' ||
                        file.type === 'application/xml' ||
                        (file.type === '' &&
                            (path.endsWith('.txt') ||
                                path.endsWith('.md') ||
                                path.endsWith('.ts') ||
                                path.endsWith('.tsx') ||
                                path.endsWith('.js') ||
                                path.endsWith('.jsx') ||
                                path.endsWith('.json') ||
                                path.endsWith('.css') ||
                                path.endsWith('.html') ||
                                path.endsWith('.xml') ||
                                path.endsWith('.yaml') ||
                                path.endsWith('.yml') ||
                                path.endsWith('.toml') ||
                                path.endsWith('.rs') ||
                                path.endsWith('.go') ||
                                path.endsWith('.py') ||
                                path.endsWith('.java') ||
                                path.endsWith('.cpp') ||
                                path.endsWith('.c') ||
                                path.endsWith('.h') ||
                                path.endsWith('.sh') ||
                                path.endsWith('.bash')));
                    return isTextFile;
                },
            };

            // Phase 3: Loading to WASM (progress will be tracked by onProgress callback)
            setScanPhase('loading');

            // Initialize and scan the directory
            const scanStats = await fileService.initialize(directoryHandle, scanOptions);

            // Phase 4: Complete
            setScanPhase('complete');
            setStats(scanStats);
            setScanning(false);

            const allMetadata = fileService.getAllMetadata();

            const allFiles: FileInfo[] = allMetadata.map((metadata) => ({
                path: metadata.path,
                size: metadata.size,
                mtime: metadata.lastModified,
            }));
            setRecentFiles(allFiles);
            setCurrentPage(0); // Reset pagination when new files are loaded

            // Reset to idle after a short delay
            setTimeout(() => setScanPhase('idle'), 2000);
        } catch (err: unknown) {
            setScanning(false);
            setScanPhase('error');
            const error = err as Error;
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                setError('Directory selection was cancelled');
            } else {
                console.error('Failed to scan directory:', error);
                setError(`Failed to scan directory: ${error.message || error}`);
            }

            // Reset to idle after error
            setTimeout(() => setScanPhase('idle'), 5000);
        }
    };

    const getStats = () => {
        if (!wasmModule || !stats) return;

        try {
            setShowStatsModal(true);
        } catch (err) {
            setError(`Failed to get stats: ${err}`);
        }
    };

    const searchPattern = () => {
        if (!fileService) return;
        setShowSearchModal(true);
    };

    const executeSearch = async () => {
        if (!fileService || !searchPatternInput) return;

        try {
            // Filter metadata based on pattern
            const allMetadata = fileService.getAllMetadata();
            const regex = new RegExp(searchPatternInput.replace(/\*/g, '.*'), 'i');
            const results = allMetadata.filter((m) => regex.test(m.path));

            if (results.length === 0) {
                setError('No files found matching the pattern');
                setSearchResults([]);
                setShowResults(false);
            } else {
                setSearchResults(results.slice(0, 100)); // Show first 100 results
                setShowResults(true);
                setShowSearchModal(false);
                setSearchPatternInput('');
            }
        } catch (err) {
            setError(`Search failed: ${err}`);
        }
    };

    const showFileInfo = (file: FileInfo) => {
        const metadata = fileService?.getMetadata(file.path);
        if (!metadata) return;

        setSelectedFileInfo(metadata);
        setShowFileInfoModal(true);
    };

    // Staging functions
    const beginStaging = async () => {
        if (!wasmModule) return;

        try {
            wasmModule.begin_index_staging();
            setIsStaging(true);
            setError(null);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to begin staging: ${errorMessage}`);
        }
    };

    const commitStaging = async () => {
        if (!wasmModule || !fileService) return;

        try {
            const result = wasmModule.commit_index_staging();
            let writtenCount = 0;
            let deletedCount = 0;

            if (result.deleted && result.deleted.length > 0) {
                deletedCount = await fileService.deleteFiles(result.deleted);
            }

            if (result.modified && result.modified.length > 0) {
                writtenCount = await fileService.writeModifiedFiles(result.modified);
            }

            setIsStaging(false);
            setStagedFiles([]);
            setError(null);
            alert(`Committed: ${writtenCount} written, ${deletedCount} deleted.`);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to commit staging: ${errorMessage}`);
        }
    };

    const revertStaging = async () => {
        if (!wasmModule) return;

        try {
            wasmModule.revert_index_staging();
            setIsStaging(false);
            setStagedFiles([]);
            setError(null);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to revert staging: ${errorMessage}`);
        }
    };

    const getStagedFiles = async () => {
        if (!wasmModule || !fileService) return;

        try {
            const files = await fileService.getStagedModifications();
            setStagedFiles(files);
            setShowStagedFilesModal(true);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to get staged files: ${errorMessage}`);
        }
    };

    const toggleFileExpanded = (path: string) => {
        const newExpanded = new Set(expandedFiles);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpandedFiles(newExpanded);
    };

    const createFile = async (path: string, content: string, allowOverwrite: boolean = false) => {
        if (!wasmModule) return;

        try {
            const contentBytes = new TextEncoder().encode(content);
            const result = wasmModule.create_index_file(path, contentBytes, allowOverwrite);
            alert(`File ${result.created ? 'created' : 'updated'}: ${result.path} (${result.size} bytes)`);
            // Refresh staged files if modal is open
            if (showStagedFilesModal) {
                await getStagedFiles();
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to create file: ${errorMessage}`);
        }
    };

    const deleteFile = async (path: string) => {
        if (!wasmModule) return;

        try {
            const result = wasmModule.delete_index_file(path);
            alert(`File ${result.existed ? 'deleted' : 'not found'}: ${result.path}`);
            // Refresh staged files if modal is open
            if (showStagedFilesModal) {
                await getStagedFiles();
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Failed to delete file: ${errorMessage}`);
        }
    };

    const clearAll = async () => {
        if (!confirm('This will clear the current session. Are you sure?')) return;

        try {
            // Reset state
            setStats(null);
            setRecentFiles([]);
            setScanProgress(null);
            setCurrentPage(0);

            const service = new FileService({
                batchSize: 50,
                onProgress: (current: number, total: number) => {
                    setScanProgress({
                        current,
                        total,
                        percentage: Math.round((current / total) * 100),
                    });
                },
                onScanProgress: (filesFound: number, currentPath?: string, fileSize?: number) => {
                    setScanningStats((prev) => ({
                        ...prev,
                        filesFound,
                        currentPath,
                        bytesProcessed: (prev.bytesProcessed || 0) + (fileSize || 0),
                    }));
                },
            });

            setFileService(service);
            setError(null);
        } catch (err) {
            setError(`Failed to clear: ${err}`);
        }
    };

    const handleReadFile = async () => {
        if (!wasmModule || !readPath) return;

        setReadError(null);
        setReadResult(null);

        try {
            const startLine = parseInt(readStartLine) || 1;
            const endLine = parseInt(readEndLine) || 10;

            const result = await wasmModule.read_file_lines(readPath, startLine, endLine, readUseStaged);

            setReadResult({
                content: result.content,
                startLine: result.startLine,
                endLine: result.endLine,
                totalLines: result.totalLines,
            });
        } catch (err) {
            setReadError(err instanceof Error ? err.message : 'Failed to read file');
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
                            Your browser does not support the File System Access API. Please use a Chromium-based
                            browser (Chrome, Edge, Brave, etc.) to test this feature.
                        </p>
                    </div>
                )}

                {/* Status indicators */}
                <div className="flex gap-4 mb-6">
                    <div className="flex items-center gap-2">
                        <div
                            className={`w-3 h-3 rounded-full ${wasmReady ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
                        />
                        <span className="text-sm">WASM {wasmReady ? 'Ready' : 'Loading...'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div
                            className={`w-3 h-3 rounded-full ${scanning ? 'bg-yellow-500 animate-pulse' : 'bg-gray-400'}`}
                        />
                        <span className="text-sm">{scanning ? 'Scanning...' : 'Idle'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm">
                            Mode:{' '}
                            <span className="font-medium">
                                {accessMode === 'read' ? 'Read-only' : 'Read & Write'}
                            </span>
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
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                    View files only (safer)
                                </span>
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
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                    View and edit files
                                </span>
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
                                    const patterns = e.target.value.split(' ').filter((p) => p.trim());
                                    setExcludePatterns(patterns);
                                }}
                                placeholder="node_modules .git dist build .next"
                                className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-gray-600 dark:text-gray-400">
                                Include (optional):
                            </label>
                            <input
                                type="text"
                                value={includePatterns.join(' ')}
                                onChange={(e) => {
                                    const patterns = e.target.value.split(' ').filter((p) => p.trim());
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
                        <button
                            onClick={() => setShowReadModal(true)}
                            disabled={!wasmReady || !stats}
                            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Read File Lines
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
                                    const duration = performance.now() - startTime;
                                    setWasmPingResult({ result, duration });
                                    setShowWasmPingModal(true);
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
                                    setWasmStats({ count, stats });
                                    setShowWasmStatsModal(true);
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

                    {/* Staging Controls */}
                    {stats && (
                        <div className="flex flex-wrap gap-2">
                            {!isStaging ? (
                                <button
                                    onClick={beginStaging}
                                    disabled={!wasmReady || !wasmModule || !canWrite}
                                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    Begin Staging
                                </button>
                            ) : null}
                        </div>
                    )}

                    {/* Create/Delete File Controls (only in staging mode) */}
                    {isStaging && (
                        <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                            <h3 className="font-semibold mb-3">File Operations</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Create File:</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="path/to/file.txt"
                                            id="create-file-path"
                                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        />
                                        <button
                                            onClick={() => {
                                                const pathInput = document.getElementById('create-file-path') as HTMLInputElement;
                                                const contentInput = document.getElementById('create-file-content') as HTMLTextAreaElement;
                                                if (pathInput.value) {
                                                    createFile(pathInput.value, contentInput.value || '', false);
                                                    pathInput.value = '';
                                                    contentInput.value = '';
                                                }
                                            }}
                                            disabled={!canWrite}
                                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                        >
                                            Create
                                        </button>
                                    </div>
                                    <textarea
                                        id="create-file-content"
                                        placeholder="File content (optional)"
                                        className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        rows={3}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Delete File:</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="path/to/file.txt"
                                            id="delete-file-path"
                                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                        />
                                        <button
                                            onClick={() => {
                                                const pathInput = document.getElementById('delete-file-path') as HTMLInputElement;
                                                if (pathInput.value && confirm(`Delete file: ${pathInput.value}?`)) {
                                                    deleteFile(pathInput.value);
                                                    pathInput.value = '';
                                                }
                                            }}
                                            disabled={!canWrite}
                                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Staging Actions */}
                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    onClick={commitStaging}
                                    disabled={!canWrite}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                >
                                    Commit Changes
                                </button>
                                <button
                                    onClick={revertStaging}
                                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                                >
                                    Revert Staging
                                </button>
                                <button
                                    onClick={getStagedFiles}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    Show Staged Files
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Scanning Phase Indicator */}
                {scanPhase !== 'idle' && scanPhase !== 'error' && (
                    <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="space-y-3">
                            {/* Phase Status */}
                            <div className="flex items-center gap-3">
                                {scanPhase === 'selecting' && (
                                    <>
                                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                        <span className="text-blue-700 dark:text-blue-300 font-medium">
                                            Opening directory selector...
                                        </span>
                                    </>
                                )}
                                {scanPhase === 'scanning' && (
                                    <>
                                        <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                                        <div className="flex-1">
                                            <div className="text-yellow-700 dark:text-yellow-300 font-medium">
                                                Scanning directory structure...
                                            </div>
                                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                This may take a moment for large directories
                                            </div>
                                        </div>
                                    </>
                                )}
                                {scanPhase === 'loading' && (
                                    <>
                                        <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center">
                                                <span className="text-green-700 dark:text-green-300 font-medium">
                                                    Loading files into memory...
                                                </span>
                                                {scanProgress && (
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">
                                                        {scanProgress.current}/{scanProgress.total} ({scanProgress.percentage}%)
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                                {scanPhase === 'complete' && (
                                    <>
                                        <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                            <svg
                                                className="w-3 h-3 text-white"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={3}
                                                    d="M5 13l4 4L19 7"
                                                />
                                            </svg>
                                        </div>
                                        <span className="text-green-700 dark:text-green-300 font-medium">
                                            Scan complete!
                                        </span>
                                    </>
                                )}
                            </div>

                            {/* Progress bar for loading phase */}
                            {scanPhase === 'loading' && scanProgress && (
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                    <div
                                        className="bg-green-500 h-2 rounded-full transition-all duration-300"
                                        style={{ width: `${scanProgress.percentage}%` }}
                                    />
                                </div>
                            )}

                            {/* Scanning stats */}
                            {scanPhase === 'scanning' && (
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400">
                                        <div className="space-y-1">
                                            {scanningStats.filesFound > 0 && (
                                                <div>
                                                    Files found:{' '}
                                                    <span className="font-mono font-medium">{scanningStats.filesFound}</span>
                                                </div>
                                            )}
                                            {scanningStats.currentPath && (
                                                <div className="truncate max-w-md" title={scanningStats.currentPath}>
                                                    Current: {scanningStats.currentPath}
                                                </div>
                                            )}
                                        </div>
                                        {scanningStats.startTime && <div>Elapsed: {elapsedTime}s</div>}
                                    </div>

                                    {/* Performance metrics */}
                                    {scanningStats.filesFound > 0 && elapsedTime > 0 && (
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-1">
                                                <div className="text-gray-500 dark:text-gray-400">Speed</div>
                                                <div className="font-mono font-medium">
                                                    {(scanningStats.filesFound / elapsedTime).toFixed(1)} files/s
                                                </div>
                                            </div>
                                            <div className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-1">
                                                <div className="text-gray-500 dark:text-gray-400">Data Rate</div>
                                                <div className="font-mono font-medium">
                                                    {scanningStats.bytesProcessed
                                                        ? `${(scanningStats.bytesProcessed / 1024 / 1024 / elapsedTime).toFixed(1)} MB/s`
                                                        : '0 MB/s'}
                                                </div>
                                            </div>
                                            <div className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-1">
                                                <div className="text-gray-500 dark:text-gray-400">Avg Size</div>
                                                <div className="font-mono font-medium">
                                                    {scanningStats.bytesProcessed
                                                        ? `${(scanningStats.bytesProcessed / scanningStats.filesFound / 1024).toFixed(1)} KB`
                                                        : '0 KB'}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Statistics */}
                {stats && !scanning && (
                    <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <h3 className="font-semibold mb-3">Scan Statistics</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                            <div>
                                Files Scanned: <span className="font-mono">{stats.filesScanned}</span>
                            </div>
                            <div>
                                Text Files Loaded: <span className="font-mono">{stats.filesLoaded}</span>
                            </div>
                            <div>
                                Binary Files Skipped: <span className="font-mono">{stats.binaryFilesSkipped}</span>
                            </div>
                            <div>
                                Total Size:{' '}
                                <span className="font-mono">{(stats.totalSize / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <div>
                                Duration: <span className="font-mono">{(stats.duration / 1000).toFixed(2)}s</span>
                            </div>
                        </div>

                        {/* Performance Metrics */}
                        <div className="grid grid-cols-4 gap-2 mb-3">
                            <div className="bg-white dark:bg-gray-800 rounded p-2 text-center">
                                <div className="text-xs text-gray-500 dark:text-gray-400">Scan Speed</div>
                                <div className="text-lg font-mono font-semibold text-blue-600 dark:text-blue-400">
                                    {(stats.filesScanned / (stats.duration / 1000)).toFixed(0)}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">files/sec</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded p-2 text-center">
                                <div className="text-xs text-gray-500 dark:text-gray-400">Throughput</div>
                                <div className="text-lg font-mono font-semibold text-green-600 dark:text-green-400">
                                    {(stats.totalSize / 1024 / 1024 / (stats.duration / 1000)).toFixed(1)}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">MB/sec</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded p-2 text-center">
                                <div className="text-xs text-gray-500 dark:text-gray-400">Avg File Size</div>
                                <div className="text-lg font-mono font-semibold text-purple-600 dark:text-purple-400">
                                    {(stats.totalSize / stats.filesScanned / 1024).toFixed(1)}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">KB</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded p-2 text-center">
                                <div className="text-xs text-gray-500 dark:text-gray-400">Load Success</div>
                                <div className="text-lg font-mono font-semibold text-orange-600 dark:text-orange-400">
                                    {((stats.filesLoaded / stats.filesScanned) * 100).toFixed(0)}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">%</div>
                            </div>
                        </div>

                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300">
                            <strong>Note:</strong> Scanner is configured to only accept text files (source code,
                            config files, markdown, etc.)
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
                                        <th className="text-right p-2">Size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((file, idx) => (
                                        <tr
                                            key={idx}
                                            className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                                        >
                                            <td className="p-2 font-mono text-xs truncate max-w-md" title={file.path}>
                                                {file.path}
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

                {/* All files table */}
                {recentFiles.length > 0 && (
                    <div className="mt-6">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-lg font-semibold">Indexed Files ({recentFiles.length} total)</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Page {currentPage + 1} of {Math.ceil(recentFiles.length / filesPerPage)}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                                    disabled={currentPage === 0}
                                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() =>
                                        setCurrentPage(
                                            Math.min(Math.ceil(recentFiles.length / filesPerPage) - 1, currentPage + 1),
                                        )
                                    }
                                    disabled={currentPage >= Math.ceil(recentFiles.length / filesPerPage) - 1}
                                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                                <button
                                    onClick={() => setShowAllFiles(!showAllFiles)}
                                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                                >
                                    {showAllFiles ? 'Show Pages' : 'Show All'}
                                </button>
                            </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg overflow-hidden">
                            <div className="max-h-96 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                                        <tr>
                                            <th className="text-left p-2">File Path</th>
                                            <th className="text-right p-2">Size</th>
                                            <th className="text-right p-2">Modified</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(showAllFiles
                                            ? recentFiles
                                            : recentFiles.slice(
                                                currentPage * filesPerPage,
                                                (currentPage + 1) * filesPerPage,
                                            )
                                        ).map((file, idx) => {
                                            return (
                                                <tr
                                                    key={idx}
                                                    className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                                                    onClick={() => showFileInfo(file)}
                                                >
                                                    <td className="p-2 font-mono text-xs truncate max-w-md" title={file.path}>
                                                        {file.path}
                                                    </td>
                                                    <td className="p-2 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                                                        {(file.size / 1024).toFixed(1)} KB
                                                    </td>
                                                    <td className="p-2 text-right text-xs text-gray-600 dark:text-gray-400">
                                                        {new Date(file.mtime).toLocaleString()}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {!showAllFiles && (
                                <div className="p-2 bg-gray-100 dark:bg-gray-800 text-center text-xs text-gray-600 dark:text-gray-400">
                                    Showing {Math.min(currentPage * filesPerPage + 1, recentFiles.length)}-
                                    {Math.min((currentPage + 1) * filesPerPage, recentFiles.length)} of{' '}
                                    {recentFiles.length} files
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Read File Modal */}
            <Modal
                isOpen={showReadModal}
                onClose={() => {
                    setShowReadModal(false);
                    setReadResult(null);
                    setReadError(null);
                }}
                title="Read File Lines"
                maxWidth="4xl"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">File Path:</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={readPath}
                                onChange={(e) => setReadPath(e.target.value)}
                                placeholder="e.g., src/components/Button.tsx"
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            />
                            {recentFiles.length > 0 && (
                                <select
                                    onChange={(e) => setReadPath(e.target.value)}
                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                >
                                    <option value="">Select a file...</option>
                                    {recentFiles.slice(0, 20).map((file, idx) => (
                                        <option key={idx} value={file.path}>
                                            {file.path}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Start Line:</label>
                            <input
                                type="number"
                                value={readStartLine}
                                onChange={(e) => setReadStartLine(e.target.value)}
                                min="1"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">End Line:</label>
                            <input
                                type="number"
                                value={readEndLine}
                                onChange={(e) => setReadEndLine(e.target.value)}
                                min="1"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            />
                        </div>
                    </div>

                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="useStaged"
                            checked={readUseStaged}
                            onChange={(e) => setReadUseStaged(e.target.checked)}
                            className="mr-2"
                        />
                        <label htmlFor="useStaged" className="text-sm">
                            Use staged index
                        </label>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleReadFile}
                            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                            Read Lines
                        </button>
                        <button
                            onClick={() => {
                                setShowReadModal(false);
                                setReadResult(null);
                                setReadError(null);
                            }}
                            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                        >
                            Close
                        </button>
                    </div>

                    {readError && (
                        <div className="p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                            <p className="text-red-700 dark:text-red-400">{readError}</p>
                        </div>
                    )}

                    {readResult && (
                        <div className="space-y-2">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                Lines {readResult.startLine}-{readResult.endLine} of {readResult.totalLines} total
                            </div>

                            <div className="relative bg-gray-900 rounded-lg overflow-hidden">
                                <pre className="p-4 overflow-x-auto text-sm line-numbers">
                                    <code
                                        ref={codeContainerRef}
                                        className={
                                            readPath.match(/\.(ts|tsx)$/)
                                                ? 'language-typescript'
                                                : readPath.match(/\.(js|jsx)$/)
                                                    ? 'language-javascript'
                                                    : readPath.endsWith('.json')
                                                        ? 'language-json'
                                                        : 'language-plaintext'
                                        }
                                        style={{
                                            counterReset: `linenumber ${readResult.startLine - 1}`,
                                        }}
                                    >
                                        {readResult.content}
                                    </code>
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Stats Modal */}
            <Modal
                isOpen={showStatsModal}
                onClose={() => setShowStatsModal(false)}
                title="Index Statistics"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded">
                            <div className="text-sm text-gray-600 dark:text-gray-400">Files Indexed</div>
                            <div className="text-2xl font-bold">{wasmModule?.file_count() || 0}</div>
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded">
                            <div className="text-sm text-gray-600 dark:text-gray-400">Files Scanned</div>
                            <div className="text-2xl font-bold">{stats?.filesScanned || 0}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowStatsModal(false)}
                        className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                        Close
                    </button>
                </div>
            </Modal>

            {/* File Info Modal */}
            <Modal
                isOpen={showFileInfoModal}
                onClose={() => setShowFileInfoModal(false)}
                title="File Information"
            >
                {selectedFileInfo && (
                    <div className="space-y-3">
                        <div>
                            <span className="font-semibold">Path:</span>
                            <code className="ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
                                {selectedFileInfo.path}
                            </code>
                        </div>
                        <div>
                            <span className="font-semibold">Size:</span>
                            <span className="ml-2">{(selectedFileInfo.size / 1024).toFixed(2)} KB</span>
                        </div>
                        <div>
                            <span className="font-semibold">Type:</span>
                            <span className="ml-2">{selectedFileInfo.type}</span>
                        </div>
                        <div>
                            <span className="font-semibold">Modified:</span>
                            <span className="ml-2">
                                {new Date(selectedFileInfo.lastModified).toLocaleString()}
                            </span>
                        </div>
                        <div>
                            <span className="font-semibold">Handle:</span>
                            <span className="ml-2">
                                {selectedFileInfo.handle ? 'Available for reading' : 'Not available'}
                            </span>
                        </div>
                        <button
                            onClick={() => setShowFileInfoModal(false)}
                            className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                            Close
                        </button>
                    </div>
                )}
            </Modal>

            {/* WASM Ping Modal */}
            <Modal
                isOpen={showWasmPingModal}
                onClose={() => setShowWasmPingModal(false)}
                title="WASM Ping Test"
                maxWidth="sm"
            >
                {wasmPingResult && (
                    <div className="space-y-3">
                        <div className="text-center">
                            <div className="text-4xl mb-2">✓</div>
                            <div className="text-lg font-semibold">Response: {wasmPingResult.result}</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                Response time: {wasmPingResult.duration.toFixed(2)}ms
                            </div>
                        </div>
                        <button
                            onClick={() => setShowWasmPingModal(false)}
                            className="mt-4 w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                            Close
                        </button>
                    </div>
                )}
            </Modal>

            {/* WASM Stats Modal */}
            <Modal
                isOpen={showWasmStatsModal}
                onClose={() => setShowWasmStatsModal(false)}
                title="WASM Index Statistics"
            >
                {wasmStats && (
                    <div className="space-y-4">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded">
                            <div className="text-sm text-gray-600 dark:text-gray-400">File Count</div>
                            <div className="text-2xl font-bold">{wasmStats.count}</div>
                        </div>
                        <div>
                            <div className="font-semibold mb-2">Raw Stats:</div>
                            <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded overflow-auto text-sm">
                                {JSON.stringify(wasmStats.stats, null, 2)}
                            </pre>
                        </div>
                        <button
                            onClick={() => setShowWasmStatsModal(false)}
                            className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                            Close
                        </button>
                    </div>
                )}
            </Modal>

            {/* Search Modal */}
            <Modal
                isOpen={showSearchModal}
                onClose={() => {
                    setShowSearchModal(false);
                    setSearchPatternInput('');
                }}
                title="Search Files"
                maxWidth="md"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Enter file name pattern (e.g., *.tsx, test):
                        </label>
                        <input
                            type="text"
                            value={searchPatternInput}
                            onChange={(e) => setSearchPatternInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    executeSearch();
                                }
                            }}
                            placeholder="*.tsx or component"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            autoFocus
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={executeSearch}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Search
                        </button>
                        <button
                            onClick={() => {
                                setShowSearchModal(false);
                                setSearchPatternInput('');
                            }}
                            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Staged Files Modal */}
            <Modal
                isOpen={showStagedFilesModal}
                onClose={() => setShowStagedFilesModal(false)}
                title={`Staged Files (${stagedFiles.length})`}
                maxWidth="2xl"
            >
                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                    {stagedFiles.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400">No files have been modified.</p>
                    ) : (
                        stagedFiles.map((file) => (
                            <div key={file.path} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                                <div
                                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                                    onClick={() => toggleFileExpanded(file.path)}
                                >
                                    <div className="flex items-center gap-2">
                                        <svg
                                            className={`w-4 h-4 transition-transform ${expandedFiles.has(file.path) ? 'rotate-90' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        <code className="text-sm font-mono">{file.path}</code>
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {(file.content.length / 1024).toFixed(2)} KB
                                    </div>
                                </div>
                                {expandedFiles.has(file.path) && (
                                    <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                                        <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-auto max-h-96">
                                            {new TextDecoder().decode(file.content)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                    <button
                        onClick={() => setShowStagedFilesModal(false)}
                        className="mt-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                        Close
                    </button>
                </div>
            </Modal>
        </div>
    );
}
