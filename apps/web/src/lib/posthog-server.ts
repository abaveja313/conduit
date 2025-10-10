import { PostHog } from 'posthog-node';
import { createLogger } from '@conduit/shared';

const logger = createLogger('web:posthog-server');
let posthogInstance: PostHog | null = null;

export function getPostHogServer(): PostHog {
    if (!posthogInstance) {
        if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
            throw new Error('NEXT_PUBLIC_POSTHOG_KEY is not defined');
        }

        posthogInstance = new PostHog(
            process.env.NEXT_PUBLIC_POSTHOG_KEY,
            {
                host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
                flushAt: 1, // Flush events immediately in serverless environments
                flushInterval: 0, // Disable time-based flushing
            }
        );

        // Enable debug mode in development
        if (process.env.NODE_ENV === 'development') {
            posthogInstance.debug();
        }
    }

    return posthogInstance;
}

// Helper to capture server-side exceptions with additional context
export async function captureServerException(
    error: Error | unknown,
    distinctId?: string,
    properties?: Record<string, unknown>
) {
    const posthog = getPostHogServer();

    const errorObj = error instanceof Error ? error : new Error(String(error));

    await posthog.captureException(errorObj, distinctId || 'server-unknown', {
        source: 'server',
        environment: process.env.NODE_ENV || 'production',
        timestamp: new Date().toISOString(),
        ...properties,
        // Add stack trace if available
        stack: errorObj.stack,
        message: errorObj.message,
        name: errorObj.name,
    });
}

// Helper to extract distinct_id from PostHog cookie
export function extractDistinctIdFromCookie(cookieString?: string): string | null {
    if (!cookieString) return null;

    // Look for PostHog cookie (format: ph_phc_<project_key>_posthog)
    const postHogCookieMatch = cookieString.match(/ph_phc_.*?_posthog=([^;]+)/);

    if (postHogCookieMatch && postHogCookieMatch[1]) {
        try {
            const decodedCookie = decodeURIComponent(postHogCookieMatch[1]);
            const postHogData = JSON.parse(decodedCookie);
            return postHogData.distinct_id || null;
        } catch (e) {
            logger.error('Error parsing PostHog cookie:', e);
            return null;
        }
    }

    return null;
}

// Cleanup function for graceful shutdown
export async function shutdownPostHog() {
    if (posthogInstance) {
        await posthogInstance.shutdown();
        posthogInstance = null;
    }
}
