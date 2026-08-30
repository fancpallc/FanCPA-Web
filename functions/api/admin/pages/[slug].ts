import { requireAdminAuth, isAdminAuthenticated } from '../../../_lib/auth'
import { getEnvironment } from '../../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

/** Fields the owner may edit. `slug` and `id` are deliberately not among them. */
const EDITABLE = ['site_name', 'footer_tagline', 'icon_url', 'title', 'meta_description', 'booking_max_per_week', 'booking_min_notice_days', 'google_tag_manager_id', 'site_time_zone', 'site_working_hours_start', 'site_working_hours_end', 'site_working_days'] as const

/** Long enough for a name or a sentence; short enough that the header cannot be broken. */
const MAX_LENGTH: Record<(typeof EDITABLE)[number], number> = {
  site_name: 40,
  footer_tagline: 200,
  icon_url: 2_000,
  title: 70,
  meta_description: 200,
  booking_max_per_week: 10,
  booking_min_notice_days: 10,
  google_tag_manager_id: 50,
  site_time_zone: 50,
  site_working_hours_start: 10,
  site_working_hours_end: 10,
  site_working_days: 30,
}

const VALID_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'UTC',
]
const WHOLE_HOUR_RE = /^(0[6-9]|1[0-9]|2[0-2]):00$/

function isWholeHourTime(v: string): boolean {
  return WHOLE_HOUR_RE.test(v.trim())
}
function parseMins(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return -1
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10)
  if (isNaN(h) || isNaN(mm)) return -1
  return h * 60 + mm
}
function isValidIanaZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch { return false }
}

/**
 * Edit the site's own name, tagline and search listing.
 *
 * These were literals in App.tsx, Nav.tsx and Footer.tsx, so a portfolio owner could
 * rewrite every word of their content and still ship a header reading "Portfolio".
 */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFail = requireAdminAuth(request, env)
  if (authFail) return authFail

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  const slug = (params as any)?.slug

  if (!slug) return new Response(JSON.stringify({ error: 'Missing page slug' }), { status: 400, headers })

  const db = env?.DB
  if (!db) return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers })

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers })
  }

  const patch = EDITABLE.filter((f) => body?.[f] !== undefined)
  if (!patch.length) {
    return new Response(JSON.stringify({ error: `Nothing to update. Editable fields: ${EDITABLE.join(', ')}` }), { status: 400, headers })
  }

  for (const field of patch) {
    const value = body[field]
    if (field === 'booking_max_per_week' && value !== null && (typeof value !== 'number' || value < 0)) {
      return new Response(JSON.stringify({ error: 'Booking limit must be a positive number' }), { status: 400, headers })
    }
    if (field === 'booking_min_notice_days' && value !== null && (typeof value !== 'number' || value < 0)) {
      return new Response(JSON.stringify({ error: 'Minimum notice days must be a non-negative number' }), { status: 400, headers })
    }
    if (field === 'booking_max_per_week' || field === 'booking_min_notice_days') {
      continue
    }
    if (field === 'google_tag_manager_id') {
      if (value !== null && typeof value === 'string' && value.length > 0 && !value.startsWith('GTM-')) {
        return new Response(JSON.stringify({ error: 'GTM ID must start with GTM-' }), { status: 400, headers })
      }
    }
    // T4: site_time_zone — must be valid IANA, allow empty/null to reset
    if (field === 'site_time_zone') {
      if (value === null || value === '') continue
      if (typeof value !== 'string') return new Response(JSON.stringify({ error: 'site_time_zone must be text' }), { status: 400, headers })
      if (!isValidIanaZone(value)) return new Response(JSON.stringify({ error: `Invalid timezone: ${value}. Use IANA like America/New_York` }), { status: 400, headers })
      continue
    }
    // T5: working_hours start/end — whole-hour, 06:00–22:00, length guard
    if (field === 'site_working_hours_start' || field === 'site_working_hours_end') {
      if (value === null || value === '') continue
      if (typeof value !== 'string') return new Response(JSON.stringify({ error: `${field} must be text` }), { status: 400, headers })
      if (!isWholeHourTime(value)) return new Response(JSON.stringify({ error: `${field} must be whole hour like 09:00 (06:00–22:00)` }), { status: 400, headers })
      continue
    }
    if (field === 'site_working_days') {
      if (value === null || value === '') continue
      if (typeof value !== 'string') return new Response(JSON.stringify({ error: 'site_working_days must be text like 1,2,3,4,5' }), { status: 400, headers })
      if (String(value).trim().toLowerCase() === 'none') continue // paused — no days, slots emits []
      // basic shape: comma list 0-6
      const parts = value.split(',').map(s => s.trim()).filter(Boolean)
      if (parts.length === 0) return new Response(JSON.stringify({ error: 'site_working_days cannot be empty if set — use 1,2,3,4,5 or none to pause, null to reset' }), { status: 400, headers })
      for (const p of parts) {
        const n = parseInt(p, 10)
        if (isNaN(n) || n < 0 || n > 6) return new Response(JSON.stringify({ error: `Invalid working day: ${p} — must be 0-6` }), { status: 400, headers })
      }
      continue
    }
    if (value !== null && typeof value !== 'string') {
      return new Response(JSON.stringify({ error: `${field} must be text` }), { status: 400, headers })
    }
    if (typeof value === 'string' && value.length > MAX_LENGTH[field]) {
      return new Response(JSON.stringify({ error: `${field} must be ${MAX_LENGTH[field]} characters or fewer` }), { status: 400, headers })
    }
    // The header would render an empty wordmark, and an empty browser-tab title shows
    // the raw URL. Both are worse than the placeholder they replaced.
    if ((field === 'site_name' || field === 'title') && typeof value === 'string' && !value.trim()) {
      return new Response(JSON.stringify({ error: `${field === 'site_name' ? 'Your site name' : 'The browser tab title'} cannot be empty` }), { status: 400, headers })
    }
  }

  // T5 cross-field: if either start/end supplied, validate window against existing or both new
  try {
    const startSupplied = patch.includes('site_working_hours_start')
    const endSupplied = patch.includes('site_working_hours_end')
    if (startSupplied || endSupplied) {
      // Need to read existing to validate pair
      const existingPre = await db.prepare('SELECT site_working_hours_start, site_working_hours_end FROM pages WHERE slug = ?').bind(slug).first() as any
      const effStart = (startSupplied ? String(body.site_working_hours_start || '').trim() : existingPre?.site_working_hours_start || '09:00') || '09:00'
      const effEnd = (endSupplied ? String(body.site_working_hours_end || '').trim() : existingPre?.site_working_hours_end || '17:00') || '17:00'
      // Only validate when both are non-empty (allow clearing one)
      if (effStart && effEnd) {
        const s = parseMins(effStart)
        const e = parseMins(effEnd)
        if (s >= 0 && e >= 0) {
          if (e <= s) return new Response(JSON.stringify({ error: `Working hours end (${effEnd}) must be after start (${effStart})` }), { status: 400, headers })
          if (e - s < 60) return new Response(JSON.stringify({ error: 'Working hours window too short — needs at least 1 hour' }), { status: 400, headers })
        }
      }
    }
  } catch (e: any) {
    // Only surface if it's our validation error (400); otherwise continue to main try
    if (e?.status === 400 || String(e?.message || '').includes('Working hours')) throw e
  }

  try {
    console.log(`!!! ADMIN_PAGE_PUT_START slug=${slug} fields=${patch.join(',')} env=${envName} email=${authResult.email}`)

    const existing = await db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Page not found: ${slug}` }), { status: 404, headers })
    }

    const assignments = patch.map((f) => `${f} = ?`).join(', ')
    const values = patch.map((f) => {
        if (f === 'booking_max_per_week' || f === 'booking_min_notice_days') return typeof body[f] === 'string' ? parseInt(body[f]) : body[f]
        return typeof body[f] === 'string' ? body[f].trim() : body[f]
    })
    await db.prepare(`UPDATE pages SET ${assignments}, updated_at = datetime('now') WHERE slug = ?`).bind(...values, slug).run()

    const updated = await db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first()
    console.log(`!!! ADMIN_PAGE_PUT_DONE slug=${slug}`)

    return new Response(JSON.stringify(updated), { status: 200, headers })
  } catch (e: any) {
    console.log(`!!! ADMIN_PAGE_PUT_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to update page: ${e?.message}` }), { status: 500, headers })
  }
}

