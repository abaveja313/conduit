"use client"

import { useEffect } from "react"
import mixpanel from "mixpanel-browser"

const MIXPANEL_ENABLED = !!process.env.NEXT_PUBLIC_MIXPANEL_TOKEN

export function MixpanelProvider() {
    useEffect(() => {
        if (!MIXPANEL_ENABLED) {
            console.log('Mixpanel disabled - no token provided')
            return
        }

        mixpanel.init(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN!, {
            debug: process.env.NODE_ENV === 'development',
            track_pageview: true,
            persistence: 'localStorage',
            api_host: process.env.NEXT_PUBLIC_MIXPANEL_API_HOST || 'https://api.mixpanel.com',
            ignore_dnt: process.env.NEXT_PUBLIC_IGNORE_DNT?.toLowerCase() == "true"
        })
    }, [])

    return null
}

const mixpanelWrapper = {
    track: (event: string, properties?: Record<string, unknown>) => {
        if (MIXPANEL_ENABLED) {
            mixpanel.track(event, properties)
        }
    },
    identify: (id: string) => {
        if (MIXPANEL_ENABLED) {
            mixpanel.identify(id)
        }
    },
    people: {
        set: (properties: Record<string, unknown>) => {
            if (MIXPANEL_ENABLED) {
                mixpanel.people.set(properties)
            }
        }
    }
}

export { mixpanelWrapper as mixpanel }