"use client"; // Error boundaries must be Client Components

import posthog from "posthog-js";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { createLogger } from "@conduit/shared";

const logger = createLogger('web:error');

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Capture the exception to PostHog
        posthog.captureException(error, {
            source: 'error_boundary',
            digest: error.digest,
            stack: error.stack,
            message: error.message,
            name: error.name
        });

        logger.error('Error boundary caught:', error);
    }, [error]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="max-w-md space-y-4 p-8 text-center">
                <div className="flex justify-center">
                    <div className="rounded-full bg-destructive/10 p-3">
                        <svg
                            className="h-6 w-6 text-destructive"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                        </svg>
                    </div>
                </div>

                <div className="space-y-2">
                    <h2 className="text-2xl font-bold">Something went wrong!</h2>
                    <p className="text-muted-foreground">
                        An unexpected error occurred while rendering this page.
                    </p>

                    {process.env.NODE_ENV === 'development' && (
                        <div className="mt-4 rounded-lg bg-secondary p-4 text-left">
                            <p className="font-mono text-xs text-secondary-foreground">
                                {error.message}
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex gap-3 justify-center">
                    <Button onClick={reset} variant="default">
                        Try again
                    </Button>
                    <Button onClick={() => window.location.href = '/'} variant="outline">
                        Go to home
                    </Button>
                </div>
            </div>
        </div>
    );
}
