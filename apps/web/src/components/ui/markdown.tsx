import React from 'react';

interface MarkdownProps {
    content: string;
    className?: string;
}

export function Markdown({ content, className = '' }: MarkdownProps) {
    const parseMarkdown = (text: string) => {
        // First split by code blocks to preserve them
        const parts = text.split(/(```[\s\S]*?```)/g);

        return parts.map((part, index) => {
            if (part.startsWith('```')) {
                const lines = part.split('\n');
                const code = lines.slice(1, -1).join('\n');

                return (
                    <pre key={index} className="bg-secondary/50 rounded-md p-4 my-2 overflow-x-auto">
                        <code className="text-sm font-mono">{code}</code>
                    </pre>
                );
            }

            // Handle inline code and bold
            return parseInlineFormatting(part, index);
        });
    };

    const parseInlineFormatting = (text: string, keyPrefix: number) => {
        // Pattern to match inline code and bold markers
        // Order matters: check for triple asterisks first, then double
        const pattern = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|___[^_]+_____|__[^_]+__)/g;

        const parts = text.split(pattern);

        return (
            <span key={keyPrefix} className="whitespace-pre-wrap">
                {parts.map((part, i) => {
                    if (!part) return null;

                    // Inline code
                    if (part.startsWith('`') && part.endsWith('`')) {
                        return (
                            <code key={`${keyPrefix}-${i}`} className="bg-secondary/50 px-1 py-0.5 rounded text-sm font-mono">
                                {part.slice(1, -1)}
                            </code>
                        );
                    }

                    // Bold (*** or ___)
                    if ((part.startsWith('***') && part.endsWith('***')) ||
                        (part.startsWith('___') && part.endsWith('___'))) {
                        const content = part.startsWith('***') ? part.slice(3, -3) : part.slice(3, -3);
                        return (
                            <strong key={`${keyPrefix}-${i}`} className="font-bold">
                                {content}
                            </strong>
                        );
                    }

                    // Bold (** or __)
                    if ((part.startsWith('**') && part.endsWith('**')) ||
                        (part.startsWith('__') && part.endsWith('__'))) {
                        const content = part.startsWith('**') ? part.slice(2, -2) : part.slice(2, -2);
                        return (
                            <strong key={`${keyPrefix}-${i}`} className="font-bold">
                                {content}
                            </strong>
                        );
                    }


                    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
                })}
            </span>
        );
    };

    return <div className={`prose prose-invert max-w-none ${className}`}>{parseMarkdown(content)}</div>;
}
