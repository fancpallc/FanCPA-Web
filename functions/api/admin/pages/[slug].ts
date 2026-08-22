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
const EDITABLE = ['site_name', 'footer_tagline', 'icon_url', 'title', 'meta_description', 'booking_max_per_week', 'booking_min_notice_days', 'working_hours_start', 'working_hours_end', 'google_tag_manager_id'] as const

/** Long enough for a name or a sentence; short enough that the header cannot be broken. */
const MAX_LENGTH: Record<(typeof EDITABLE)[number], number> = {
  site_name: 40,
  footer_tagline: 200,
  icon_url: 2_000,
  title: 70,
  meta_description: 200,
  booking_max_per_week: 10,
  booking_min_notice_days: 10,
  working_hours_start: 5,
  working_hours_end: 5,
  google_tag_manager_id: 50,
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
    if (field === 'working_hours_start' || field === 'working_hours_end') {
      if (value !== null && typeof value === 'string' && !/^\d{1,2}:\d{2}$/.test(value)) {
         return new Response(JSON.stringify({ error: 'Time must be in HH:MM format' }), { status: 400, headers })
      }
    }
    if (field === 'booking_max_per_week' || field === 'booking_min_notice_days' || field === 'working_hours_start' || field === 'working_hours_end') {
      continue
    }
    if (field === 'google_tag_manager_id') {
      if (value !== null && typeof value === 'string' && value.length > 0 && !value.startsWith('GTM-')) {
        return new Response(JSON.stringify({ error: 'GTM ID must start with GTM-' }), { status: 400, headers })
      }
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

  try {
    console.log(`!!! ADMIN_PAGE_PUT_START slug=${slug} fields=${patch.join(',')} env=${envName} email=${authResult.email}`)

    const existing = await db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Page not found: ${slug}` }), { status: 404, headers })
    }

    const assignments = patch.map((f) => `${f} = ?`).join(', ')
    const values = patch.map((f) => {
        if (f === 'booking_max_per_week' || f === 'booking_min_notice_days') return typeof body[f] === 'string' ? parseInt(body[f]) : body[f]
        if (f === 'working_hours_start' || f === 'working_hours_end') return body[f]
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

