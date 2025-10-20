import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    autoResize?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, autoResize = false, ...props }, ref) => {
        const textareaRef = React.useRef<HTMLTextAreaElement>(null)

        React.useImperativeHandle(ref, () => textareaRef.current!)

        const adjustHeight = React.useCallback(() => {
            const textarea = textareaRef.current
            if (!textarea || !autoResize) return

            textarea.style.height = 'auto'
            const scrollHeight = textarea.scrollHeight
            textarea.style.height = `${scrollHeight}px`
        }, [autoResize])

        React.useEffect(() => {
            adjustHeight()
        }, [props.value, adjustHeight])

        const handleInput = React.useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
            adjustHeight()
            props.onInput?.(e)
        }, [adjustHeight, props])

        return (
            <textarea
                className={cn(
                    "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                ref={textareaRef}
                onInput={handleInput}
                {...props}
            />
        )
    }
)
Textarea.displayName = "Textarea"

export { Textarea }
