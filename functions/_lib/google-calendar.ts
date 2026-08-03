import { getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey, hasOAuthConfig } from './env'
import { createBookingEventViaOAuth } from './google-oauth'

export interface WorkingHours {
  start: string // "09:00"
  end: string // "17:00"
  days?: number[] // 0-6, 1=Mon ... 5=Fri
  slotMinutes?: number // 30
  slotDurationMinutes?: number // alias
  slotDuration?: number // alias
  slotMinutesVar?: number
  START?: string
  END?: string
  DAYS?: string
  SLOT?: string
}

export interface WorkingHoursNormalized {
  start: string
  end: string
  days: number[]
  slotMinutes: number
}

export interface BusyBlock {
  start: string // ISO
  end: string // ISO
}

export interface CalendarSlot {
  date: string // YYYY-MM-DD
  start: string // ISO
  end: string // ISO
  available: boolean
  // No event details — privacy
}

export function parseTime(timeStr: string | null | undefined): number {
  if (!timeStr) return 0
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (isNaN(h) || isNaN(m)) return 0
  return h * 60 + m
}

export function normalizeSlotMinutes(raw: any): number {
  // Configurable, always multiple of 15 per requirement
  let mins = parseInt(String(raw ?? '30'), 10)
  if (isNaN(mins) || mins < 15) mins = 30
  if (mins > 120) mins = 120
  // Round down to nearest multiple of 15 (e.g. 20 → 15, 50 → 45)
  mins = Math.floor(mins / 15) * 15
  if (mins < 15) mins = 15
  return mins
}

export function parseExcludeToday(raw: any): boolean {
  if (raw === true) return true
  const s = String(raw ?? '').toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

export function filterWorkingDays(dates: Date[] | null | undefined, workingDays: number[] | null | undefined): Date[] {
  if (!dates || !Array.isArray(dates)) return []
  if (!workingDays || !Array.isArray(workingDays)) return [...dates]
  return dates.filter((d) => workingDays.includes(d.getDay()))
}

export function getNext14Days(excludeToday: boolean = true): Date[] {
  // Always exclude today by default per user requirement assume we dont schedule today
  const days: Date[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (excludeToday) start.setDate(start.getDate() + 1)
  for (let i = 0; i < 14; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60000)
}

function slotsOverlap(slotStart: Date, slotEnd: Date, busyStart: Date, busyEnd: Date): boolean {
  return slotStart < busyEnd && slotEnd > busyStart
}

export const TIMEZONE = 'America/New_York' // Eastern, configurable in admin later via var TIMEZONE

function getEasternOffsetHours(date: Date): number {
  const testDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0))
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      timeZoneName: 'longOffset',
    })
    const parts = fmt.formatToParts(testDate)
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    const m = tzName.match(/GMT([+-])(\d+)(?::?(\d+))?/)
    if (m) {
      const sign = m[1]
      const h = parseInt(m[2], 10)
      return sign === '-' ? h : -h
    }
  } catch {}
  const month = testDate.getUTCMonth()
  if (month < 2 || month > 10) return 5
  if (month > 2 && month < 10) return 4
  return 4
}

function easternWallTimeToUtcIso(year: number, month: number, day: number, hour: number, minute: number, offsetHours: number): string {
  const utcMillis = Date.UTC(year, month, day, hour + offsetHours, minute, 0, 0)
  return new Date(utcMillis).toISOString()
}

export function computeSlotsForDay(
  date: Date,
  workingHours: { start: string; end: string; slotMinutes?: number; slotDurationMinutes?: number },
  busyBlocks: BusyBlock[]
): CalendarSlot[] {
  const rawMinutes = workingHours.slotMinutes ?? workingHours.slotDurationMinutes ?? 30
  const slotMinutes = normalizeSlotMinutes(rawMinutes)
  const startMins = parseTime(workingHours.start)
  const endMins = parseTime(workingHours.end)

  if (endMins <= startMins || slotMinutes <= 0) return []

  const slots: CalendarSlot[] = []
  const dateStr = toDateString(date)

  // Eastern timezone for now per user request, configurable via TIMEZONE var later
  // Working hours 09:00-17:00 are interpreted as Eastern wall time, converted to UTC ISO for storage
  // e.g. 09:00 ET (EDT UTC-4) in July → 13:00 UTC ISO
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const offsetHours = getEasternOffsetHours(date)

  for (let mins = startMins; mins + slotMinutes <= endMins; mins += slotMinutes) {
    const hour = Math.floor(mins / 60)
    const minute = mins % 60
    // Convert Eastern wall time to UTC ISO
    const slotStartIso = easternWallTimeToUtcIso(year, month, day, hour, minute, offsetHours)
    const slotStart = new Date(slotStartIso)
    const slotEnd = addMinutes(slotStart, slotMinutes)

    // Check overlap with any busy block
    let available = true
    for (const busy of busyBlocks) {
      try {
        const busyStart = new Date(busy.start)
        const busyEnd = new Date(busy.end)
        if (isNaN(busyStart.getTime()) || isNaN(busyEnd.getTime())) continue
        if (slotsOverlap(slotStart, slotEnd, busyStart, busyEnd)) {
          available = false
          break
        }
      } catch {}
    }

    slots.push({
      date: dateStr,
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      available,
    })
  }

  return slots
}

export function computeSlots(params: {
  startDate: Date
  weeks: number
  workingHours: WorkingHours & { days?: number[] }
  busyBlocks: BusyBlock[]
  excludeToday?: boolean
}): CalendarSlot[] {
  const { startDate, weeks, workingHours, busyBlocks, excludeToday = false } = params
  const days = workingHours.days ?? [1, 2, 3, 4, 5]
  const slotMinutes = normalizeSlotMinutes((workingHours as any).slotMinutes ?? (workingHours as any).slotDurationMinutes ?? 30)
  const start = workingHours.start ?? '09:00'
  const end = workingHours.end ?? '17:00'

  const allDates: Date[] = []
  const totalDays = Math.max(1, weeks) * 7
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setUTCDate(startDate.getUTCDate() + i)
    // Exclude today option — requirement 2: option not taking any schedule today
    if (excludeToday) {
      const todayStr = new Date().toISOString().split('T')[0]
      const dStr = new Date(d).toISOString().split('T')[0]
      if (dStr === todayStr) continue
      // Also if startDate is today and i=0, skip
      if (i === 0 && toDateString(d) === toDateString(new Date())) continue
    }
    allDates.push(d)
  }

  const workingDates = filterWorkingDays(allDates, days)

  const allSlots: CalendarSlot[] = []
  for (const d of workingDates) {
    const daySlots = computeSlotsForDay(d, { start, end, slotMinutes }, busyBlocks)
    allSlots.push(...daySlots)
  }

  return allSlots
}

export function getStubBusyBlocks(): BusyBlock[] {
  // For local dev, return empty or a sample busy in future for testing exclusion
  return []
}

export function getStubSlots(weeks: number = 2, excludeToday: boolean = false): CalendarSlot[] {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const workingHours = { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], slotMinutes: 30 }
  // No busy for stub → all available
  return computeSlots({ startDate: start, weeks, workingHours, busyBlocks: [], excludeToday })
}

// Real FreeBusy via Service Account JWT (for slots endpoint)
// This is used by slots.ts but stubbed when key missing
export async function getFreeBusy(env: any): Promise<{ busyBlocks: BusyBlock[]; source: 'live' | 'stub'; error?: string }> {
  const saKeyRaw = getGcalServiceKey(env) || env?.GCAL_SERVICE_ACCOUNT_KEY
  const bookingId = getBookingCalendarId(env) || env?.BOOKING_CALENDAR_ID || env?.BOOKING
  const personalId = getPersonalCalendarId(env) || env?.PERSONAL_CALENDAR_ID || env?.PERSONAL
  const isStub = !saKeyRaw || env?.STUB === 'true' || env?.STUB_SLOTS === 'true' || env?.ENVIRONMENT === 'test' || env?.ENVIRONMENT === 'local'

  console.log(`!!! FREEBUSY_START env=${env?.ENVIRONMENT} hasKey=${!!saKeyRaw} bookingId=${bookingId ? bookingId.slice(0, 8) + '...' : 'missing'} personalId=${personalId ? 'present' : 'missing'} isStub=${isStub}`)

  if (isStub) {
    console.log(`!!! FREEBUSY_STUB reason=${!saKeyRaw ? 'GCAL key missing' : `STUB flag or env ${env?.ENVIRONMENT}`} env=${env?.ENVIRONMENT}`)
    return { busyBlocks: getStubBusyBlocks(), source: 'stub', error: !saKeyRaw ? 'GCAL_SERVICE_ACCOUNT_KEY missing (checked aliases)' : undefined }
  }

  try {
    // Parse SA key JSON
    let saKey: any
    if (typeof saKeyRaw === 'string') {
      saKey = JSON.parse(saKeyRaw)
    } else {
      saKey = saKeyRaw
    }

    // Create JWT for Google OAuth2 Service Account
    // Header: {"alg":"RS256","typ":"JWT"}
    // Payload: iss=client_email, scope=https://www.googleapis.com/auth/calendar.readonly, aud=https://oauth2.googleapis.com/token, iat, exp 1h
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const payload = {
      iss: saKey.client_email,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      aud: saKey.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const enc = (obj: any) => {
      const json = JSON.stringify(obj)
      const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return b64
    }

    // For Workers, we need to use SubtleCrypto for RS256 signing
    // Since private_key is PEM, we need to import it
    // Simplified: if we have private_key, try to sign, else fallback to stub
    // For TDD, we skip real signing and return stub if crypto fails
    try {
      const pem = saKey.private_key
      if (!pem) throw new Error('No private_key')

      // Import private key (PKCS8)
      const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '')
      const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

      // Use Web Crypto
      const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const headerB64 = enc(header)
      const payloadB64 = enc(payload)
      const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
      const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data)
      const signatureArray = new Uint8Array(signatureBuffer)
      let binary = ''
      signatureArray.forEach((b) => (binary += String.fromCharCode(b)))
      const signatureB64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      const jwt = `${headerB64}.${payloadB64}.${signatureB64}`

      // Exchange JWT for access token
      const tokenRes = await fetch(saKey.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      })

      if (!tokenRes.ok) {
        throw new Error(`Token exchange failed ${tokenRes.status}`)
      }

      const tokenJson = (await tokenRes.json()) as any
      const accessToken = tokenJson.access_token
      console.log(`!!! FREEBUSY_TOKEN_EXCHANGE_OK hasToken=${!!accessToken}`)
      if (!accessToken) throw new Error('No access token')

      // FreeBusy query
      const timeMin = new Date().toISOString()
      const timeMax = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString() // 2 weeks
      console.log(`!!! FREEBUSY_QUERY_START timeMin=${timeMin} timeMax=${timeMax}`)

      const calendarIds = [bookingId, personalId].filter((x): x is string => Boolean(x))
      const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: calendarIds.map((id) => ({ id })),
        }),
      })

      console.log(`!!! FREEBUSY_QUERY_RESPONSE status=${fbRes.status} ok=${fbRes.ok}`)

      if (!fbRes.ok) {
        const txt = await fbRes.text().catch(() => '')
        console.log(`!!! FREEBUSY_FAILED status=${fbRes.status} body=${txt.slice(0, 300)}`)
        throw new Error(`FreeBusy failed ${fbRes.status} ${txt.slice(0, 200)}`)
      }

      const fbJson = (await fbRes.json()) as any
      const busyBlocks: BusyBlock[] = []
      for (const calId of Object.keys(fbJson.calendars || {})) {
        const busy = fbJson.calendars[calId].busy || []
        busy.forEach((b: any) => busyBlocks.push({ start: b.start, end: b.end }))
      }
      console.log(`!!! FREEBUSY_SUCCESS busyBlocks=${busyBlocks.length} calendars=${Object.keys(fbJson.calendars || {}).join(',')}`)

      return { busyBlocks, source: 'live' }
    } catch (cryptoErr: any) {
      console.log(`!!! FREEBUSY_CRYPTO_ERROR ${cryptoErr?.message}`)
      // Fallback to stub if crypto or fetch fails (local dev, test)
      return { busyBlocks: getStubBusyBlocks(), source: 'stub', error: cryptoErr?.message }
    }
  } catch (e: any) {
    console.log(`!!! FREEBUSY_OUTER_ERROR ${e?.message}`)
    return { busyBlocks: getStubBusyBlocks(), source: 'stub', error: e?.message }
  }
}

export interface CreateEventParams {
  firstName: string
  lastName: string
  email: string
  phone?: string
  purpose?: string
  slot: { date: string; start: string; end: string; available?: boolean }
  cancelToken: string
  siteUrl?: string
}

export interface CreateEventResult {
  calendarEventId: string
  meetLink: string
  source: 'live' | 'stub'
  error?: string
}

export async function createBookingEvent(env: any, params: CreateEventParams): Promise<CreateEventResult> {
  const saKeyRaw = getGcalServiceKey(env) || env?.GCAL_SERVICE_ACCOUNT_KEY
  const bookingId = getBookingCalendarId(env) || env?.BOOKING_CALENDAR_ID || env?.BOOKING
  const siteUrl = env?.SITE_URL || 'https://profile-webapp.pages.dev'
  const envName = env?.ENVIRONMENT || ''
  const isLocalOrTest = envName === 'local' || envName === 'test'
  const isStubFlag = env?.STUB === 'true'

  // Clear stub condition: only when explicitly told or missing key + local/test, or missing bookingId
  const isStub = (!saKeyRaw && isLocalOrTest) || isStubFlag || envName === 'test' || envName === 'local'

  console.log(`!!! GCAL_CREATE_EVENT_START env=${envName} hasKey=${!!saKeyRaw} bookingId=${bookingId ? bookingId.slice(0, 8) + '...' : 'missing'} isStub=${isStub} isLocalOrTest=${isLocalOrTest} cancelToken=${params.cancelToken} slot=${params.slot.start} hasOAuth=${hasOAuthConfig(env)}`)

  // Try OAuth first if configured — works for personal Gmail group calendars where SA fails Meet creation
  if (hasOAuthConfig(env)) {
    console.log('!!! GCAL_TRY_OAUTH_FIRST has OAuth config, attempting OAuth user flow for real Meet')
    const oauthResult = await createBookingEventViaOAuth(env, {
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      phone: params.phone,
      purpose: params.purpose,
      slot: params.slot,
      cancelToken: params.cancelToken,
      siteUrl,
    })
    console.log(`!!! GCAL_OAUTH_RESULT source=${oauthResult.source} eventId=${oauthResult.calendarEventId} meetLink=${oauthResult.meetLink} error=${oauthResult.error || 'none'}`)
    if (oauthResult.source === 'live-oauth' && oauthResult.calendarEventId && !oauthResult.calendarEventId.startsWith('stub-')) {
      // OAuth succeeded with real event — return as live (even if bare without Meet, it's real Google 200)
      console.log('!!! GCAL_OAUTH_SUCCESS returning live event from OAuth')
      return {
        calendarEventId: oauthResult.calendarEventId,
        meetLink: oauthResult.meetLink || `https://meet.google.com/fake-oauth-no-meet-${params.cancelToken.slice(0, 4)}`,
        source: 'live',
        error: oauthResult.error,
      }
    } else {
      console.log(`!!! GCAL_OAUTH_FALLBACK_TO_SA reason=${oauthResult.error} — trying SA flow`)
    }
  }

  if (!bookingId) {
    console.log(`!!! GCAL_CREATE_FAIL_NO_BOOKING_ID env=${envName}`)
    // Missing booking calendar ID — this is critical, should NOT silently fake in alpha/prod
    if (!isLocalOrTest && !isStubFlag) {
      return {
        calendarEventId: `missing-booking-id-${params.cancelToken}`,
        meetLink: `https://meet.google.com/fake-missing-calendar-${params.cancelToken.slice(0, 4)}`,
        source: 'stub',
        error: `BOOKING_CALENDAR_ID not configured — checked aliases BOOKING_CALENDAR_ID, BOOKING, BOOKING_CALENDAR. Env: ${envName}`,
      }
    }
    return {
      calendarEventId: `stub-event-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-${params.cancelToken.slice(0, 8)}`,
      source: 'stub',
      error: 'BOOKING_CALENDAR_ID missing — stub',
    }
  }

  if (isStub || !saKeyRaw) {
    console.log(`!!! GCAL_CREATE_STUB isStub=${isStub} hasKey=${!!saKeyRaw} reason=${!saKeyRaw ? 'key missing' : isStubFlag ? 'STUB flag' : 'local/test env'}`)
    // Local/test or explicit STUB => return mock but include reason
    return {
      calendarEventId: `stub-event-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-${params.cancelToken.slice(0, 8)}`,
      source: 'stub',
      error: !saKeyRaw ? 'GCAL_SERVICE_ACCOUNT_KEY missing — stub' : 'STUB flag or local/test env',
    }
  }

  try {
    console.log('!!! GCAL_CREATE_PARSE_SA_KEY_START')
    // Reuse JWT logic from getFreeBusy but with calendar.events scope
    let saKey: any
    if (typeof saKeyRaw === 'string') {
      saKey = JSON.parse(saKeyRaw)
    } else {
      saKey = saKeyRaw
    }
    console.log(`!!! GCAL_SA_PARSED email=${saKey.client_email}`)

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
    if (!pem) throw new Error('No private_key')
    const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '')
    const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
    console.log('!!! GCAL_IMPORT_PRIVATE_KEY')
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
    console.log('!!! GCAL_JWT_SIGNED')

    console.log('!!! GCAL_TOKEN_EXCHANGE_START')
    const tokenRes = await fetch(saKey.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })
    console.log(`!!! GCAL_TOKEN_EXCHANGE_RESPONSE status=${tokenRes.status} ok=${tokenRes.ok}`)

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '')
      console.log(`!!! GCAL_TOKEN_EXCHANGE_FAILED status=${tokenRes.status} body=${txt.slice(0, 300)}`)
      throw new Error(`Token exchange failed ${tokenRes.status} ${txt.slice(0, 200)}`)
    }
    const tokenJson = (await tokenRes.json()) as any
    const accessToken = tokenJson.access_token
    console.log(`!!! GCAL_ACCESS_TOKEN_OBTAINED hasToken=${!!accessToken}`)
    if (!accessToken) throw new Error('No access token')

    // Create event with Meet link auto via conferenceData
    // NOTE: Service accounts cannot invite attendees without Domain-Wide Delegation — causes 403 forbiddenForServiceAccounts
    // Fix: try with attendees first, if that fails with forbiddenForServiceAccounts, retry without attendees
    console.log(`!!! GCAL_EVENT_CREATE_START summary=Meeting with ${params.firstName} start=${params.slot.start} end=${params.slot.end} bookingId=${bookingId.slice(0, 8)}...`)
    const basePayload = {
      summary: `Meeting with ${params.firstName} ${params.lastName}`,
      description: `${params.purpose || 'Intro call'}\n\nContact: ${params.email} ${params.phone || ''}\n\nCancel: ${siteUrl}/api/cancel/${params.cancelToken}`,
      start: { dateTime: params.slot.start, timeZone: TIMEZONE },
      end: { dateTime: params.slot.end, timeZone: TIMEZONE },
      conferenceData: {
        createRequest: {
          requestId: params.cancelToken,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }

    const withAttendeesPayload = {
      ...basePayload,
      attendees: [{ email: params.email, displayName: `${params.firstName} ${params.lastName}` }],
    }

    let createRes: Response | null = null
    let eventPayloadUsed: any = withAttendeesPayload

    // First attempt — with attendees + Meet (would send Google invite if DWD allowed)
    console.log('!!! GCAL_EVENT_CREATE_ATTEMPT_1_WITH_ATTENDEES_AND_MEET')
    createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(withAttendeesPayload),
    })
    console.log(`!!! GCAL_EVENT_CREATE_RESPONSE_1 status=${createRes.status} ok=${createRes.ok}`)

    let bareEventWithoutMeet: any = null

    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '')
      console.log(`!!! GCAL_EVENT_CREATE_FAILED_1 status=${createRes.status} body=${txt.slice(0, 800)}`)
      // If forbiddenForServiceAccounts — retry without attendees (works for personal Gmail & group calendars without DWD)
      if (txt.includes('forbiddenForServiceAccounts') || txt.includes('Service accounts cannot invite attendees')) {
        console.log('!!! GCAL_CREATE_RETRY_WITHOUT_ATTENDEES reason=forbiddenForServiceAccounts — DWD not configured, creating event without attendees and relying on Resend email for confirmation')
        eventPayloadUsed = basePayload // no attendees but with Meet
        createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(basePayload),
        })
        console.log(`!!! GCAL_EVENT_CREATE_RESPONSE_2_NO_ATTENDEES_WITH_MEET status=${createRes.status} ok=${createRes.ok}`)
        if (!createRes.ok) {
          const txt2 = await createRes.text().catch(() => '')
          console.log(`!!! GCAL_EVENT_CREATE_FAILED_2 status=${createRes.status} body=${txt2.slice(0, 800)}`)
          // If invalid conference type — group calendars may not support hangoutsMeet via SA, retry bare event without Meet
          if (txt2.includes('Invalid conference type') || txt2.includes('conferenceType') || txt2.includes('conference type')) {
            console.log('!!! GCAL_CREATE_RETRY_BARE_EVENT reason=Invalid conference type value — group calendar may not support hangoutsMeet via SA, creating bare event without Meet')
            const barePayload = {
              summary: basePayload.summary,
              description: basePayload.description,
              start: basePayload.start,
              end: basePayload.end,
            }
            eventPayloadUsed = barePayload
            createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?sendUpdates=all`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify(barePayload),
            })
            console.log(`!!! GCAL_EVENT_CREATE_RESPONSE_3_BARE status=${createRes.status} ok=${createRes.ok}`)
            if (!createRes.ok) {
              const txt3 = await createRes.text().catch(() => '')
              console.log(`!!! GCAL_EVENT_CREATE_FAILED_3_BARE status=${createRes.status} body=${txt3.slice(0, 800)}`)
              throw new Error(`Create event failed ${createRes.status} ${txt3} (retry bare also failed) — ${txt2}`)
            } else {
              bareEventWithoutMeet = await createRes.clone().json().catch(() => null)
              console.log(`!!! GCAL_BARE_EVENT_CREATED id=${bareEventWithoutMeet?.id || 'unknown'} — will attempt PATCH to add Meet with alternative types`)
              // Try to PATCH Meet with hangoutsMeet as conferenceData (some calendars allow PATCH but not POST)
              try {
                console.log('!!! GCAL_TRY_PATCH_MEET_HANGOUTSMEET')
                const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events/${encodeURIComponent(bareEventWithoutMeet.id)}?conferenceDataVersion=1`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                  body: JSON.stringify({
                    conferenceData: {
                      createRequest: { requestId: params.cancelToken + '-patch', conferenceSolutionKey: { type: 'hangoutsMeet' } },
                    },
                  }),
                })
                const patchTxt = await patchRes.text().catch(() => '')
                console.log(`!!! GCAL_PATCH_MEET_RESPONSE status=${patchRes.status} ok=${patchRes.ok} body=${patchTxt.slice(0, 500)}`)
                if (patchRes.ok) {
                  const patched = JSON.parse(patchTxt)
                  const patchedLink = patched.conferenceData?.entryPoints?.[0]?.uri || patched.hangoutLink
                  if (patchedLink) {
                    console.log(`!!! GCAL_PATCH_MEET_SUCCESS link=${patchedLink}`)
                    // Merge patched data into createRes for later meetLink extraction
                    createRes = new Response(patchTxt, { status: 200 }) as any
                  }
                } else {
                  console.log('!!! GCAL_PATCH_MEET_FAILED trying eventHangout')
                }
              } catch (e: any) {
                console.log(`!!! GCAL_PATCH_MEET_EXCEPTION ${e?.message}`)
              }
            }
          } else {
            throw new Error(`Create event failed ${createRes.status} ${txt2} (retry without attendees failed) — original: ${txt}`)
          }
        } else {
          console.log('!!! GCAL_CREATE_RETRY_SUCCESS without attendees — real Meet link will be generated, Resend will handle email invite')
        }
      } else {
        throw new Error(`Create event failed ${createRes.status} ${txt}`)
      }
    }

    if (!createRes) throw new Error('No response from Google Calendar')

    const created = (await createRes.json()) as any
    let meetLink = created.conferenceData?.entryPoints?.[0]?.uri || created.hangoutLink
    if (!meetLink) {
      // If bare event without Meet (group calendar doesn't support hangoutsMeet via SA), check if we have bareEventWithoutMeet
      if (bareEventWithoutMeet) {
        console.log(`!!! GCAL_BARE_EVENT_NO_MEET id=${created.id || bareEventWithoutMeet.id} — group calendar may not support Meet via SA, returning live event without Meet link, Resend will handle email without Meet`)
        // For group calendars without Meet support, return empty meetLink but source live — calendar blocking still works
        meetLink = '' // No Meet — will be handled by booking.ts email (Resend without Meet) + UI warning
      } else {
        meetLink = `https://meet.google.com/fake-${params.cancelToken.slice(0, 8)}`
        console.log(`!!! GCAL_MEET_FALLBACK_FAKE meetLink=${meetLink}`)
      }
    }
    console.log(`!!! GCAL_EVENT_CREATED id=${created.id} meetLink=${meetLink || '(no Meet - bare event)'} source=live`)

    // Patch description to include actual Meet link + cancel link so Google invite contains meeting link text too per user request
    // Only patch if we have a real meetLink (not fake, not empty)
    if (meetLink && !meetLink.includes('fake-')) {
      try {
        console.log('!!! GCAL_EVENT_PATCH_DESCRIPTION_START')
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events/${encodeURIComponent(created.id)}?conferenceDataVersion=1`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            description: `${params.purpose || 'Intro call'}\n\nMeet: ${meetLink}\nCancel: ${siteUrl}/api/cancel/${params.cancelToken}\n\nContact: ${params.email} ${params.phone || ''}`,
          }),
        })
        console.log('!!! GCAL_EVENT_PATCH_OK')
      } catch (e: any) {
        console.log(`!!! GCAL_EVENT_PATCH_FAILED ${e?.message}`)
      }
    } else {
      console.log('!!! GCAL_SKIP_PATCH no real Meet link')
    }

    return {
      calendarEventId: created.id || bareEventWithoutMeet?.id || `live-event-${params.cancelToken}`,
      meetLink: meetLink || `https://meet.google.com/fake-no-meet-${params.cancelToken.slice(0, 4)}`,
      source: 'live',
      error: bareEventWithoutMeet && !meetLink ? 'Bare event created without Meet — group calendar may not support hangoutsMeet via SA — slot blocked, Resend email without Meet' : undefined,
    } as any
  } catch (e: any) {
    // For alpha/prod, we should NOT silently return fake — include detailed error so caller can surface
    // But for resilience, still return stub with error for observability
    const detailed = `createBookingEvent failed: ${e?.message || String(e)} — bookingId: ${bookingId ? 'present' : 'missing'}, env: ${env?.ENVIRONMENT}, hasKey: ${!!saKeyRaw}`
    console.log(`!!! GCAL_CREATE_EXCEPTION ${detailed}`)
    console.error(detailed)

    // In prod/alpha, if we have key and bookingId, this is a real error (likely permission 403 or bad calendar ID)
    // Return stub but caller (booking.ts) will surface gcalError
    return {
      calendarEventId: `stub-event-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-${params.cancelToken.slice(0, 8)}`,
      source: 'stub',
      error: detailed,
    }
  }
}

export function getDiagInfo(env: any) {
  return {
    bookingId: !!getBookingCalendarId(env),
    bookingIdAlt: !!env?.BOOKING_CALENDAR_ID || !!env?.BOOKING,
    personalId: !!getPersonalCalendarId(env),
    gcalKey: !!getGcalServiceKey(env),
    env: env?.ENVIRONMENT || 'unknown',
    stubFlag: env?.STUB,
  }
}
