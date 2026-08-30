import { computeSlots, getFreeBusy, getStubSlots, normalizeSlotMinutes, getDiagInfo } from '../../_lib/google-calendar'
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
  MINIMUM_NOTICE_DAYS?: string // "0" to allow today, "1" for 1 day notice
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
  if (String(raw).trim().toLowerCase() === 'none') return [] // paused
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

    // Get site settings from DB if configured — T4 + T5: timezone and working hours now admin-editable
    // Precedence: DB (pages) > env var > default. Previous code had env > DB which made admin UI inert.
    let dbMinNoticeDays: number | null = null
    let dbTimeZone: string | null = null
    let dbWorkingStart: string | null = null
    let dbWorkingEnd: string | null = null
    let dbWorkingDays: string | null = null
    if (env.DB) {
      try {
        const page = (await env.DB.prepare('SELECT booking_min_notice_days, site_time_zone, site_working_hours_start, site_working_hours_end, site_working_days FROM pages WHERE slug = "home"').first()) as any
        if (page) {
          if (page.booking_min_notice_days !== null && page.booking_min_notice_days !== undefined) dbMinNoticeDays = page.booking_min_notice_days
          if (page.site_time_zone) dbTimeZone = String(page.site_time_zone).trim()
          if (page.site_working_hours_start) dbWorkingStart = String(page.site_working_hours_start).trim()
          if (page.site_working_hours_end) dbWorkingEnd = String(page.site_working_hours_end).trim()
          if (page.site_working_days) dbWorkingDays = String(page.site_working_days).trim()
        }
      } catch (e: any) {
        console.log(`!!! SLOTS_DB_ERROR ${e?.message}`)
      }
    }

    // T4/T5 fix: DB wins over env so admin control is meaningful
    const parseNotice = (raw: any): number | null => {
      if (raw === undefined || raw === null || raw === '') return null
      const n = parseInt(String(raw), 10)
      return isNaN(n) ? null : n
    }
    const envNotice = parseNotice(env?.MINIMUM_NOTICE_DAYS)
    const minNoticeDays = dbMinNoticeDays !== null ? dbMinNoticeDays : envNotice !== null ? envNotice : 0

    const envTimeZone = env?.TIMEZONE || env?.TIME_ZONE
    const siteTimeZone = dbTimeZone || envTimeZone || 'America/New_York'

    const whStart = dbWorkingStart || env?.WORKING_HOURS_START || '09:00'
    const whEnd = dbWorkingEnd || env?.WORKING_HOURS_END || '17:00'
    // T5 whole-hour guard: constrain start/end to whole hours at slot generation level (snap down); UI is select but backend must not produce :30 slots
    const startMinsRaw = (() => { try { const [h,m]=whStart.split(':').map(Number); return isNaN(h)||isNaN(m)?540:h*60+m } catch { return 540 } })()
    const endMinsRaw = (() => { try { const [h,m]=whEnd.split(':').map(Number); return isNaN(h)||isNaN(m)?1020:h*60+m } catch { return 1020 } })()
    const snapToWholeHour = (mins: number): number => Math.floor(mins/60)*60
    let start = (() => { const s=snapToWholeHour(startMinsRaw); const h=Math.floor(s/60); const mm=s%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}` })()
    let end = (() => { const e=snapToWholeHour(endMinsRaw) || snapToWholeHour(startMinsRaw+60); const h=Math.floor(e/60); const mm=e%60; return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}` })()

    // T5 empty-calendar guard: non-whole-hour env like 09:30+09:45 both snap to 09:00 -> end<=start -> [] silently
    // Only reachable via env (API validates), but must fail loudly rather than offering empty calendar
    const parseMins = (t: string): number => { const p = /^(\d{1,2}):(\d{2})$/.exec(t); return p ? parseInt(p[1],10)*60+parseInt(p[2],10) : -1 }
    const sM = parseMins(start)
    const eM = parseMins(end)
    if (sM < 0 || eM < 0 || eM <= sM || eM - sM < 60) {
      console.log(`!!! SLOTS_INVALID_WORKING_HOURS start=${whStart} end=${whEnd} snapped=${start}-${end} rawMins=${startMinsRaw}-${endMinsRaw} — window too short or collapsed after snapping (e.g. 09:30+09:45 => same hour) — falling back to 09:00-17:00 to avoid empty calendar`)
      start = '09:00'
      end = '17:00'
    } else if (startMinsRaw % 60 !== 0 || endMinsRaw % 60 !== 0) {
      // Still log when snapping actually changed the value — visible sign that env is non-whole-hour
      console.log(`!!! SLOTS_WORKING_HOURS_SNAPPED original=${whStart}-${whEnd} snapped=${start}-${end} — env had minutes, snapped to whole hour per T5 requirement`)
    }

    const rawDays = dbWorkingDays || env?.WORKING_DAYS
    const workingHours = {
      start,
      end,
      days: parseWorkingDays(rawDays),
      slotMinutes: normalizeSlotMinutes(env?.SLOT_DURATION_MINUTES || '60'),
      minNoticeDays,
      timeZone: siteTimeZone,
    } as any
    console.log(`!!! SLOTS_WORKING_HOURS start=${workingHours.start} end=${workingHours.end} days=${workingHours.days.join(',')} slotMinutes=${workingHours.slotMinutes} minNoticeDays=${minNoticeDays} timeZone=${siteTimeZone}`)

    // FreeBusy — stub when no SA key or ENVIRONMENT test/local or STUB flag
    console.log('!!! SLOTS_FREEBUSY_CALL_START')
    const { busyBlocks, source, error } = await getFreeBusy(env)
    console.log(`!!! SLOTS_FREEBUSY_RESULT source=${source} busyCount=${busyBlocks.length} error=${error || 'none'}`)

    let slots
    const startDate = new Date()
    startDate.setUTCHours(0, 0, 0, 0)
    if (source === 'stub' && busyBlocks.length === 0) {
      const { computeSlots } = await import('../../_lib/google-calendar')
      slots = computeSlots({ startDate, weeks, workingHours, busyBlocks: [], minNoticeDays, timeZone: siteTimeZone } as any)
      const now = new Date()
      slots = slots.filter((s: any) => new Date(s.end) > now)
    } else {
      slots = computeSlots({
        startDate,
        weeks,
        workingHours,
        busyBlocks,
        minNoticeDays,
        timeZone: siteTimeZone,
      } as any)
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
        // NOTE (Rev 5 UX review): the response deliberately carries only slots — workingHours.days
        // is logged above but never returned. CalendarView.tsx hardcodes a weekend exclusion
        // (KNOWN P0 there), and one proposed fix was "thread site_working_days through"; that would
        // require adding it here first. Deriving bookable days from the slots themselves avoids
        // changing this contract at all.
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
    // Fallback to stub on error
    const fallbackSlots = getStubSlots(2, 1)
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

