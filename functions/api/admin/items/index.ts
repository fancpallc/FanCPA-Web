import { requireAdminAuth, isAdminAuthenticated } from '../../../_lib/auth'
import { getEnvironment } from '../../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

/**
 * Create an item inside a section.
 *
 * Sections could be added and deleted but their items could not, so a portfolio
 * owner had no way to add a project, a service card or a testimonial — only to edit
 * the ones that shipped in the seed.
 */
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

  const db = env?.DB
  if (!db) return new Response(JSON.stringify({ error: 'DB missing' }), { status: 500, headers })

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers })
  }

  const sectionId = body?.sectionId?.trim()
  if (!sectionId) {
    return new Response(JSON.stringify({ error: 'sectionId required' }), { status: 400, headers })
  }

  try {
    console.log(`!!! ADMIN_ITEMS_CREATE_START section=${sectionId} env=${envName} email=${authResult.email}`)

    const section = await db.prepare('SELECT * FROM sections WHERE id = ?').bind(sectionId).first()
    if (!section) {
      return new Response(JSON.stringify({ error: `Section not found: ${sectionId}` }), { status: 404, headers })
    }

    const siblingsResult = await db.prepare('SELECT * FROM section_items WHERE section_id = ?').bind(sectionId).all()
    const siblings = siblingsResult.results || []
    const nextOrder = siblings.length ? Math.max(...siblings.map((i: any) => i.sort_order ?? 0)) + 1 : 0

    const id = crypto.randomUUID()
    const title = body?.title ?? null
    const itemBody = body?.body ?? null
    const image_url = body?.image_url ?? null
    const icon = body?.icon ?? null
    const link_url = body?.link_url ?? null
    const link_text = body?.link_text ?? null
    const author = body?.author ?? null
    const image_alt = body?.image_alt ?? null
    // A new testimonial has to start somewhere, and 5 is what the owner is most likely
    // to be quoting; every other section type has no use for a rating.
    const rating = body?.rating ?? (section.type === 'testimonials' ? 5 : null)

    // Unpublished by default: a brand-new item is empty, and the public renderer would
    // otherwise show a card with five stars and no quote the instant the owner clicks Add.
    const is_visible = body?.is_visible !== undefined ? body.is_visible : 0

    await db
      .prepare(
        'INSERT INTO section_items (id, section_id, title, body, image_url, icon, link_url, link_text, author, rating, image_alt, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, sectionId, title, itemBody, image_url, icon, link_url, link_text, author, rating, image_alt, nextOrder, is_visible)
      .run()

    const created = await db.prepare('SELECT * FROM section_items WHERE id = ?').bind(id).first()
    console.log(`!!! ADMIN_ITEMS_CREATE_DONE id=${id} section=${sectionId} order=${nextOrder}`)

    return new Response(
      JSON.stringify(created || { id, section_id: sectionId, title, body: itemBody, sort_order: nextOrder, is_visible }),
      { status: 201, headers },
    )
  } catch (e: any) {
    console.log(`!!! ADMIN_ITEMS_CREATE_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: `Create failed: ${e?.message}` }), { status: 500, headers })
  }
}
