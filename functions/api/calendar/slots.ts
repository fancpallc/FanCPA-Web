import { computeSlots, getFreeBusy, getStubSlots, normalizeSlotMinutes, parseExcludeToday, getDiagInfo } from '../../_lib/google-calendar'
import { getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey } from '../../_lib/env'

export interface Env {
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  PERSONAL_CALENDAR_ID?: string
  PERSONAL?: string
  PERSONAL_CALENDAR?: string
  WORKING_HOURS_START?: string
  WORKING_HOURS_END?: string
  WORKING_DAYS?: string // "1,2,3,4,5"
  SLOT_DURATION_MINUTES?: string // "30" — configurable, always multiple of 15
  EXCLUDE_TODAY?: string // "true" to not take any schedule today
  CALENDAR_EXCLUDE_TODAY?: string // alias
  ENVIRONMENT?: string
  SITE_URL?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  STUB?: string
  STUB_SLOTS?: string
  [key: string]: any
}

function parseWorkingDays(raw?: string): number[] {
  if (!raw) return [1, 2, 3, 4, 5]
  try {
    return raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 6)
  } catch {
    return [1, 2, 3, 4, 5]
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    console.log('!!! SLOTS_REQUEST_START')
    const url = new URL(request.url)
    const weeksParam = url.searchParams.get('weeks')
    let weeks = 2
    if (weeksParam) {
      const parsed = parseInt(weeksParam, 10)
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 8) {
        weeks = parsed
      }
    }
    console.log(`!!! SLOTS_PARAMS weeks=${weeks} url=${request.url}`)

    // Default true per requirement assume dont schedule today (C1)
    const excludeToday = parseExcludeToday((env as any)?.EXCLUDE_TODAY ?? (env as any)?.CALENDAR_EXCLUDE_TODAY ?? 'true')

    const workingHours = {
      start: env?.WORKING_HOURS_START || '09:00',
      end: env?.WORKING_HOURS_END || '17:00',
      days: parseWorkingDays(env?.WORKING_DAYS),
      // Configurable, multiple of 15 per requirement
      slotMinutes: normalizeSlotMinutes(env?.SLOT_DURATION_MINUTES || '30'),
      excludeToday,
    }
    console.log(`!!! SLOTS_WORKING_HOURS start=${workingHours.start} end=${workingHours.end} days=${workingHours.days.join(',')} slotMinutes=${workingHours.slotMinutes} excludeToday=${excludeToday}`)

    // FreeBusy — stub when no SA key or ENVIRONMENT test/local or STUB flag
    console.log('!!! SLOTS_FREEBUSY_CALL_START')
    const { busyBlocks, source, error } = await getFreeBusy(env)
    console.log(`!!! SLOTS_FREEBUSY_RESULT source=${source} busyCount=${busyBlocks.length} error=${error || 'none'}`)

    let slots
    const startDate = new Date()
    startDate.setUTCHours(0, 0, 0, 0)
    if (source === 'stub' && busyBlocks.length === 0) {
      // For stub with no busy, generate full slots via getStubSlots with workingHours and excludeToday
      slots = getStubSlots(weeks, excludeToday)
      // Override slot duration if custom (stub uses 30 default, but recompute with our workingHours)
      const { computeSlots } = await import('../../_lib/google-calendar')
      slots = computeSlots({ startDate, weeks, workingHours, busyBlocks: [], excludeToday })
      const now = new Date()
      slots = slots.filter((s: any) => new Date(s.end) > now)
    } else {
      slots = computeSlots({
        startDate,
        weeks,
        workingHours,
        busyBlocks,
        excludeToday,
      })
      const now = new Date()
      slots = slots.filter((s: any) => new Date(s.end) > now)
    }

    // Ensure no event details leaked (privacy per 6.2)
    const safeSlots = slots.map((s: any) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      available: s.available,
      // No title, summary, description, attendees
    }))

    const diag = getDiagInfo(env)
    console.log(`!!! SLOTS_COMPUTE_DONE safeSlots=${safeSlots.length} source=${source}`)

    return new Response(
      JSON.stringify({
        slots: safeSlots,
        weeks,
        source, // stub or live — for debugging, UI can show badge
        error: error || undefined,
        calendars: {
          booking: getBookingCalendarId(env) ? 'configured' : 'not-configured',
          personal: getPersonalCalendarId(env) ? 'configured' : 'not-configured',
          gcalKey: getGcalServiceKey(env) ? 'configured' : 'not-configured',
          // keep old keys for backward compat
          bookingConfigured: !!getBookingCalendarId(env),
          personalConfigured: !!getPersonalCalendarId(env),
        },
        workingHours,
        diag,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300', // 5-min TTL per design 6.2 / 9.1
          'Access-Control-Allow-Origin': '*',
          'X-Cache': source === 'live' ? 'MISS' : 'STUB', // For test: should have cache-control, X-Cache defined
          'X-Content-Source': source,
        },
      }
    )
  } catch (e: any) {
    console.log(`!!! SLOTS_EXCEPTION ${e?.message}`)
    // Fallback to stub on error — respect excludeToday true default
    const fallbackSlots = getStubSlots(2, true)
    return new Response(
      JSON.stringify({
        slots: fallbackSlots,
        weeks: 2,
        source: 'stub',
        error: e?.message || String(e),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'FALLBACK',
        },
      }
    )
  }
}
