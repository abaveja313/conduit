declare global {
    interface Window {
        gtag?: (command: string, ...args: unknown[]) => void;
    }
}

// GA4 Measurement ID
export const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_TRACKING_ID || 'G-2P1500GZMF';

// Check if Google Analytics should be enabled
export const isGAEnabled = !!GA_TRACKING_ID;

// Track page views
export const pageview = (url: string) => {
    if (!isGAEnabled || typeof window === 'undefined' || !window.gtag) return;

    window.gtag('config', GA_TRACKING_ID, {
        page_path: url,
    });
};

// Track custom events with strong typing
type GAEventParams = {
    // Page View is tracked automatically by GA4, but we can track it manually if needed
    'page_view'?: {
        page_path?: string;
        page_title?: string;
        page_location?: string;
    };
    'Message Submitted': {
        message_length?: number;
        model?: string;
        timestamp?: string;
    };
    'Tool Invoked': {
        tool_name: string;
        timestamp?: string;
    };
    'Changes Persisted': {
        files_modified?: number;
        files_deleted?: number;
        total_files?: number;
        timestamp?: string;
    };
    'Changes Reverted': {
        files_reverted?: number;
        timestamp?: string;
    };
};

// Generic event tracking function with type safety
export function trackEvent<T extends keyof GAEventParams>(
    action: T,
    params?: GAEventParams[T]
): void {
    if (!isGAEnabled || typeof window === 'undefined' || !window.gtag) return;

    window.gtag('event', action, {
        ...params,
        // Add any global parameters here if needed
    });
}
