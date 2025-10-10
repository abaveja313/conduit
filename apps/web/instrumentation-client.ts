import posthog from 'posthog-js';

// Initialize PostHog for client-side tracking
// This file is automatically loaded by Next.js 15.3+ on client-side
if (typeof window !== 'undefined') {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
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
