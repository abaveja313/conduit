"use client"

import { useEffect } from "react"
import mixpanel from "mixpanel-browser"

export function MixpanelProvider() {
  useEffect(() => {
    // Initialize Mixpanel
    mixpanel.init('46a92db9d5795f709a36d8981fa1b67b', {
      debug: process.env.NODE_ENV === 'development',
      track_pageview: true,
      persistence: 'localStorage',
      api_host: 'https://api-eu.mixpanel.com',
    })
  }, [])

  return null
}

// Export mixpanel instance for use in other components
export { mixpanel }

