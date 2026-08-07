import { getBookingCalendarId, getGcalServiceKey, hasOAuthConfig } from '../../_lib/env'
import { TIMEZONE } from '../../_lib/google-calendar'
import { verifyTurnstile } from '../../_lib/turnstile'

export interface Env {
  DB?: any
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REFRESH_TOKEN?: string
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_SITE_KEY?: string
  RESEND_API_KEY?: string
  SITE_URL?: string
  ENVIRONMENT?: string
  TIMEZONE?: string
  STUB?: string
  [key: string]: any
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    console.log('!!! LOOKUP_REQUEST_START')
    const body = (await request.json()) as any
    const email = String(body.email || '').trim().toLowerCase()
    const turnstileToken = String(body.turnstileToken || body.turnstile_token || '').trim()

    console.log(`!!! LOOKUP_VALIDATION email=${email} hasToken=${!!turnstileToken} env=${env?.ENVIRONMENT}`)

    if (!email || !isValidEmail(email)) {
      console.log('!!! LOOKUP_INVALID_EMAIL')
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers })
    }

    // Turnstile verification for lookup to prevent enumeration abuse (bypass local/test)
    try {
      const { getTurnstileSecret } = await import('../../_lib/env')
      const secret = getTurnstileSecret(env) || env?.TURNSTILE_SECRET_KEY || ''
      const turnstileResult = await verifyTurnstile(turnstileToken, secret, {
        ENVIRONMENT: env?.ENVIRONMENT,
        STUB: env?.STUB,
        REMOTE_IP: (request as any).headers?.get?.('CF-Connecting-IP') || '',
        ...env,
      })
      console.log(`!!! LOOKUP_TURNSTILE ok=${turnstileResult.ok} source=${turnstileResult.source} error=${turnstileResult.error || 'none'}`)
      if (!turnstileResult.ok) {
        console.log('!!! LOOKUP_TURNSTILE_FAILED')
        return new Response(JSON.stringify({ error: 'Turnstile verification failed', details: turnstileResult.error }), { status: 400, headers })
      }
    } catch (e: any) {
      console.log(`!!! LOOKUP_TURNSTILE_EXCEPTION ${e?.message}`)
    }

    const db = env?.DB
    if (!db) {
      console.log('!!! LOOKUP_DB_MISSING')
      return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500, headers })
    }

    // Lookup contact by email
    console.log(`!!! LOOKUP_CONTACT_START email=${email}`)
    let contact: any = null
    try {
      const stmt = db.prepare('SELECT id, email FROM contacts WHERE email = ?1')
      contact = await stmt.bind(email).first()
    } catch (e: any) {
      console.log(`!!! LOOKUP_CONTACT_ERROR ${e?.message}`)
    }

    if (!contact) {
      console.log('!!! LOOKUP_CONTACT_NOT_FOUND')
      return new Response(JSON.stringify({ bookings: [], count: 0, message: 'No bookings found for this email' }), { status: 200, headers })
    }

    console.log(`!!! LOOKUP_BOOKINGS_START contactId=${contact.id}`)

    let bookings: any[] = []
    try {
      const stmt = db.prepare('SELECT id, calendar_event_id, purpose, cancel_token, status, created_at, slot_start, slot_end FROM bookings WHERE contact_id = ?1 ORDER BY slot_start ASC')
      const result = await stmt.bind(contact.id).all()
      bookings = result.results || []
    } catch (e: any) {
      console.log(`!!! LOOKUP_BOOKINGS_ERROR ${e?.message} trying alternative`)
      try {
        const stmt = db.prepare('SELECT * FROM bookings WHERE contact_id = ?1')
        const result = await stmt.bind(contact.id).all()
        bookings = result.results || []
      } catch {}
    }

    console.log(`!!! LOOKUP_BOOKINGS_RESULT count=${bookings.length}`)

    // Filter only confirmed upcoming (not cancelled) and map with dateTime ET + purpose
    const siteUrl = env?.SITE_URL || 'https://profile-webapp.pages.dev'
    const timeZone = env?.TIMEZONE || TIMEZONE

    const now = Date.now()
    const filtered = bookings
      .filter((b: any) => b.status !== 'cancelled')
      // The empty state says "No upcoming bookings", so a meeting that has already
      // happened must not be listed with a Cancel button next to it.
      .filter((b: any) => !b.slot_start || new Date(b.slot_start).getTime() >= now)
      .map((b: any) => {
        // slot_start is the meeting time (migration 0007). This used to print created_at
        // — the moment the form was submitted — so the card named the wrong day and the
        // cancel confirmation repeated it. Rows predating 0007 have no slot time at all,
        // and saying so beats printing a plausible wrong one.
        const dateTimeEt = b.slot_start
          ? new Date(b.slot_start).toLocaleString('en-US', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
          : 'Time not recorded — check your confirmation email'

        return {
          id: b.id,
          purpose: b.purpose || null,
          calendarEventId: b.calendar_event_id,
          cancelToken: b.cancel_token,
          cancelUrl: `${siteUrl}/api/cancel/${b.cancel_token}`,
          status: b.status,
          createdAt: b.created_at,
          slotStart: b.slot_start || null,
          dateTime: dateTimeEt,
          meetLink: '', // Meet link not stored in D1 currently, only in email — could be fetched via Google API if needed
        }
      })
      // Soonest first: the meeting a visitor is most likely to be managing.
      .sort((a: any, b: any) => (a.slotStart || '').localeCompare(b.slotStart || ''))

    console.log(`!!! LOOKUP_RETURN count=${filtered.length}`)

    return new Response(
      JSON.stringify({
        bookings: filtered,
        count: filtered.length,
        email,
        message: filtered.length > 0 ? `Found ${filtered.length} booking(s)` : 'No upcoming bookings found',
      }),
      { status: 200, headers }
    )
  } catch (e: any) {
    console.log(`!!! LOOKUP_EXCEPTION ${e?.message}`)
    return new Response(JSON.stringify({ error: 'Lookup failed', message: e?.message }), { status: 500, headers })
  }
}

// Also support GET for simple testing ?email=
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const email = url.searchParams.get('email') || ''
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }
  console.log(`!!! LOOKUP_GET email=${email}`)
  // Reuse POST logic by creating fake request
  const fakeReq = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken: 'fake-token-for-test' }),
  })
  return onRequestPost({ request: fakeReq as any, env } as any)
}
