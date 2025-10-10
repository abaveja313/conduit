'use client'; // Error boundaries must be Client Components

import posthog from "posthog-js";
import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Capture the exception to PostHog with additional context
        posthog.captureException(error, {
            source: 'global_error_boundary',
            digest: error.digest,
            stack: error.stack,
            message: error.message,
            name: error.name,
            pathname: window.location.pathname,
            href: window.location.href
        });

        console.error('Global error boundary caught:', error);
    }, [error]);

    return (
        // global-error must include html and body tags
        <html>
            <body>
                <div className="flex min-h-screen items-center justify-center">
                    <div className="text-center space-y-4">
                        <h1 className="text-4xl font-bold">500</h1>
                        <p className="text-xl">Application Error</p>
                        <p className="text-muted-foreground">
                            A critical error occurred. Please try refreshing the page.
                        </p>
                        <button
                            onClick={reset}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
