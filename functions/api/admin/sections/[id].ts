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
  if (authFailure) {
    console.log(`!!! ADMIN_SECTIONS_PUT_AUTH_FAILED id=${(params as any)?.id}`)
    return authFailure
  }

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  const id = (params as any)?.id || (params as any)?.sectionId
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing section id' }), { status: 400, headers: commonHeaders })
  }

  const db = env?.DB
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: commonHeaders })
  }

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: commonHeaders })
  }

  // Validate body not empty
  if (!body || Object.keys(body).length === 0) {
    return new Response(JSON.stringify({ error: 'Empty body — need at least one field: heading, subheading, sort_order, is_visible, config' }), {
      status: 400,
      headers: commonHeaders,
    })
  }

  try {
    console.log(`!!! ADMIN_SECTIONS_PUT_START id=${id} env=${envName} email=${authResult.email} body=${JSON.stringify(body).slice(0, 200)}`)

    // Check exists
    const existingStmt = db.prepare('SELECT * FROM sections WHERE id = ?').bind(id)
    const existing = await existingStmt.first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Section not found: ${id}` }), { status: 404, headers: commonHeaders })
    }

    // Build update — allow partial fields
    const heading = body.heading !== undefined ? body.heading : existing.heading
    const subheading = body.subheading !== undefined ? body.subheading : existing.subheading
    const sort_order = body.sort_order !== undefined ? body.sort_order : existing.sort_order
    const is_visible = body.is_visible !== undefined ? body.is_visible : existing.is_visible
    let config = existing.config
    if (body.config !== undefined) {
      config = typeof body.config === 'string' ? body.config : JSON.stringify(body.config)
    }

    // Basic validation
    if (body.heading !== undefined && typeof body.heading !== 'string') {
      return new Response(JSON.stringify({ error: 'heading must be string' }), { status: 400, headers: commonHeaders })
    }
    if (body.sort_order !== undefined && typeof body.sort_order !== 'number') {
      return new Response(JSON.stringify({ error: 'sort_order must be number' }), { status: 400, headers: commonHeaders })
    }

    const updateStmt = db.prepare('UPDATE sections SET heading = ?, subheading = ?, sort_order = ?, is_visible = ?, config = ? WHERE id = ?').bind(heading, subheading, sort_order, is_visible, config, id)
    await updateStmt.run()

    // Return updated
    const updatedStmt = db.prepare('SELECT * FROM sections WHERE id = ?').bind(id)
    const updated = await updatedStmt.first()

    console.log(`!!! ADMIN_SECTIONS_PUT_DONE id=${id}`)

    return new Response(JSON.stringify(updated || { id, heading, subheading, sort_order, is_visible, config }), {
      status: 200,
      headers: commonHeaders,
    })
  } catch (e: any) {
    console.log(`!!! ADMIN_SECTIONS_PUT_ERROR id=${id} error=${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to update section: ${e?.message || String(e)}` }), {
      status: 500,
      headers: commonHeaders,
    })
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFail = requireAdminAuth(request, env)
  if (authFail) return authFail

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  const id = (params as any)?.id
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: commonHeaders })
  }

  const db = env?.DB
  if (!db) return new Response(JSON.stringify({ error: 'DB missing' }), { status: 500, headers: commonHeaders })

  try {
    console.log(`!!! ADMIN_SECTIONS_DELETE_START id=${id} env=${envName} email=${authResult.email}`)

    const existingStmt = db.prepare('SELECT * FROM sections WHERE id = ?').bind(id)
    const existing = await existingStmt.first()
    if (!existing) {
      return new Response(JSON.stringify({ error: `Section not found: ${id}` }), { status: 404, headers: commonHeaders })
    }

    // Get image_url keys from items to delete R2 objects to prevent orphan leak for free tier (H3)
    let r2KeysToDelete: string[] = []
    try {
      const itemsWithImagesStmt = db.prepare('SELECT image_url FROM section_items WHERE section_id = ?').bind(id)
      const itemsResult = await itemsWithImagesStmt.all()
      const rows = itemsResult.results || []
      for (const row of rows as any[]) {
        const url = row?.image_url as string | null
        if (!url) continue
        let key: string | undefined
        try {
          let path = url
          if (url.startsWith('http://') || url.startsWith('https://')) {
            const u = new URL(url)
            path = u.pathname
          }
          path = path.split('?')[0]
          if (path.includes('/api/images/')) {
            const idx = path.indexOf('/api/images/')
            let k = path.slice(idx + '/api/images/'.length)
            if (k.startsWith('/')) k = k.slice(1)
            if (k.startsWith('portfolio/')) key = k
          } else if (path.startsWith('/api/images/')) {
            key = path.replace('/api/images/', '')
          } else if (path.startsWith('portfolio/')) {
            key = path.split('?')[0]
          }
        } catch {}
        if (key && key.startsWith('portfolio/')) r2KeysToDelete.push(key)
      }
      console.log(`!!! ADMIN_SECTIONS_DELETE_R2_KEYS id=${id} r2Keys=${r2KeysToDelete.length} list=${r2KeysToDelete.slice(0,5).join(',')}`)
    } catch (e: any) {
      console.log(`!!! ADMIN_SECTIONS_DELETE_R2_LIST_ERROR id=${id} error=${e?.message}`)
    }

    // Delete R2 objects first (best effort, free tier: 1 delete per key, <100/day)
    if (r2KeysToDelete.length > 0 && env?.R2_BUCKET?.delete) {
      for (const k of r2KeysToDelete) {
        try {
          await env.R2_BUCKET.delete(k)
          console.log(`!!! ADMIN_SECTIONS_DELETE_R2_DONE key=${k}`)
        } catch (e: any) {
          console.log(`!!! ADMIN_SECTIONS_DELETE_R2_ERROR key=${k} error=${e?.message}`)
        }
      }
    }

    // Delete its items first to stay free tier clean (no orphans), then section
    const delItemsStmt = db.prepare('DELETE FROM section_items WHERE section_id = ?').bind(id)
    await delItemsStmt.run()

    const delSecStmt = db.prepare('DELETE FROM sections WHERE id = ?').bind(id)
    await delSecStmt.run()

    console.log(`!!! ADMIN_SECTIONS_DELETE_DONE id=${id}`)

    return new Response(JSON.stringify({ success: true, id }), { status: 200, headers: commonHeaders })
  } catch (e: any) {
    console.log(`!!! ADMIN_SECTIONS_DELETE_ERROR id=${id} error=${e?.message}`)
    return new Response(JSON.stringify({ error: `Delete failed: ${e?.message}` }), { status: 500, headers: commonHeaders })
  }
}
