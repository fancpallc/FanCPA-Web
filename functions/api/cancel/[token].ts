import { getBookingCalendarId, getGcalServiceKey } from '../../_lib/env'

export interface Env {
  DB?: any
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  SITE_URL?: string
  ENVIRONMENT?: string
  STUB?: string
  [key: string]: any
}

async function deleteCalendarEvent(env: Env, calendarEventId: string): Promise<{ success: boolean; source: 'live' | 'stub'; error?: string }> {
  const saKeyRaw = getGcalServiceKey(env) || (env as any)?.GCAL_SERVICE_ACCOUNT_KEY
  const bookingId = getBookingCalendarId(env) || (env as any)?.BOOKING_CALENDAR_ID || (env as any)?.BOOKING
  const isStub = !saKeyRaw || !bookingId || env?.STUB === 'true' || env?.ENVIRONMENT === 'test' || env?.ENVIRONMENT === 'local'

  if (isStub) {
    console.log(`[STUB Cancel] Would delete event ${calendarEventId} from calendar ${bookingId || 'stub'}`)
    return { success: true, source: 'stub' }
  }

  try {
    let saKey: any
    if (typeof saKeyRaw === 'string') {
      saKey = JSON.parse(saKeyRaw)
    } else {
      saKey = saKeyRaw
    }

    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const payload = {
      iss: saKey.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: saKey.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const enc = (obj: any) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const pem = saKey.private_key
    if (!pem) throw new Error('No private_key in SA JSON')
    const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '')
    const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
    const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const headerB64 = enc(header)
    const payloadB64 = enc(payload)
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data)
    const sigArray = new Uint8Array(sigBuf)
    let binary = ''
    sigArray.forEach((b) => (binary += String.fromCharCode(b)))
    const sigB64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const jwt = `${headerB64}.${payloadB64}.${sigB64}`

    const tokenRes = await fetch(saKey.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '')
      throw new Error(`Token exchange failed ${tokenRes.status} ${txt}`)
    }

    const tokenJson = (await tokenRes.json()) as any
    const accessToken = tokenJson.access_token
    if (!accessToken) throw new Error('No access token from Google')

    const deleteRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId!)}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!deleteRes.ok && deleteRes.status !== 410 && deleteRes.status !== 404) {
      // 410 gone or 404 not found is okay — already deleted
      const txt = await deleteRes.text().catch(() => '')
      throw new Error(`Delete event failed ${deleteRes.status} ${txt}`)
    }

    return { success: true, source: 'live' }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error(`[Cancel] Failed to delete ${calendarEventId}: ${msg}`)
    return { success: false, source: 'live', error: msg }
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const token = (params as any)?.token as string
    if (!token) {
      return new Response('<h1>Missing token</h1><p>Cancel link invalid — token required.</p>', { status: 400, headers })
    }

    const db = (env as any)?.DB
    if (!db) {
      return new Response('<h1>DB not configured</h1>', { status: 500, headers })
    }

    // Look up booking by cancel_token
    let booking: any = null
    try {
      const stmt = db.prepare('SELECT id, calendar_event_id, cancel_token, status FROM bookings WHERE cancel_token = ?1')
      booking = await stmt.bind(token).first()
    } catch {
      // Fallback for test D1
      try {
        const stmt = db.prepare('SELECT * FROM bookings WHERE cancel_token = ?1')
        booking = await stmt.bind(token).first()
      } catch {}
    }

    if (!booking) {
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Cancel link invalid or already used</h2>
          <p>Booking not found for token <code>${token.slice(0, 8)}...</code></p>
          <p>It may have already been cancelled.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `,
        { status: 404, headers },
      )
    }

    if (booking.status === 'cancelled') {
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Already cancelled ✅</h2>
          <p>This meeting was already cancelled.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Book another</a>
        </div>
        `,
        { status: 200, headers },
      )
    }

    // Delete from Google Calendar if event ID exists and not stub
    let gcalResult: any = { success: true, source: 'stub' }
    if (booking.calendar_event_id && !String(booking.calendar_event_id).startsWith('stub-event-') && !String(booking.calendar_event_id).startsWith('missing-')) {
      gcalResult = await deleteCalendarEvent(env, booking.calendar_event_id)
    }

    // Mark as cancelled in D1 (or delete — we mark cancelled for audit)
    try {
      const updateStmt = db.prepare('UPDATE bookings SET status = ?1, updated_at = datetime("now") WHERE id = ?2')
      await updateStmt.bind('cancelled', booking.id).run()
    } catch {
      try {
        const delStmt = db.prepare('DELETE FROM bookings WHERE id = ?1')
        await delStmt.bind(booking.id).run()
      } catch {}
    }

    const isJson = request.headers.get('Accept')?.includes('application/json') || new URL(request.url).searchParams.get('format') === 'json'

    if (isJson) {
      return new Response(
        JSON.stringify({
          success: true,
          cancelled: true,
          calendarDeleted: gcalResult.success,
          source: gcalResult.source,
          error: gcalResult.error,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      )
    }

    return new Response(
      `
      <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#f8fafc;">
        <h1 style="font-family:Playfair Display,serif;font-size:28px;font-weight:900;letter-spacing:-0.02em;">Meeting cancelled ✅</h1>
        <p style="margin-top:12px;color:#475569;line-height:1.6;">Your meeting has been cancelled. The calendar event has been ${gcalResult.success ? 'removed' : 'attempted to remove'} (${gcalResult.source})${gcalResult.error ? ` — ${gcalResult.error}` : ''}.</p>
        <p style="margin-top:8px;color:#64748b;font-size:13px;">Slot is now free for others.</p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/" style="padding:12px 24px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Book another</a>
          <a href="/#calendar" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;">View calendar</a>
        </div>
      </div>
      `,
      { status: 200, headers },
    )
  } catch (e: any) {
    return new Response(`<h1>Cancel failed</h1><p>${e?.message || String(e)}</p>`, { status: 500, headers })
  }
}

// Also support DELETE for API clients
export const onRequestDelete: PagesFunction<Env> = async (ctx: any) => {
  // Reuse GET logic but return JSON
  const request = new Request(ctx.request.url, { headers: { ...Object.fromEntries(ctx.request.headers), Accept: 'application/json' } })
  return onRequestGet({ ...ctx, request } as any)
}
