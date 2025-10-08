"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const MIXPANEL_ENABLED = !!process.env.NEXT_PUBLIC_MIXPANEL_TOKEN

export function MixpanelProvider() {
    const pathname = usePathname()

    useEffect(() => {
        if (!MIXPANEL_ENABLED) return

        // Track pageview on mount and route changes
        mixpanelWrapper.track('Page View', {
            path: pathname,
            url: window.location.href,
            referrer: document.referrer
        })
    }, [pathname])

    return null
}

let currentDistinctId: string | null = null

const mixpanelWrapper = {
    track: async (event: string, properties?: Record<string, unknown>) => {
        if (!MIXPANEL_ENABLED) return

        try {
            await fetch('/api/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    properties,
                    distinctId: currentDistinctId
                })
            })
        } catch (error) {
            console.error('Failed to track event:', error)
        }
    },
    identify: async (id: string) => {
        if (!MIXPANEL_ENABLED) return
        currentDistinctId = id
    },
    people: {
        set: async (properties: Record<string, unknown>) => {
            if (!MIXPANEL_ENABLED) return

            try {
                await fetch('/api/event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        distinctId: currentDistinctId,
                        peopleSet: properties
                    })
                })
            } catch (error) {
                console.error('Failed to set people properties:', error)
            }
        }
    }
}

export { mixpanelWrapper as mixpanel }