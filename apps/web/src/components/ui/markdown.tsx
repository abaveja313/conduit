import React from 'react';

interface MarkdownProps {
    content: string;
    className?: string;
}

export function Markdown({ content, className = '' }: MarkdownProps) {
    // Simple markdown parsing for code blocks
    const parseMarkdown = (text: string) => {
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

            // Handle inline code
            const inlineParts = part.split(/(`[^`]+`)/g);
            return (
                <span key={index} className="whitespace-pre-wrap">
                    {inlineParts.map((inlinePart, i) => {
                        if (inlinePart.startsWith('`') && inlinePart.endsWith('`')) {
                            return (
                                <code key={i} className="bg-secondary/50 px-1 py-0.5 rounded text-sm font-mono">
                                    {inlinePart.slice(1, -1)}
                                </code>
                            );
                        }
                        return <span key={i} className="whitespace-pre-wrap">{inlinePart}</span>;
                    })}
                </span>
            );
        });
    };

    return <div className={`prose prose-invert max-w-none ${className}`}>{parseMarkdown(content)}</div>;
}
