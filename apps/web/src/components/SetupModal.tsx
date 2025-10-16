"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Train, Loader2, Folder, AlertCircle, ChevronRight, ChevronLeft, HardDrive, Cpu, Shield, Github, Sparkles, Zap, Brain, Crown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { FileService } from "@conduit/fs"
import { formatFileSize } from "@conduit/fs"
import * as wasm from "@conduit/wasm"
import { createLogger } from "@conduit/shared"
import {
    trackScanCompleted,
    checkBrowserCompatibility,
    trackWasmInitializationFailed
} from "@/lib/posthog"
import { useFeatureFlagEnabled } from 'posthog-js/react'

interface SetupModalProps {
    open: boolean
    onComplete: (config: {
        provider: "anthropic"
        apiKey: string
        model: string
        directory: FileSystemDirectoryHandle
        mode: "read" | "readwrite"
        fileService: FileService
    }) => void
}

type Step = "welcome" | "directory" | "provider"

const MODELS = {
    anthropic: [
        {
            value: "claude-haiku-4-5-20251001",
            label: "Claude 4.5 Haiku",
            description: "Lightning fast responses for simple tasks",
            icon: Zap,
            features: ["Fastest", "Cost-effective"],
            color: "from-blue-500/10 to-cyan-500/10",
            borderColor: "border-blue-500/20"
        },
        {
            value: "claude-sonnet-4-5-20250929",
            label: "Claude 4.5 Sonnet",
            description: "Best balance of speed and intelligence",
            icon: Sparkles,
            features: ["Balanced", "Most popular"],
            recommended: true,
            color: "from-purple-500/10 to-pink-500/10",
            borderColor: "border-purple-500/20"
        },
        {
            value: "claude-sonnet-4-20250514",
            label: "Claude 4 Sonnet",
            description: "Previous generation balanced model",
            icon: Brain,
            features: ["Stable", "Proven"],
            color: "from-green-500/10 to-emerald-500/10",
            borderColor: "border-green-500/20"
        },
        {
            value: "claude-opus-4-1-20250805",
            label: "Claude 4.1 Opus",
            description: "Most capable model for complex reasoning",
            icon: Crown,
            features: ["Most powerful", "Expensive"],
            premium: true,
            requiresOwnKey: true,
            color: "from-amber-500/10 to-orange-500/10",
            borderColor: "border-amber-500/20"
        }
    ]
}

const logger = createLogger('web:setup-modal')

export function SetupModal({ open, onComplete }: SetupModalProps) {
    const [step, setStep] = useState<Step>("welcome")
    const [apiKey, setApiKey] = useState("")
    const [model, setModel] = useState("claude-sonnet-4-20250514")
    const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null)
    const [mode, setMode] = useState<"read" | "readwrite">("readwrite")
    const [useOwnKey, setUseOwnKey] = useState(false)

    const isUsingInternalKey = useFeatureFlagEnabled('use-internal-api-key') || false

    const getAvailableModels = useCallback(() => {
        const allModels = MODELS.anthropic
        if (isUsingInternalKey && !useOwnKey) {
            return allModels.filter(m => !m.premium)
        }
        return allModels
    }, [isUsingInternalKey, useOwnKey])

    const [isScanning, setIsScanning] = useState(false)
    const [hasScanned, setHasScanned] = useState(false)
    const [scanProgress, setScanProgress] = useState<{
        phase: "scanning" | "loading" | "extracting"
        filesFound: number
        currentPath?: string
        loaded?: number
        total?: number
        extracted?: number
        extractTotal?: number
    } | null>(null)
    const [scanStats, setScanStats] = useState<{
        filesScanned: number
        filesLoaded: number
        binaryFilesSkipped: number
        documentsExtracted: number
        totalSize: number
        duration: number
    } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [browserSupported, setBrowserSupported] = useState(true)
    const lastUpdateRef = useRef(0)

    const [fileService] = useState(() => new FileService({
        onScanProgress: (filesFound: number, currentPath?: string) => {
            const now = Date.now()
            if (now - lastUpdateRef.current > 100) {
                lastUpdateRef.current = now
                setScanProgress({
                    phase: "scanning",
                    filesFound,
                    currentPath
                })
            }
        },
        onProgress: (loaded: number, total: number) => {
            const now = Date.now()
            if (now - lastUpdateRef.current > 100) {
                lastUpdateRef.current = now
                setScanProgress({
                    phase: "loading",
                    filesFound: total,
                    loaded,
                    total
                })
            }
        },
        onDocumentExtractionProgress: (extracted: number, extractTotal: number, currentFile?: string) => {
            setScanProgress({
                phase: "extracting",
                filesFound: extractTotal,
                extracted,
                extractTotal,
                currentPath: currentFile
            })
        }
    }))

    useEffect(() => {
        const availableModels = getAvailableModels()
        const isModelAvailable = availableModels.some(m => m.value === model)
        if (!isModelAvailable && availableModels.length > 0) {
            setModel(availableModels[0].value)
        }
    }, [getAvailableModels, model])

    useEffect(() => {
        const anthropicKey = localStorage.getItem("anthropicApiKey")

        if (anthropicKey) {
            setApiKey(anthropicKey)
        }

        if (!window.showDirectoryPicker) {
            setBrowserSupported(false)
        }

        checkBrowserCompatibility()

        const initWasm = async () => {
            try {
                await wasm.default()
                wasm.init()
            } catch (err) {
                logger.error('Failed to initialize WASM in SetupModal:', err)

                interface PerformanceMemory {
                    usedJSHeapSize?: number;
                    jsHeapSizeLimit?: number;
                }
                const memory = 'memory' in performance ? (performance as unknown as { memory: PerformanceMemory }).memory : null
                trackWasmInitializationFailed({
                    error: err instanceof Error ? err.message : 'Unknown error',
                    memoryAvailable: memory?.usedJSHeapSize || 0,
                    retryAttempt: 0
                })
            }
        }
        if (open && browserSupported) {
            initWasm()
        }
    }, [open, browserSupported])

    const handleDirectoryPicker = async () => {
        if (!browserSupported) {
            return
        }

        try {
            setError(null)
            const handle = await window.showDirectoryPicker({ mode })
            setDirectory(handle)
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return
            }
            setError("Failed to access directory. Please try again.")
            logger.error("Directory picker failed:", err)
        }
    }

    const handleNext = async () => {
        if (step === "welcome") {
            setStep("directory")
            return
        }
        if (step === "directory") {
            if (!hasScanned) return
            setStep("provider")
            return
        }
    }

    const handleBack = () => {
        if (step === "provider") {
            setStep("directory")
        } else if (step === "directory") {
            setStep("welcome")
        }
    }

    const handleScan = async () => {
        if (!directory || isScanning) {
            return
        }

        setIsScanning(true)
        setScanProgress({ phase: "scanning", filesFound: 0 })
        setError(null)

        try {
            try {
                wasm.ping()
            } catch {
                logger.error('WASM not initialized, attempting to initialize now...')
                await wasm.default()
                wasm.init()
            }

            await new Promise(resolve => setTimeout(resolve, 100))

            const stats = await fileService.initialize(directory)

            setScanProgress(prev => prev ? { ...prev, filesFound: stats.filesScanned, loaded: stats.filesLoaded, total: stats.filesScanned } : null)
            setScanStats(stats)
            setHasScanned(true)

            trackScanCompleted({
                filesScanned: stats.filesScanned,
                filesLoaded: stats.filesLoaded,
                binaryFilesSkipped: stats.binaryFilesSkipped,
                documentsExtracted: stats.documentsExtracted,
                totalSize: stats.totalSize,
                duration: stats.duration,
                directoryMode: mode,
                model,
                provider: 'anthropic'
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to scan directory")
            logger.error("Scan failed with full error:", err)
        } finally {
            setIsScanning(false)
        }
    }

    const handleSubmit = async () => {
        const needsApiKey = !isUsingInternalKey || useOwnKey
        if (needsApiKey && !apiKey) return
        if (!directory || !hasScanned) return

        if (apiKey) {
            localStorage.setItem("anthropicApiKey", apiKey)
        }

        const finalApiKey = needsApiKey ? apiKey : ""

        onComplete({
            provider: "anthropic",
            apiKey: finalApiKey,
            model,
            directory,
            mode,
            fileService
        })
    }

    const renderScanProgress = () => {
        if (!scanProgress) return null

        return (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50 rounded-lg">
                <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <div className="flex-1">
                            <div className="text-sm font-medium">
                                {scanProgress.phase === "scanning"
                                    ? "Scanning directory..."
                                    : scanProgress.phase === "extracting"
                                        ? "Extracting document content..."
                                        : "Loading files into memory..."}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {scanProgress.phase === "scanning" ? (
                                    <>Found {scanProgress.filesFound.toLocaleString()} files</>
                                ) : scanProgress.phase === "extracting" ? (
                                    <>Extracted {scanProgress.extracted?.toLocaleString()} of {scanProgress.extractTotal?.toLocaleString()} documents</>
                                ) : (
                                    <>Loaded {scanProgress.loaded?.toLocaleString()} of {scanProgress.total?.toLocaleString()} files</>
                                )}
                            </div>
                        </div>
                    </div>

                    {((scanProgress.phase === "loading" && scanProgress.total && scanProgress.loaded) ||
                        (scanProgress.phase === "extracting" && scanProgress.extractTotal && scanProgress.extracted)) && (
                            <div className="w-full bg-secondary rounded-full h-2">
                                <div
                                    className="bg-primary h-2 rounded-full transition-all duration-300"
                                    style={{
                                        width: scanProgress.phase === "loading"
                                            ? `${(scanProgress.loaded! / scanProgress.total!) * 100}%`
                                            : `${(scanProgress.extracted! / scanProgress.extractTotal!) * 100}%`
                                    }}
                                />
                            </div>
                        )}

                    {scanProgress.currentPath && (
                        <div className="text-xs text-muted-foreground truncate" title={scanProgress.currentPath}>
                            {scanProgress.currentPath.length > 60
                                ? `...${scanProgress.currentPath.slice(-57)}`
                                : scanProgress.currentPath}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-[500px] overflow-hidden p-0" hideCloseButton>
                <div className="relative" style={{ height: "600px" }}>
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="absolute inset-0 flex flex-col"
                        >
                            <DialogHeader className="p-6 pb-0">
                                <div className="flex items-center justify-between">
                                    <DialogTitle className="flex items-center gap-2">
                                        <Train className="h-5 w-5" />
                                        {step === "welcome" ? "Welcome to Conduit" : step === "provider" ? "Select AI" : "Setup Conduit"}
                                    </DialogTitle>
                                    <a
                                        href="https://github.com/abaveja313/conduit"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <Github className="h-3 w-3" />
                                        GitHub
                                    </a>
                                </div>
                                {step !== "welcome" && (
                                    <DialogDescription>
                                        {step === "directory" && "Select a directory to work with"}
                                        {step === "provider" && "Choose your AI assistant"}
                                    </DialogDescription>
                                )}
                            </DialogHeader>

                            <div className="flex-1 overflow-y-auto p-6 pt-4">
                                {step === "welcome" && (
                                    <div className="flex flex-col justify-center h-full space-y-10">
                                        <div className="text-center space-y-6">
                                            <h2 className="text-2xl font-bold">
                                                Your AI assistant can now edit files directly on your computer
                                            </h2>
                                            <p className="text-muted-foreground max-w-md mx-auto">
                                                No backend. No uploads. No downloads. Everything runs locally in your browser using WebAssembly.
                                            </p>
                                        </div>

                                        {browserSupported ? (
                                            <div className="space-y-4 max-w-sm mx-auto w-full">
                                                <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-primary/5 border border-primary/10">
                                                    <HardDrive className="h-5 w-5 text-primary flex-shrink-0" />
                                                    <span>Direct access to files on your disk</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-orange-500/5 border border-orange-500/10">
                                                    <Cpu className="h-5 w-5 text-orange-500 flex-shrink-0" />
                                                    <span>Rust-powered performance</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-sm p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                                                    <Shield className="h-5 w-5 text-green-500 flex-shrink-0" />
                                                    <span>Review every change before it&apos;s written</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="max-w-sm mx-auto w-full">
                                                <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive border border-destructive/20">
                                                    <AlertCircle className="h-5 w-5 text-destructive-foreground flex-shrink-0 mt-0.5" />
                                                    <div className="space-y-2 text-left">
                                                        <p className="text-sm font-medium text-destructive-foreground">
                                                            Browser Not Supported
                                                        </p>
                                                        <p className="text-sm text-destructive-foreground/80">
                                                            Your browser doesn&apos;t support the File System Access API.
                                                            Please use Chrome, Microsoft Edge, or another Chromium-based browser.
                                                        </p>
                                                        <p className="text-xs text-destructive-foreground/60">
                                                            Firefox and Safari are not currently supported.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {step === "provider" && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 gap-3">
                                            {getAvailableModels().map((m) => {
                                                const Icon = m.icon
                                                const isSelected = model === m.value
                                                const isDisabled = m.requiresOwnKey ? !useOwnKey : (m.premium && isUsingInternalKey && !useOwnKey)

                                                return (
                                                    <motion.button
                                                        key={m.value}
                                                        onClick={() => !isDisabled && setModel(m.value)}
                                                        disabled={isDisabled}
                                                        whileHover={!isDisabled ? { scale: 1.02 } : {}}
                                                        whileTap={!isDisabled ? { scale: 0.98 } : {}}
                                                        className={`
                                                                relative p-4 rounded-lg border-2 transition-all text-left overflow-visible
                                                                ${isSelected
                                                                ? `border-primary bg-gradient-to-br ${m.color} shadow-md`
                                                                : 'border-muted-foreground/20 hover:border-muted-foreground/40 bg-card/80'
                                                            }
                                                                ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                                            `}
                                                    >
                                                        <div className="space-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <Icon className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                                                <h3 className="font-semibold text-sm">
                                                                    {m.label}
                                                                </h3>
                                                            </div>

                                                            <p className="text-xs text-muted-foreground line-clamp-2">
                                                                {m.description}
                                                            </p>

                                                            <div className="flex flex-wrap gap-1">
                                                                {m.features.map((feature, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className={`
                                                                                text-xs px-2 py-0.5 rounded-full border
                                                                                ${isSelected
                                                                                ? 'bg-primary/10 text-primary border-primary/20'
                                                                                : 'bg-muted/50 text-muted-foreground border-muted-foreground/10'
                                                                            }
                                                                            `}
                                                                    >
                                                                        {feature}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {isSelected && (
                                                            <motion.div
                                                                initial={{ scale: 0 }}
                                                                animate={{ scale: 1 }}
                                                                className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center"
                                                            >
                                                                <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            </motion.div>
                                                        )}
                                                    </motion.button>
                                                )
                                            })}
                                        </div>

                                        {!isUsingInternalKey ? (
                                            <div className="grid gap-2">
                                                <label htmlFor="apiKey" className="text-sm font-medium">
                                                    Anthropic API Key
                                                </label>
                                                <Input
                                                    id="apiKey"
                                                    type="password"
                                                    placeholder="sk-ant-..."
                                                    value={apiKey}
                                                    onChange={(e) => setApiKey(e.target.value)}
                                                />
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                                                    <p className="text-sm text-muted-foreground">
                                                        {useOwnKey ? "Using Custom API Key" : "✓ Using Conduit's Trial Credits"}
                                                    </p>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setUseOwnKey(!useOwnKey)}
                                                        className="text-xs"
                                                    >
                                                        {useOwnKey ? "Use Trial Credits" : "Use Custom Key"}
                                                    </Button>
                                                </div>

                                                {useOwnKey && (
                                                    <div className="space-y-3">
                                                        <div className="grid gap-2">
                                                            <label htmlFor="apiKey" className="text-sm font-medium">
                                                                Anthropic API Key
                                                            </label>
                                                            <Input
                                                                id="apiKey"
                                                                type="password"
                                                                placeholder="sk-ant-..."
                                                                value={apiKey}
                                                                onChange={(e) => setApiKey(e.target.value)}
                                                                autoFocus
                                                            />
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">
                                                            Your API key will be saved locally when you click Start
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {step === "directory" && (
                                    <div className="flex flex-col h-full space-y-8">
                                        <div className="max-w-md mx-auto w-full">
                                            <Button
                                                variant="outline"
                                                onClick={handleDirectoryPicker}
                                                disabled={isScanning || hasScanned || !browserSupported}
                                                className="w-full px-6 py-4"
                                            >
                                                <Folder className="h-4 w-4 mr-2" />
                                                {directory ? directory.name : "Select Directory"}
                                            </Button>
                                        </div>

                                        <div className="space-y-3 max-w-md mx-auto w-full">
                                            <label className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10 cursor-pointer transition-colors hover:bg-primary/10">
                                                <input
                                                    type="radio"
                                                    name="mode"
                                                    checked={mode === "readwrite"}
                                                    onChange={() => setMode("readwrite")}
                                                    disabled={isScanning || hasScanned}
                                                />
                                                <div className="flex-1">
                                                    <div className="text-sm">Read & Write</div>
                                                    <div className="text-xs text-muted-foreground">AI can suggest modifications</div>
                                                </div>
                                            </label>
                                            <label className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-muted/50 cursor-pointer transition-colors hover:bg-muted/50">
                                                <input
                                                    type="radio"
                                                    name="mode"
                                                    checked={mode === "read"}
                                                    onChange={() => setMode("read")}
                                                    disabled={isScanning || hasScanned}
                                                />
                                                <div className="flex-1">
                                                    <div className="text-sm">Read Only</div>
                                                    <div className="text-xs text-muted-foreground">AI can only view files</div>
                                                </div>
                                            </label>

                                            <p className="text-xs text-muted-foreground text-center mt-4">
                                                All changes require your approval before being written
                                            </p>
                                        </div>

                                        {scanStats && !isScanning && (
                                            <div className="mt-6 max-w-md mx-auto w-full">
                                                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                                                    <div className="flex items-center justify-center gap-6 text-sm">
                                                        <div className="text-center">
                                                            <div className="font-semibold text-green-600">{scanStats.filesLoaded}</div>
                                                            <div className="text-xs text-muted-foreground">files loaded</div>
                                                        </div>
                                                        {scanStats.documentsExtracted > 0 && (
                                                            <>
                                                                <div className="w-px h-8 bg-green-500/20" />
                                                                <div className="text-center">
                                                                    <div className="font-semibold text-green-600">{scanStats.documentsExtracted}</div>
                                                                    <div className="text-xs text-muted-foreground">docs extracted</div>
                                                                </div>
                                                            </>
                                                        )}
                                                        <div className="w-px h-8 bg-green-500/20" />
                                                        <div className="text-center">
                                                            <div className="font-semibold text-green-600">{formatFileSize(scanStats.totalSize)}</div>
                                                            <div className="text-xs text-muted-foreground">total size</div>
                                                        </div>
                                                        <div className="w-px h-8 bg-green-500/20" />
                                                        <div className="text-center">
                                                            <div className="font-semibold text-green-600">{(scanStats.duration / 1000).toFixed(1)}s</div>
                                                            <div className="text-xs text-muted-foreground">scan time</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {error && (
                                    <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        {error}
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="p-6 pt-0">
                                {(step === "directory" || step === "provider") && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleBack}
                                        disabled={isScanning}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Back
                                    </Button>
                                )}

                                {step === "welcome" && (
                                    <Button type="button" onClick={handleNext} disabled={!browserSupported}>
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                )}


                                {step === "directory" && (
                                    <>
                                        {directory && !hasScanned && (
                                            <Button
                                                type="button"
                                                onClick={handleScan}
                                                disabled={isScanning || !directory}
                                            >
                                                {isScanning ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Scanning...
                                                    </>
                                                ) : (
                                                    "Scan"
                                                )}
                                            </Button>
                                        )}
                                        {hasScanned && (
                                            <Button
                                                type="button"
                                                onClick={handleNext}
                                                disabled={false}
                                            >
                                                Next
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </>
                                )}

                                {step === "provider" && (
                                    <Button
                                        type="button"
                                        onClick={handleSubmit}
                                        disabled={(!isUsingInternalKey && !apiKey) || (isUsingInternalKey && useOwnKey && !apiKey)}
                                    >
                                        Start
                                    </Button>
                                )}
                            </DialogFooter>
                        </motion.div>
                    </AnimatePresence>
                </div>
                {isScanning && renderScanProgress()}
            </DialogContent>
        </Dialog>
    )
}