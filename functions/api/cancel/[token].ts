import { getBookingCalendarId, getGcalServiceKey, hasOAuthConfig } from '../../_lib/env'
import { getOAuthAccessToken } from '../../_lib/google-oauth'

export interface Env {
  DB?: any
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REFRESH_TOKEN?: string
  OAUTH_CLIENT_ID?: string
  OAUTH_CLIENT_SECRET?: string
  OAUTH_REFRESH_TOKEN?: string
  SITE_URL?: string
  ENVIRONMENT?: string
  STUB?: string
  [key: string]: any
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlPage({ title, body }: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:Inter,system-ui,sans-serif;background:#fff;color:#0f172a;margin:0;padding:24px;">
${body}
</body>
</html>`
}

async function deleteCalendarEvent(env: Env, calendarEventId: string, opts?: { shouldNotify?: boolean }): Promise<{ success: boolean; source: 'live' | 'stub'; error?: string }> {
  const shouldNotify = opts?.shouldNotify !== false
  const sendUpdates = shouldNotify ? 'all' : 'none'
  const saKeyRaw = getGcalServiceKey(env) || (env as any)?.GCAL_SERVICE_ACCOUNT_KEY
  const bookingId = getBookingCalendarId(env) || (env as any)?.BOOKING_CALENDAR_ID || (env as any)?.BOOKING
  const hasCreds = !!saKeyRaw || hasOAuthConfig(env)
  const isStub = !hasCreds || !bookingId || env?.STUB === 'true' || env?.ENVIRONMENT === 'test' || env?.ENVIRONMENT === 'local'

  if (isStub) {
    console.log(`[STUB Cancel] Would delete event ${calendarEventId} from calendar ${bookingId || 'stub'}`)
    return { success: true, source: 'stub' }
  }

  if (hasOAuthConfig(env)) {
    try {
      const { accessToken, error: tokenErr } = await getOAuthAccessToken(env)
      if (accessToken) {
        const deleteRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId!)}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=${sendUpdates}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (deleteRes.ok || deleteRes.status === 404 || deleteRes.status === 410) {
          return { success: true, source: 'live' }
        }
        const txt = await deleteRes.text().catch(() => '')
        console.log(`!!! CANCEL_OAUTH_DELETE_FAIL status=${deleteRes.status} body=${txt.slice(0, 300)}`)
      } else {
        console.log(`!!! CANCEL_OAUTH_NO_TOKEN error=${tokenErr}`)
      }
    } catch (e: any) {
      console.log(`!!! CANCEL_OAUTH_EXCEPTION ${e?.message}`)
    }
  }

  try {
    let saKey: any
    if (typeof saKeyRaw === 'string') saKey = JSON.parse(saKeyRaw)
    else saKey = saKeyRaw

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

    const deleteRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId!)}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=${sendUpdates}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!deleteRes.ok && deleteRes.status !== 410 && deleteRes.status !== 404) {
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

async function getBookingByToken(db: any, token: string): Promise<any | null> {
  try {
    const stmt = db.prepare('SELECT id, calendar_event_id, cancel_token, status, slot_start FROM bookings WHERE cancel_token = ?1')
    const b = await stmt.bind(token).first()
    if (b) return b
  } catch {}
  try {
    const stmt = db.prepare('SELECT * FROM bookings WHERE cancel_token = ?1')
    return await stmt.bind(token).first()
  } catch {
    return null
  }
}

function isTooLateToCancelOnline(slotStartIso?: string | null): boolean {
  if (!slotStartIso) return false
  try {
    const slotTime = new Date(slotStartIso).getTime()
    const now = Date.now()
    const twentyFourHours = 24 * 60 * 60 * 1000
    return !isNaN(slotTime) && slotTime - now < twentyFourHours && slotTime > now
  } catch {
    return false
  }
}

async function doCancel(env: Env, db: any, booking: any): Promise<{ gcalResult: any; dbOk: boolean; dbError?: string }> {
  let gcalResult: any = { success: true, source: 'stub' }
  if (booking.calendar_event_id && !String(booking.calendar_event_id).startsWith('stub-event-') && !String(booking.calendar_event_id).startsWith('missing-')) {
    gcalResult = await deleteCalendarEvent(env, booking.calendar_event_id)
  }
  try {
    const updateStmt = db.prepare(`UPDATE bookings SET status = ?1, updated_at = datetime("now"), cancelled_at = datetime("now"), cancelled_by = ?2 WHERE id = ?3`)
    await updateStmt.bind('cancelled', 'client', booking.id).run()
    return { gcalResult, dbOk: true }
  } catch (e: any) {
    console.log(`!!! CANCEL_UPDATE_FAILED id=${booking.id} ${e?.message}`)
    return { gcalResult, dbOk: false, dbError: e?.message || String(e) }
  }
}

function interstitialPage(token: string, booking: any): string {
  const when = booking.slot_start ? escapeHtml(new Date(booking.slot_start).toLocaleString()) : 'N/A'
  return htmlPage({
    title: 'Confirm cancellation',
    body: `
      <div style="max-width:600px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;">
        <h1 style="font-size:24px;font-weight:900;">Cancel this meeting?</h1>
        <p style="margin-top:12px;color:#475569;line-height:1.6;">You’re about to cancel your meeting at <strong>${when}</strong>. This will remove the calendar event and free the slot. This confirmation step prevents Outlook Safe Links and prefetchers from cancelling automatically.</p>
        <p style="margin-top:8px;color:#64748b;font-size:13px;">Meeting ID: ${escapeHtml(booking.id)} · Token: ${escapeHtml(token.slice(0, 8))}…</p>
        <form method="POST" action="/api/cancel/${escapeHtml(token)}" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <button type="submit" style="padding:12px 24px;background:#dc2626;color:white;border-radius:999px;font-weight:600;font-size:14px;border:0;cursor:pointer;">Yes, cancel meeting</button>
          <a href="/" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;display:inline-flex;align-items:center;">Keep booking</a>
        </form>
        <p style="margin-top:16px;font-size:12px;color:#64748b;">If you didn’t mean to cancel, close this page or click Keep booking. Cancellation is only completed after you press “Yes”.</p>
      </div>
    `,
  })
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const htmlHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }

  try {
    const token = (params as any)?.token as string
    if (!token) {
      return new Response(htmlPage({ title: 'Invalid link', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Invalid link</h1><p>Cancel link invalid - token required.</p><a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a></div>` }), { status: 400, headers: htmlHeaders })
    }

    const db = (env as any)?.DB
    if (!db) {
      return new Response(htmlPage({ title: 'Temporarily unavailable', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Temporarily unavailable</h1><p>Please try again in a moment.</p><a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a></div>` }), { status: 500, headers: htmlHeaders })
    }

    const booking = await getBookingByToken(db, token)

    if (!booking) {
      return new Response(htmlPage({ title: 'Link invalid', body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Cancel link invalid or already used</h2>
          <p>Booking not found for token <code>${escapeHtml(token.slice(0, 8))}...</code></p>
          <p>It may have already been cancelled.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `}), { status: 404, headers: htmlHeaders })
    }

    if (booking.status === 'cancelled') {
      return new Response(htmlPage({ title: 'Already cancelled', body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Already cancelled ✅</h2>
          <p>This meeting was already cancelled.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Book another</a>
        </div>
        `}), { status: 200, headers: htmlHeaders })
    }

    const tooLate = isTooLateToCancelOnline(booking.slot_start)
    const isJsonReq = request.headers.get('Accept')?.includes('application/json') || new URL(request.url).searchParams.get('format') === 'json'

    if (tooLate) {
      if (isJsonReq) {
        return new Response(JSON.stringify({ error: 'Too late to cancel - within 24 hours', slot_start: booking.slot_start }), { status: 400, headers: jsonHeaders })
      }
      return new Response(htmlPage({ title: 'Too late to cancel', body: `
        <div style="max-width:600px;margin:40px auto;padding:32px;border:1px solid #fca5a5;border-radius:24px;background:#fef2f2;">
          <h1 style="font-size:24px;font-weight:900;">Too late to cancel online</h1>
          <p style="margin-top:12px;color:#475569;line-height:1.6;">This meeting is within 24 hours and can no longer be cancelled online. Please reply to your confirmation email or contact us directly.</p>
          <p style="margin-top:8px;color:#64748b;font-size:13px;">Meeting time: ${escapeHtml(booking.slot_start)}</p>
          <div style="margin-top:24px;">
            <a href="/" style="padding:12px 24px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Back to home</a>
          </div>
        </div>
        `}), { status: 400, headers: htmlHeaders })
    }

    // JSON API path (ManageBookings, tests) — immediate cancel for backward compat (fetch with Accept: json)
    if (isJsonReq) {
      const { gcalResult, dbOk, dbError } = await doCancel(env, db, booking)
      if (!dbOk) {
        return new Response(htmlPage({ title: 'Cancel failed', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Failed to cancel - please try again</h1><p>${escapeHtml(dbError || '')}</p></div>` }), { status: 500, headers: htmlHeaders })
      }
      return new Response(JSON.stringify({ success: true, cancelled: true, calendarDeleted: gcalResult.success, source: gcalResult.source, error: gcalResult.error }), { status: 200, headers: jsonHeaders })
    }

    // HTML GET → interstitial, not immediate cancel (fixes P0 #3 Safe Links / prefetcher one-click cancel)
    return new Response(interstitialPage(token, booking), { status: 200, headers: htmlHeaders })
  } catch (e: any) {
    return new Response(htmlPage({ title: 'Cancel failed', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Cancel failed</h1><p>${escapeHtml(e?.message || String(e))}</p></div>` }), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ params, env, request }) => {
  const htmlHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  try {
    const token = (params as any)?.token as string
    if (!token) {
      return new Response(htmlPage({ title: 'Invalid link', body: `<div><h1>Invalid link</h1></div>` }), { status: 400, headers: htmlHeaders })
    }
    const db = (env as any)?.DB
    if (!db) {
      return new Response(htmlPage({ title: 'Temporarily unavailable', body: `<div><h1>Temporarily unavailable</h1></div>` }), { status: 500, headers: htmlHeaders })
    }
    const booking = await getBookingByToken(db, token)
    if (!booking) {
      return new Response(htmlPage({ title: 'Link invalid', body: `<div><h2>Not found</h2></div>` }), { status: 404, headers: htmlHeaders })
    }
    if (booking.status === 'cancelled') {
      return new Response(htmlPage({ title: 'Already cancelled', body: `<div><h2>Already cancelled ✅</h2></div>` }), { status: 200, headers: htmlHeaders })
    }
    if (isTooLateToCancelOnline(booking.slot_start)) {
      const isJsonReq = request.headers.get('Accept')?.includes('application/json') || new URL(request.url).searchParams.get('format') === 'json'
      if (isJsonReq) {
        return new Response(JSON.stringify({ error: 'Too late to cancel - within 24 hours', slot_start: booking.slot_start }), { status: 400, headers: jsonHeaders })
      }
      return new Response(htmlPage({ title: 'Too late to cancel', body: `<div><h1>Too late to cancel online</h1><p>Meeting time: ${escapeHtml(booking.slot_start)}</p></div>` }), { status: 400, headers: htmlHeaders })
    }

    const { gcalResult, dbOk, dbError } = await doCancel(env, db, booking)
    if (!dbOk) {
      return new Response(htmlPage({ title: 'Cancel failed', body: `<div><h1>Failed to cancel - please try again</h1><p>${escapeHtml(dbError || '')}</p></div>` }), { status: 500, headers: htmlHeaders })
    }

    const isJson = request.headers.get('Accept')?.includes('application/json') || new URL(request.url).searchParams.get('format') === 'json'
    if (isJson) {
      return new Response(JSON.stringify({ success: true, cancelled: true, calendarDeleted: gcalResult.success, source: gcalResult.source, error: gcalResult.error }), { status: 200, headers: jsonHeaders })
    }

    return new Response(htmlPage({ title: 'Meeting cancelled', body: `
      <div style="max-width:600px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#f8fafc;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:-0.02em;">Meeting cancelled ✅</h1>
        <p style="margin-top:12px;color:#475569;line-height:1.6;">Your meeting has been cancelled. The calendar event has been ${gcalResult.success ? 'removed' : 'attempted to remove'}.</p>
        <p style="margin-top:8px;color:#64748b;font-size:13px;">Slot is now free for others.</p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/" style="padding:12px 24px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Book another</a>
          <a href="/#calendar" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;">View calendar</a>
        </div>
      </div>
      `}), { status: 200, headers: htmlHeaders })
  } catch (e: any) {
    return new Response(htmlPage({ title: 'Cancel failed', body: `<div><h1>Cancel failed</h1><p>${escapeHtml(e?.message || String(e))}</p></div>` }), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}

export const onRequestDelete: PagesFunction<Env> = async (ctx: any) => {
  const request = new Request(ctx.request.url, { headers: { ...Object.fromEntries(ctx.request.headers), Accept: 'application/json' } })
  // DELETE is API path — immediate cancel via JSON branch of GET handler
  return onRequestGet({ ...ctx, request } as any)
}
