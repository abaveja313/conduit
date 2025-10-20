"use client"

import { useState, useCallback } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { useFeatureFlagEnabled } from 'posthog-js/react'
import { ModelGrid, MODELS } from "@/components/ModelGrid"

interface ModelSwitcherProps {
    currentModel: string
    onModelChange: (model: string) => void
    variant?: "default" | "compact"
}

export function ModelSwitcher({ currentModel, onModelChange, variant = "default" }: ModelSwitcherProps) {
    const [open, setOpen] = useState(false)

    const savedApiKey = typeof window !== 'undefined' ? localStorage.getItem('anthropicApiKey') : null
    const hasSavedKey = savedApiKey && savedApiKey.trim()
    const isUsingInternalKey = useFeatureFlagEnabled('use-internal-api-key') || false

    const currentModelData = MODELS.find(m => m.value === currentModel) || MODELS[1]

    const availableModels = useCallback(() => {
        const models = isUsingInternalKey && !hasSavedKey
            ? MODELS.filter(m => !m.premium)
            : MODELS

        return models.map(model => ({
            ...model,
            disabled: model.requiresOwnKey ? !hasSavedKey : (model.premium && isUsingInternalKey && !hasSavedKey)
        }))
    }, [isUsingInternalKey, hasSavedKey])()

    const handleModelSelect = (model: string) => {
        onModelChange(model)
        localStorage.setItem('selectedModel', model)
        setOpen(false)
    }

    const CurrentIcon = currentModelData.icon
    const isCompact = variant === "compact"

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className={isCompact
                        ? "h-7 gap-1 px-2 text-xs font-medium hover:bg-secondary/50"
                        : "gap-2 hover:bg-secondary/50"
                    }
                >
                    <CurrentIcon className={isCompact ? "h-3 w-3" : "h-4 w-4"} />
                    <span className={isCompact ? "text-xs" : "text-sm"}>
                        {currentModelData.shortLabel || currentModelData.label}
                    </span>
                    <ChevronDown className={`${isCompact ? "h-3 w-3" : "h-4 w-4"} transition-transform ${open ? 'rotate-180' : ''}`} />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-[440px] p-3"
                sideOffset={8}
            >
                <div className="space-y-2">
                    <div className="text-sm font-medium px-1">Select Model</div>
                    <ModelGrid
                        selectedModel={currentModel}
                        onModelSelect={handleModelSelect}
                        availableModels={availableModels}
                        compact={true}
                    />
                    {isUsingInternalKey && !hasSavedKey && (
                        <p className="text-[10px] text-muted-foreground px-1 pt-1">
                            Using trial credits. Add your API key in settings to unlock all models.
                        </p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
