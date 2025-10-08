import { NextRequest, NextResponse } from 'next/server'
import Mixpanel from 'mixpanel'

const mixpanel = Mixpanel.init(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '', {
  protocol: 'https'
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event, properties, distinctId, peopleSet } = body

    if (!process.env.NEXT_PUBLIC_MIXPANEL_TOKEN) {
      return NextResponse.json({ success: false, error: 'Mixpanel not configured' }, { status: 200 })
    }

    // Extract client IP for geolocation
    const forwarded = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : realIp || request.ip || undefined

    // Handle identify + people.set
    if (distinctId && peopleSet) {
      mixpanel.people.set(distinctId, peopleSet)
    }

    // Handle track
    if (event) {
      mixpanel.track(event, {
        distinct_id: distinctId,
        ip: clientIp,
        ...properties
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error tracking event:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to track event' },
      { status: 500 }
    )
  }
}
