import posthog from 'posthog-js';

// Initialize PostHog for client-side tracking
// This file is automatically loaded by Next.js 15.3+ on client-side
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: window.location.origin + '/telemetry-x7f9',
        ui_host: 'https://us.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        disable_session_recording: false,
        capture_performance: true,
        // Enable exception autocapture
        capture_exceptions: true
    });
}
