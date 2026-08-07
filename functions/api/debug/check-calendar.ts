import { getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey } from '../../_lib/env'

export interface Env {
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  PERSONAL_CALENDAR_ID?: string
  PERSONAL?: string
  PERSONAL_CALENDAR?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  ENVIRONMENT?: string
  SITE_URL?: string
  [key: string]: any
}

async function getAccessToken(saKeyRaw: string, scope: string): Promise<{ accessToken: string; clientEmail: string; error?: string }> {
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
      scope,
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
    const sigArr = new Uint8Array(sigBuf)
    let binary = ''
    sigArr.forEach((b) => (binary += String.fromCharCode(b)))
    const sigB64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const jwt = `${headerB64}.${payloadB64}.${sigB64}`

    const tokenRes = await fetch(saKey.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '')
      throw new Error(`Token exchange ${tokenRes.status} ${txt}`)
    }
    const tokenJson = (await tokenRes.json()) as any
    if (!tokenJson.access_token) throw new Error('No access_token')
    return { accessToken: tokenJson.access_token, clientEmail: saKey.client_email }
  } catch (e: any) {
    return { accessToken: '', clientEmail: '', error: e?.message || String(e) }
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const bookingId = getBookingCalendarId(env)
  const personalId = getPersonalCalendarId(env)
  const gcalKeyRaw = getGcalServiceKey(env)

  const url = new URL(request.url)
  const doWriteTest = url.searchParams.get('write') === 'true' || url.searchParams.get('testWrite') === 'true'

  const result: any = {
    timestamp: new Date().toISOString(),
    env: env?.ENVIRONMENT || 'unknown',
    secrets: {
      bookingCalendarId: !!bookingId,
      bookingCalendarIdValue: bookingId ? `${bookingId.slice(0, 8)}...${bookingId.slice(-15)}` : 'NOT SET',
      bookingPresentVia: {
        BOOKING_CALENDAR_ID: !!(env as any)?.BOOKING_CALENDAR_ID,
        BOOKING: !!(env as any)?.BOOKING,
        BOOKING_CALENDAR: !!(env as any)?.BOOKING_CALENDAR,
      },
      personalCalendarId: !!personalId,
      personalPresentVia: {
        PERSONAL_CALENDAR_ID: !!(env as any)?.PERSONAL_CALENDAR_ID,
        PERSONAL: !!(env as any)?.PERSONAL,
      },
      gcalKey: !!gcalKeyRaw,
      gcalKeyLength: gcalKeyRaw ? gcalKeyRaw.length : 0,
    },
    checks: {} as any,
    guidance: {
      expected: {
        personal: 'See only free/busy (hide details) => freeBusyReader — correct for personal calendar (privacy)',
        booking: 'Make changes and see all event details => writer — required for booking calendars (allows create events with Meet)',
      },
      howToCheckUI:
        'Calendar Google https://calendar.google.com/calendar/r → left Settings for my calendars → click Bookings Alpha → Share with specific people → find portfolio-calendar@portfolio-webapp-503319... → dropdown should show Make changes and see all event details (not free/busy)',
      howToFix:
        'If dropdown shows free/busy or See all event details, click dropdown → change to Make changes and see all event details → Send/Update. Then Retry deployment or wait 1-2 min for Google propagation, then hit this endpoint again with ?write=true to test create.',
    },
  }

  if (!gcalKeyRaw) {
    result.checks.error = 'GCAL_SERVICE_ACCOUNT_KEY missing — cannot check calendar permissions'
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers })
  }
  if (!bookingId) {
    result.checks.error = 'BOOKING_CALENDAR_ID missing — check Dashboard Preview secrets (you said you have it encrypted, verify name is BOOKING_CALENDAR_ID or BOOKING)'
    result.checks.bookingIdPresentVia = result.secrets.bookingPresentVia
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers })
  }

  // 1. Get access token with readonly for FreeBusy test
  const roToken = await getAccessToken(gcalKeyRaw, 'https://www.googleapis.com/auth/calendar.readonly')
  result.checks.readonlyToken = {
    ok: !!roToken.accessToken,
    clientEmail: roToken.clientEmail || 'unknown',
    error: roToken.error,
  }

  if (!roToken.accessToken) {
    result.checks.error = `Failed to get readonly token: ${roToken.error}`
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers })
  }

  // 2. Try FreeBusy on booking + personal (read test)
  try {
    const timeMin = new Date().toISOString()
    const timeMax = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
    const calendarIds = [bookingId, personalId].filter((x): x is string => Boolean(x))
    const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${roToken.accessToken}` },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: calendarIds.map((id) => ({ id })),
      }),
    })
    const fbText = await fbRes.text()
    let fbJson: any = {}
    try {
      fbJson = JSON.parse(fbText)
    } catch {}
    result.checks.freeBusy = {
      status: fbRes.status,
      ok: fbRes.ok,
      error: !fbRes.ok ? fbText.slice(0, 500) : undefined,
      calendars: fbJson.calendars ? Object.keys(fbJson.calendars) : [],
      // If freeBusy works, SA has at least freeBusyReader on both calendars
      interpretation:
        fbRes.ok
          ? 'FreeBusy OK — SA can read free/busy for both calendars (personal free/busyReader OK, booking at least reader). This matches your slots endpoint source live.'
          : 'FreeBusy FAILED — SA not shared or ID wrong',
    }
  } catch (e: any) {
    result.checks.freeBusy = { ok: false, error: e?.message }
  }

  // 3. Try GET calendar metadata (requires reader at least)
  try {
    const metaRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}`, {
      headers: { Authorization: `Bearer ${roToken.accessToken}` },
    })
    const metaText = await metaRes.text()
    result.checks.calendarMetadata = {
      status: metaRes.status,
      ok: metaRes.ok,
      error: !metaRes.ok ? metaText.slice(0, 800) : undefined,
      interpretation: metaRes.ok
        ? 'SA can read calendar metadata (reader+) — booking calendar exists and shared'
        : metaRes.status === 404
          ? '404 — calendar ID not found or not shared at all (check ID typo, or SA not in Share list)'
          : metaRes.status === 403
            ? '403 — SA has only freeBusyReader (free/busy only) — needs at least reader to see metadata, and writer to create events'
            : `Failed ${metaRes.status}`,
    }
  } catch (e: any) {
    result.checks.calendarMetadata = { ok: false, error: e?.message }
  }

  // 4. Try LIST ACL to see exact role (if allowed — may need writer?)
  try {
    const aclRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/acl`, {
      headers: { Authorization: `Bearer ${roToken.accessToken}` },
    })
    const aclText = await aclRes.text()
    let aclJson: any = {}
    try {
      aclJson = JSON.parse(aclText)
    } catch {}
    const saRule = aclJson.items?.find((r: any) => r.scope?.value === roToken.clientEmail || r.scope?.value?.includes('portfolio-calendar'))
    type AclRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner'
    const roleMap: Record<AclRole, string> = {
      freeBusyReader: 'See only free/busy (hide details) — GOOD for personal, BAD for booking (cannot create events)',
      reader: 'See all event details — still cannot create events, need writer',
      writer: 'Make changes and see all event details or Make changes to events — GOOD for booking (can create events with Meet)',
      owner: 'Make changes and manage sharing — also GOOD for booking',
    }
    result.checks.acl = {
      status: aclRes.status,
      ok: aclRes.ok,
      saRule: saRule
        ? { role: saRule.role, scope: saRule.scope, etag: saRule.etag }
        : 'SA rule not found in ACL list — maybe need owner to list ACL, or SA email mismatch',
      allRoles: aclJson.items?.map((i: any) => ({ email: i.scope?.value, role: i.role })).slice(0, 10),
      error: !aclRes.ok ? aclText.slice(0, 800) : undefined,
      roleInterpretation: saRule
        ? (roleMap[saRule.role as AclRole] || `Unknown role ${saRule.role}`)
        : 'No SA ACL rule found',
    }
  } catch (e: any) {
    result.checks.acl = { ok: false, error: e?.message, note: 'Listing ACL may require owner permission, 403 expected if SA is only writer/freeBusyReader' }
  }

  // 5. Write test — try to create a real event then delete it (only if ?write=true)
  if (doWriteTest) {
    const writeToken = await getAccessToken(gcalKeyRaw, 'https://www.googleapis.com/auth/calendar')
    result.checks.writeToken = { ok: !!writeToken.accessToken, error: writeToken.error, clientEmail: writeToken.clientEmail }
    if (!writeToken.accessToken) {
      result.checks.writeTest = { ok: false, error: writeToken.error }
    } else {
      const testStart = new Date(Date.now() + 48 * 3600 * 1000)
      testStart.setMinutes(0, 0, 0)
      const testEnd = new Date(testStart.getTime() + 30 * 60000)
      const testEvent = {
        summary: '[TEST] Permission check — delete me',
        description: `Test event created by ${writeToken.clientEmail} to verify writer permission — will be deleted immediately. Time: ${new Date().toISOString()}`,
        start: { dateTime: testStart.toISOString(), timeZone: 'America/New_York' },
        end: { dateTime: testEnd.toISOString(), timeZone: 'America/New_York' },
      }
      try {
        const createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?sendUpdates=none`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${writeToken.accessToken}` },
          body: JSON.stringify(testEvent),
        })
        const createText = await createRes.text()
        let created: any = {}
        try {
          created = JSON.parse(createText)
        } catch {}
        if (!createRes.ok) {
          result.checks.writeTest = {
            ok: false,
            status: createRes.status,
            error: createText.slice(0, 1000),
            interpretation:
              createRes.status === 403
                ? '403 Forbidden — SA does NOT have writer permission on booking calendar. Current permission is likely free/busy or reader. Fix: Calendar Settings → Share → SA → Make changes and see all event details'
                : createRes.status === 404
                  ? '404 Not Found — calendar ID wrong or not shared at all'
                  : `Failed ${createRes.status}`,
          }
        } else {
          // Try delete immediately
          let deleteOk = false
          let deleteError = ''
          try {
            const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events/${encodeURIComponent(created.id)}?sendUpdates=none`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${writeToken.accessToken}` },
            })
            deleteOk = delRes.ok || delRes.status === 204 || delRes.status === 410 || delRes.status === 404
            if (!deleteOk) deleteError = await delRes.text().catch(() => '')
          } catch (e: any) {
            deleteError = e?.message
          }
          result.checks.writeTest = {
            ok: true,
            status: createRes.status,
            createdEventId: created.id,
            summary: created.summary,
            htmlLink: created.htmlLink,
            deleted: deleteOk,
            deleteError: deleteError || undefined,
            interpretation: 'SUCCESS — SA has writer permission — can create and delete events — booking should produce real Meet links, not fake',
          }
        }
      } catch (e: any) {
        result.checks.writeTest = { ok: false, error: e?.message }
      }
    }
  } else {
    result.checks.writeTest = {
      skipped: true,
      note: 'Write test skipped — add ?write=true to actually try creating a test event (creates then deletes). This is the definitive check for fake Meet root cause.',
      how: `${url.origin}${url.pathname}?write=true`,
    }
  }

  return new Response(JSON.stringify(result, null, 2), { status: 200, headers })
}
