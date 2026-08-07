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
const EDITABLE = ['site_name', 'footer_tagline', 'title', 'meta_description'] as const

/** Long enough for a name or a sentence; short enough that the header cannot be broken. */
const MAX_LENGTH: Record<(typeof EDITABLE)[number], number> = {
  site_name: 40,
  footer_tagline: 200,
  title: 70,
  meta_description: 160,
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
    const values = patch.map((f) => (typeof body[f] === 'string' ? body[f].trim() : body[f]))
    await db.prepare(`UPDATE pages SET ${assignments}, updated_at = datetime('now') WHERE slug = ?`).bind(...values, slug).run()

    const updated = await db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first()
    console.log(`!!! ADMIN_PAGE_PUT_DONE slug=${slug}`)

    return new Response(JSON.stringify(updated), { status: 200, headers })
  } catch (e: any) {
    console.log(`!!! ADMIN_PAGE_PUT_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to update page: ${e?.message}` }), { status: 500, headers })
  }
}
