import posthog from 'posthog-js';

// Type definitions for our custom events
export interface ScanCompletedEvent {
    filesScanned: number;
    filesLoaded: number;
    binaryFilesSkipped: number;
    documentsExtracted: number;
    totalSize: number;
    duration: number;
    directoryMode: 'read' | 'readwrite';
    model: string;
    provider: 'anthropic';
}

export interface QuerySentEvent {
    model: string;
    messageLength: number;
    messageIndex: number;
}

export interface QueryCompletedEvent {
    model: string;
    duration: number;
    toolCallsCount: number;
    responseLength: number;
    tokensUsed?: number;
    success: boolean;
    errorType?: string;
}

export interface ToolInvokedEvent {
    toolName: string;
    operation?: string;
    path?: string;
    linesAffected?: number;
    fileSize?: number;
    isDocument?: boolean;
    duration: number;
    success: boolean;
    errorType?: string;
}

export interface ChangesCommittedEvent {
    filesModified: number;
    filesDeleted: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    duration: number;
}

export interface ChangesRevertedEvent {
    fileCount: number;
}

export interface BrowserCompatibilityIssueEvent {
    feature: string;
    userAgent: string;
    fallbackAvailable: boolean;
}

export interface WasmInitializationFailedEvent {
    error: string;
    memoryAvailable: number;
    retryAttempt: number;
}

export interface ApiErrorEvent {
    provider: string;
    errorCode: string;
    errorMessage: string;
    model: string;
}

export interface RateLimitHitEvent {
    provider: string;
    retryAfter: number;
    model: string;
}

export interface MemoryThresholdExceededEvent {
    heapUsed: number;
    heapLimit: number;
    percentage: number;
    operation: string;
}

// User properties interface
export interface UserProperties {
    total_queries?: number;
    total_tools_used?: number;
    preferred_model?: string;
    setup_completed_at?: string;
    files_in_workspace?: number;
    workspace_size?: number;
}

// Helper to ensure PostHog is available
const ensurePostHog = (): typeof posthog | null => {
    if (typeof window === 'undefined') return null;

    // PostHog is initialized in instrumentation-client.ts
    // This just returns the instance if it's available
    return posthog.__loaded ? posthog : null;
};

// Core tracking functions
export const trackScanCompleted = (event: ScanCompletedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('scan_completed', event);

    // Update user properties
    ph.people.set({
        files_in_workspace: event.filesLoaded,
        workspace_size: event.totalSize,
        setup_completed_at: new Date().toISOString(),
        preferred_model: event.model,
    });
};

export const trackQuerySent = (event: QuerySentEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('query_sent', event);

    // Track user's first query timestamp
    ph.people.set_once({ first_query_at: new Date().toISOString() });
};

export const trackQueryCompleted = (event: QueryCompletedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('query_completed', event);

    // Success/failure will be tracked through the event properties
};

export const trackToolInvoked = (event: ToolInvokedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('tool_invoked', event);

    // Tool usage will be tracked through event aggregation
};

export const trackChangesCommitted = (event: ChangesCommittedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('changes_committed', event);

    // Track last commit time
    ph.people.set({ last_commit_at: new Date().toISOString() });
};

export const trackChangesReverted = (event: ChangesRevertedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('changes_reverted', event);
};

export const trackBrowserCompatibilityIssue = (event: BrowserCompatibilityIssueEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('browser_compatibility_issue', event);

    // Mark user as having compatibility issues
    ph.people.set({ has_compatibility_issues: true });
};

export const trackWasmInitializationFailed = (event: WasmInitializationFailedEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('wasm_initialization_failed', event);

    ph.people.set({ wasm_initialization_failed: true });
};

export const trackApiError = (event: ApiErrorEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('api_error', event);

    // API errors will be tracked through event aggregation
};

export const trackRateLimitHit = (event: RateLimitHitEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('rate_limit_hit', event);

    // Track last rate limit occurrence
    ph.people.set({ last_rate_limit_at: new Date().toISOString() });
};

export const trackMemoryThresholdExceeded = (event: MemoryThresholdExceededEvent) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture('memory_threshold_exceeded', event);

    ph.people.set({ memory_issues: true });
};

// Utility functions
export const setUserProperties = (properties: UserProperties) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.people.set(properties);
};

export const identifyUser = (userId: string, properties?: UserProperties) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.identify(userId, properties);
};

// Feature flag helpers
export const isFeatureEnabled = (flagName: string): boolean => {
    const ph = ensurePostHog();
    if (!ph) return false;

    return ph.isFeatureEnabled(flagName) || false;
};

export const getFeatureFlagPayload = (flagName: string): unknown => {
    const ph = ensurePostHog();
    if (!ph) return null;

    return ph.getFeatureFlagPayload(flagName);
};


// Session replay control
export const startSessionRecording = () => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.startSessionRecording();
};

export const stopSessionRecording = () => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.stopSessionRecording();
};

// Reset user (for logout/clear)
export const reset = () => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.reset();
};

// Legacy compatibility (to replace gtag functions)
export const trackEvent = (eventName: string, eventParams?: Record<string, unknown>) => {
    const ph = ensurePostHog();
    if (!ph) return;

    ph.capture(eventName, eventParams);
};

// Exception capture
export const captureException = (error: Error | unknown, properties?: Record<string, unknown>) => {
    const ph = ensurePostHog();
    if (!ph) return;

    const errorObj = error instanceof Error ? error : new Error(String(error));

    ph.captureException(errorObj, {
        source: 'client',
        timestamp: new Date().toISOString(),
        pathname: window.location.pathname,
        href: window.location.href,
        ...properties,
    });
};

// Performance monitoring helpers
let queryStartTime: number | null = null;
const toolStartTimes: Map<string, number> = new Map();

export const startQueryTimer = () => {
    queryStartTime = performance.now();
};

export const endQueryTimer = (): number => {
    if (queryStartTime === null) return 0;
    const duration = performance.now() - queryStartTime;
    queryStartTime = null;
    return duration;
};

export const startToolTimer = (toolName: string) => {
    toolStartTimes.set(toolName, performance.now());
};

export const endToolTimer = (toolName: string): number => {
    const startTime = toolStartTimes.get(toolName);
    if (!startTime) return 0;
    const duration = performance.now() - startTime;
    toolStartTimes.delete(toolName);
    return duration;
};

// Browser capability detection
export const checkBrowserCompatibility = () => {
    const issues: string[] = [];

    // Check File System Access API
    if (!('showDirectoryPicker' in window)) {
        issues.push('FileSystemAPI');
        trackBrowserCompatibilityIssue({
            feature: 'FileSystemAPI',
            userAgent: navigator.userAgent,
            fallbackAvailable: false,
        });
    }

    // Check WebAssembly
    if (!('WebAssembly' in window)) {
        issues.push('WebAssembly');
        trackBrowserCompatibilityIssue({
            feature: 'WebAssembly',
            userAgent: navigator.userAgent,
            fallbackAvailable: false,
        });
    }

    return issues;
};

// Memory monitoring
export const checkMemoryUsage = () => {
    interface PerformanceMemory {
        usedJSHeapSize: number;
        jsHeapSizeLimit: number;
    }

    if ('memory' in performance) {
        const memory = (performance as unknown as { memory: PerformanceMemory }).memory;
        const percentage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

        if (percentage > 80) {
            trackMemoryThresholdExceeded({
                heapUsed: memory.usedJSHeapSize,
                heapLimit: memory.jsHeapSizeLimit,
                percentage,
                operation: 'general',
            });
            return { exceeded: true, percentage };
        }

        return { exceeded: false, percentage };
    }

    return { exceeded: false, percentage: 0 };
};

const posthogExports = {
    trackScanCompleted,
    trackQuerySent,
    trackQueryCompleted,
    trackToolInvoked,
    trackChangesCommitted,
    trackChangesReverted,
    trackBrowserCompatibilityIssue,
    trackWasmInitializationFailed,
    trackApiError,
    trackRateLimitHit,
    trackMemoryThresholdExceeded,
    setUserProperties,
    identifyUser,
    isFeatureEnabled,
    getFeatureFlagPayload,
    startSessionRecording,
    stopSessionRecording,
    reset,
    trackEvent,
    startQueryTimer,
    endQueryTimer,
    startToolTimer,
    endToolTimer,
    checkBrowserCompatibility,
    checkMemoryUsage,
};

export default posthogExports;
