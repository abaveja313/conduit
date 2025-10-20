"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Zap, Sparkles, Brain, Crown } from "lucide-react"

export interface ModelOption {
    value: string
    label: string
    shortLabel?: string
    description: string
    icon: React.ComponentType<{ className?: string }>
    features: string[]
    recommended?: boolean
    premium?: boolean
    requiresOwnKey?: boolean
    color: string
    borderColor: string
}

export const MODELS: ModelOption[] = [
    {
        value: "claude-haiku-4-5-20251001",
        label: "Claude 4.5 Haiku",
        shortLabel: "Haiku",
        description: "Lightning fast responses for simple tasks",
        icon: Zap,
        features: ["Fastest", "Cost-effective"],
        color: "from-blue-500/10 to-cyan-500/10",
        borderColor: "border-blue-500/20"
    },
    {
        value: "claude-sonnet-4-5-20250929",
        label: "Claude 4.5 Sonnet",
        shortLabel: "Sonnet 4.5",
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
        shortLabel: "Sonnet 4",
        description: "Previous generation balanced model",
        icon: Brain,
        features: ["Stable", "Proven"],
        color: "from-green-500/10 to-emerald-500/10",
        borderColor: "border-green-500/20"
    },
    {
        value: "claude-opus-4-1-20250805",
        label: "Claude 4.1 Opus",
        shortLabel: "Opus",
        description: "Most capable model for complex reasoning",
        icon: Crown,
        features: ["Most powerful", "Expensive"],
        premium: true,
        requiresOwnKey: true,
        color: "from-amber-500/10 to-orange-500/10",
        borderColor: "border-amber-500/20"
    }
]

interface ModelWithDisabled extends ModelOption {
    disabled?: boolean
}

interface ModelGridProps {
    selectedModel: string
    onModelSelect: (model: string) => void
    availableModels: ModelWithDisabled[]
    compact?: boolean
}

export function ModelGrid({
    selectedModel,
    onModelSelect,
    availableModels,
    compact = false
}: ModelGridProps) {
    const gridCols = compact ? "grid-cols-2" : "grid-cols-2"
    const padding = compact ? "p-3" : "p-4"
    const spacing = compact ? "space-y-2" : "space-y-3"
    const gap = compact ? "gap-2" : "gap-3"

    return (
        <div className={`grid ${gridCols} ${gap}`}>
            {availableModels.map((model) => {
                const Icon = model.icon
                const isSelected = selectedModel === model.value
                const isDisabled = model.disabled || false

                return (
                    <motion.button
                        key={model.value}
                        onClick={() => !isDisabled && onModelSelect(model.value)}
                        disabled={isDisabled}
                        whileHover={!isDisabled ? { scale: 1.02 } : {}}
                        whileTap={!isDisabled ? { scale: 0.98 } : {}}
                        className={`
                            relative ${padding} rounded-lg border-2 transition-all text-left overflow-visible
                            ${isSelected
                                ? `border-primary bg-gradient-to-br ${model.color} shadow-md`
                                : 'border-muted-foreground/20 hover:border-muted-foreground/40 bg-card/80'
                            }
                            ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                    >
                        <div className={spacing}>
                            <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
                                <Icon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                <h3 className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>
                                    {model.label}
                                </h3>
                            </div>

                            <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-muted-foreground line-clamp-2`}>
                                {model.description}
                            </p>

                            <div className="flex flex-wrap gap-1">
                                {model.features.map((feature, idx) => (
                                    <span
                                        key={idx}
                                        className={`
                                            ${compact ? 'text-[10px] px-1.5' : 'text-xs px-2'} py-0.5 rounded-full border
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

                        <AnimatePresence>
                            {isSelected && (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    exit={{ scale: 0 }}
                                    className={`absolute top-2 right-2 ${compact ? 'h-4 w-4' : 'h-5 w-5'} rounded-full bg-primary flex items-center justify-center`}
                                >
                                    <svg className={`${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} text-primary-foreground`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {model.recommended && !isSelected && (
                            <div className={`absolute -top-1 -right-1 px-1.5 py-0.5 bg-primary text-primary-foreground ${compact ? 'text-[9px]' : 'text-[10px]'} font-medium rounded-full`}>
                                Recommended
                            </div>
                        )}
                    </motion.button>
                )
            })}
        </div>
    )
}
