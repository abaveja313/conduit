import { createLogger } from '@conduit/shared';

const logger = createLogger('web:instrumentation');

export function register() {
    // No-op for initialization
    // This is called when the instrumentation file is loaded
}

interface RequestError {
    digest?: string;
    message?: string;
    name?: string;
    stack?: string;
}

interface RequestInfo {
    url?: string;
    method?: string;
    headers: {
        cookie?: string;
        'user-agent'?: string;
        referer?: string;
    };
}

interface RequestContext {
    routerKind?: string;
    routePath?: string;
    renderSource?: string;
}

export const onRequestError = async (
    err: RequestError | Error,
    request: RequestInfo,
    context: RequestContext
) => {
    // Only run in Node.js runtime
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { getPostHogServer, extractDistinctIdFromCookie } = await import('./src/lib/posthog-server');
        const posthog = getPostHogServer();

        // Extract distinct_id from cookie
        const distinctId = extractDistinctIdFromCookie(request.headers.cookie) || 'server-unknown';

        // Build error properties
        const errorProperties = {
            source: 'server',
            url: request.url,
            method: request.method,
            userAgent: request.headers['user-agent'],
            referer: request.headers.referer,
            routerKind: context.routerKind,
            routePath: context.routePath,
            renderSource: context.renderSource,
            digest: 'digest' in err ? err.digest : undefined,
            timestamp: new Date().toISOString(),
        };

        // Convert to Error object if needed
        const error = err instanceof Error ? err : new Error(
            (err as RequestError).message || 'Unknown server error'
        );

        // Capture the exception
        await posthog.captureException(error, distinctId, errorProperties);

        // Log for debugging
        logger.error('Server error captured:', {
            message: error.message,
            url: request.url,
            distinctId,
            digest: 'digest' in err ? err.digest : undefined,
        });
    }
};
