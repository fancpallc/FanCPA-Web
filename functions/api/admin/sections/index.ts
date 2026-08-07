import { requireAdminAuth, isAdminAuthenticated } from '../../../_lib/auth'
import { getEnvironment } from '../../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

const ALLOWED_TYPES = ['hero', 'cards-grid', 'text-block', 'testimonials', 'cta-banner', 'image-gallery']

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFail = requireAdminAuth(request, env)
  if (authFail) return authFail

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  console.log(`!!! ADMIN_SECTIONS_CREATE_REQUEST env=${envName} email=${authResult.email}`)

  const db = env?.DB
  if (!db) return new Response(JSON.stringify({ error: 'DB missing' }), { status: 500, headers })

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers })
  }

  const type = body?.type?.trim()
  const heading = body?.heading?.trim() || 'New Section'
  const subheading = body?.subheading?.trim() || null
  const pageSlug = body?.pageSlug?.trim() || 'home'

  if (!type) {
    return new Response(JSON.stringify({ error: 'type required' }), { status: 400, headers })
  }
  if (!ALLOWED_TYPES.includes(type)) {
    return new Response(JSON.stringify({ error: `Invalid type ${type} — allowed: ${ALLOWED_TYPES.join(', ')}` }), { status: 400, headers })
  }

  try {
    // Get page id from slug
    const pageStmt = db.prepare('SELECT * FROM pages WHERE slug = ?').bind(pageSlug)
    const page = await pageStmt.first()
    if (!page) {
      return new Response(JSON.stringify({ error: `Page not found: ${pageSlug}` }), { status: 404, headers })
    }

    // Prevent duplicate hero per page (H4) — only one hero allowed to keep landing simple
    if (type === 'hero') {
      const existingHeroStmt = db.prepare('SELECT * FROM sections WHERE page_id = ? AND type = ?').bind(page.id, 'hero')
      const existingHero = await existingHeroStmt.first()
      if (existingHero) {
        return new Response(JSON.stringify({ error: 'Hero section already exists — only one hero allowed per page, edit existing instead' }), { status: 400, headers })
      }
    }

    // Get max sort_order for that page — use all() then compute max in JS (avoids MAX mock fragility, free tier <1ms)
    const allSecStmt = db.prepare('SELECT * FROM sections WHERE page_id = ?').bind(page.id)
    const allSecResult = await allSecStmt.all()
    const existingSecs = allSecResult.results || []
    const maxOrder = existingSecs.length ? Math.max(...existingSecs.map((s: any) => s.sort_order ?? 0)) : -1
    const nextOrder = maxOrder + 1

    const id = crypto.randomUUID()
    const config = body?.config ? (typeof body.config === 'string' ? body.config : JSON.stringify(body.config)) : '{}'
    // Unpublished by default, matching new items. Creating a section used to publish an
    // empty band reading "Services coming soon" to the live site before the owner had
    // typed anything, while adding an item to it correctly stayed hidden — the two halves
    // of the same mental model disagreed.
    const is_visible = body?.is_visible !== undefined ? body.is_visible : 0

    const insertStmt = db.prepare('INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, page.id, type, heading, subheading, nextOrder, config, is_visible)
    await insertStmt.run()

    console.log(`!!! ADMIN_SECTIONS_CREATE_DONE id=${id} type=${type} order=${nextOrder} env=${envName}`)

    const createdStmt = db.prepare('SELECT * FROM sections WHERE id = ?').bind(id)
    const created = await createdStmt.first()

    return new Response(JSON.stringify(created || { id, page_id: page.id, type, heading, subheading, sort_order: nextOrder, config, is_visible }), {
      status: 201,
      headers,
    })
  } catch (e: any) {
    console.log(`!!! ADMIN_SECTIONS_CREATE_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: `Create failed: ${e?.message}` }), { status: 500, headers })
  }
}
