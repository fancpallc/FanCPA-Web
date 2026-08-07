import { requireAdminAuth, isAdminAuthenticated } from '../../../_lib/auth'
import { getEnvironment } from '../../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

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
  console.log(`!!! ADMIN_ITEMS_REORDER_REQUEST env=${envName} email=${authResult.email}`)

  const db = env?.DB
  if (!db) return new Response(JSON.stringify({ error: 'DB missing' }), { status: 500, headers })

  let body: any
  try {
    body = await (request as any).json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers })
  }

  const sectionId = body?.sectionId
  const orderedIds = body?.orderedIds

  if (!sectionId || typeof sectionId !== 'string') {
    return new Response(JSON.stringify({ error: 'sectionId required' }), { status: 400, headers })
  }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return new Response(JSON.stringify({ error: 'orderedIds must be non-empty array' }), { status: 400, headers })
  }

  try {
    const stmts: any[] = []
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      if (typeof id !== 'string' || !id) {
        return new Response(JSON.stringify({ error: `Invalid id at ${i}` }), { status: 400, headers })
      }
      const stmt = db.prepare('UPDATE section_items SET sort_order = ? WHERE id = ? AND section_id = ?').bind(i, id, sectionId)
      stmts.push(stmt)
    }

    if (typeof db.batch === 'function') {
      await db.batch(stmts)
    } else {
      for (const st of stmts) await st.run()
    }

    console.log(`!!! ADMIN_ITEMS_REORDER_DONE section=${sectionId} count=${orderedIds.length}`)

    return new Response(JSON.stringify({ success: true, sectionId, ordered: orderedIds }), { status: 200, headers })
  } catch (e: any) {
    console.log(`!!! ADMIN_ITEMS_REORDER_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: `Reorder failed: ${e?.message}` }), { status: 500, headers })
  }
}
