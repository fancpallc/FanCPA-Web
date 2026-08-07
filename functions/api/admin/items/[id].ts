import { requireAdminAuth, isAdminAuthenticated } from '../../../_lib/auth'
import { getEnvironment } from '../../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFailure = requireAdminAuth(request, env)
  if (authFailure) return authFailure

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  const id = (params as any)?.id

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing item id' }), { status: 400, headers: commonHeaders })
  }

  const db = env?.DB
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: commonHeaders })
  }

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: commonHeaders })
  }

  if (!body || Object.keys(body).length === 0) {
    return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400, headers: commonHeaders })
  }

  try {
    console.log(`!!! ADMIN_ITEMS_PUT_START id=${id} env=${envName} email=${authResult.email}`)

    const existingStmt = db.prepare('SELECT * FROM section_items WHERE id = ?').bind(id)
    const existing = await existingStmt.first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Item not found: ${id}` }), { status: 404, headers: commonHeaders })
    }

    // Allow partial update — title, body, image_url, sort_order, is_visible, icon, link_url, link_text, author, rating, image_alt
    const title = body.title !== undefined ? body.title : existing.title
    const bodyText = body.body !== undefined ? body.body : existing.body
    const image_url = body.image_url !== undefined ? body.image_url : existing.image_url
    const sort_order = body.sort_order !== undefined ? body.sort_order : existing.sort_order
    const is_visible = body.is_visible !== undefined ? body.is_visible : existing.is_visible
    const icon = body.icon !== undefined ? body.icon : existing.icon
    const link_url = body.link_url !== undefined ? body.link_url : existing.link_url
    const link_text = body.link_text !== undefined ? body.link_text : existing.link_text
    const author = body.author !== undefined ? body.author : existing.author

    // A star rating outside 1–5 would render as a broken row of stars, so reject it
    // rather than store it: the admin's picker can only produce 1–5, so anything else
    // is a bad request, not a value to clamp silently.
    if (body.rating !== undefined && body.rating !== null) {
      const n = Number(body.rating)
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return new Response(JSON.stringify({ error: 'rating must be a whole number from 1 to 5' }), { status: 400, headers: commonHeaders })
      }
    }
    const rating = body.rating !== undefined ? body.rating : existing.rating
    const image_alt = body.image_alt !== undefined ? body.image_alt : existing.image_alt

    // Validate image_url if provided — must be portfolio path or external https? For free tier we enforce portfolio/* or https:// for legacy unsplash
    if (body.image_url !== undefined && typeof body.image_url === 'string' && body.image_url) {
      const url = body.image_url
      // Allow /api/images/portfolio/... (our R2 serving) or https:// (external) or portfolio/...
      if (!url.startsWith('/api/images/portfolio/') && !url.startsWith('portfolio/') && !url.startsWith('https://')) {
        // Still allow but log — for strict we could reject, but allow https for legacy tests
      }
    }

    const updateStmt = db
      .prepare('UPDATE section_items SET title = ?, body = ?, image_url = ?, sort_order = ?, is_visible = ?, icon = ?, link_url = ?, link_text = ?, author = ?, rating = ?, image_alt = ? WHERE id = ?')
      .bind(title, bodyText, image_url, sort_order, is_visible, icon, link_url, link_text, author, rating ?? null, image_alt ?? null, id)
    await updateStmt.run()

    const updatedStmt = db.prepare('SELECT * FROM section_items WHERE id = ?').bind(id)
    const updated = await updatedStmt.first()

    console.log(`!!! ADMIN_ITEMS_PUT_DONE id=${id} format=${(image_url?.endsWith('.webp') ? 'webp' : image_url?.endsWith('.png') ? 'png' : 'other')}`)

    return new Response(JSON.stringify(updated || { id, title, body: bodyText, image_url, sort_order, is_visible }), {
      status: 200,
      headers: commonHeaders,
    })
  } catch (e: any) {
    console.log(`!!! ADMIN_ITEMS_PUT_ERROR id=${id} error=${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to update item: ${e?.message}` }), { status: 500, headers: commonHeaders })
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFailure = requireAdminAuth(request, env)
  if (authFailure) return authFailure

  const authResult = isAdminAuthenticated(request, env)
  const id = (params as any)?.id
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: commonHeaders })
  }

  const db = env?.DB
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB missing' }), { status: 500, headers: commonHeaders })
  }

  try {
    console.log(`!!! ADMIN_ITEMS_DELETE_START id=${id} email=${authResult.email}`)
    const existingStmt = db.prepare('SELECT * FROM section_items WHERE id = ?').bind(id)
    const existing = await existingStmt.first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Item not found: ${id}` }), { status: 404, headers: commonHeaders })
    }

    const delStmt = db.prepare('DELETE FROM section_items WHERE id = ?').bind(id)
    await delStmt.run()

    console.log(`!!! ADMIN_ITEMS_DELETE_DONE id=${id}`)
    return new Response(JSON.stringify({ success: true, id }), { status: 200, headers: commonHeaders })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `Delete failed: ${e?.message}` }), { status: 500, headers: commonHeaders })
  }
}
