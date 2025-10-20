"use client"

import { Loader2, CheckCircle2, Zap, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PersistingOverlayProps {
    isVisible: boolean
    progress: {
        current: number
        total: number
        phase: 'preparing' | 'persisting' | 'finalizing' | 'complete'
        duration?: number
    }
    onClose?: () => void
}

export function PersistingOverlay({ isVisible, progress, onClose }: PersistingOverlayProps) {
    if (!isVisible) return null

    const percentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0
    const isComplete = progress.phase === 'complete'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-background border border-border rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
                <div className="flex flex-col items-center text-center">
                    {isComplete ? (
                        <>
                            <div className="relative">
                                <div className="absolute inset-0 bg-green-500/20 blur-xl animate-pulse" />
                                <CheckCircle2 className="h-16 w-16 text-green-500 mb-6 relative" />
                            </div>

                            <h2 className="text-2xl font-bold mb-6">Sync Complete</h2>

                            <div className="grid grid-cols-2 gap-4 w-full mb-6">
                                <div className="bg-secondary/50 rounded-lg p-3">
                                    <div className="flex items-center justify-center gap-1 mb-1">
                                        <Zap className="h-4 w-4 text-yellow-500" />
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-1">Files</p>
                                    <p className="text-lg font-semibold">{progress.total}</p>
                                </div>

                                <div className="bg-secondary/50 rounded-lg p-3">
                                    <div className="flex items-center justify-center gap-1 mb-1">
                                        <Clock className="h-4 w-4 text-blue-500" />
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-1">Duration</p>
                                    <p className="text-lg font-semibold">
                                        {progress.duration ? `${(progress.duration / 1000).toFixed(2)}s` : '-'}
                                    </p>
                                </div>
                            </div>

                            <div className="w-full space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Throughput</span>
                                    <span className="font-mono">
                                        {progress.duration && progress.total ?
                                            `${((progress.total / progress.duration) * 1000).toFixed(1)} files/s` : '-'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Avg per file</span>
                                    <span className="font-mono">
                                        {progress.duration && progress.total ?
                                            `${(progress.duration / progress.total).toFixed(1)}ms` : '-'}
                                    </span>
                                </div>
                            </div>

                            <Button
                                onClick={onClose}
                                className="w-full mt-6"
                                variant="default"
                            >
                                Done
                            </Button>
                        </>
                    ) : (
                        <>
                            <Loader2 className="h-16 w-16 text-primary mb-6 animate-spin" />

                            <h2 className="text-xl font-semibold mb-2">
                                Syncing Changes
                            </h2>

                            {progress.total > 0 && (
                                <>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Processing {progress.current} of {progress.total} files
                                    </p>
                                    <div className="w-full">
                                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-100"
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                            <span>{Math.round(percentage)}%</span>
                                            <span>{progress.current}/{progress.total}</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
