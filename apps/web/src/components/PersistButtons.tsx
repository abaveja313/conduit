"use client"

import { Button } from "@/components/ui/button"
import { Save, RefreshCw, Loader2 } from "lucide-react"

interface PersistButtonsProps {
    onCommit: () => void
    onRevert: () => void
    isPersisting: boolean
    isLoading: boolean
}

export function PersistButtons({ onCommit, onRevert, isPersisting, isLoading }: PersistButtonsProps) {
    return (
        <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
            <Button
                onClick={onCommit}
                className="flex-1"
                disabled={isLoading || isPersisting}
            >
                {isPersisting ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing...
                    </>
                ) : (
                    <>
                        <Save className="h-4 w-4 mr-2" />
                        Sync
                    </>
                )}
            </Button>
            <Button
                onClick={onRevert}
                variant="outline"
                className="flex-1"
                disabled={isLoading || isPersisting}
            >
                <RefreshCw className="h-4 w-4 mr-2" />
                Revert
            </Button>
        </div>
    )
}
