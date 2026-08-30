import { isAdminAuthenticated } from '../../../_lib/auth'
import type { Env } from '../auth'

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const contact_id = (params as any)?.id as string
  if (!contact_id) {
    return new Response(JSON.stringify({ error: 'Missing contact_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const first_name_raw = body.first_name
  const last_name_raw = body.last_name
  const phone_raw = body.phone

  // Validate: if field present, trim and reject empty
  const updates: string[] = []
  const values: any[] = []

  if (first_name_raw !== undefined) {
    const trimmed = String(first_name_raw).trim()
    if (!trimmed) {
      return new Response(JSON.stringify({ error: 'first_name cannot be empty' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (trimmed.length > 200) {
      return new Response(JSON.stringify({ error: 'first_name too long (max 200)' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    updates.push('first_name = ?')
    values.push(trimmed)
  }

  if (last_name_raw !== undefined) {
    const trimmed = String(last_name_raw).trim()
    if (!trimmed) {
      return new Response(JSON.stringify({ error: 'last_name cannot be empty' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (trimmed.length > 200) {
      return new Response(JSON.stringify({ error: 'last_name too long (max 200)' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    updates.push('last_name = ?')
    values.push(trimmed)
  }

  if (phone_raw !== undefined) {
    const trimmed = String(phone_raw).trim()
    // phone can be empty string to clear it
    if (trimmed.length > 50) {
      return new Response(JSON.stringify({ error: 'phone too long' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    updates.push('phone = ?')
    values.push(trimmed || null)
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No updatable fields (first_name, last_name, phone)' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const db = env.DB as any
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    // Ensure contact exists
    const contact = await db.prepare('SELECT id FROM contacts WHERE id = ?').bind(contact_id).first()
    if (!contact) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    // 0016 adds updated_at to contacts (fixes V7); include it when available
    const sql = `UPDATE contacts SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    values.push(contact_id)
    await db.prepare(sql).bind(...values).run()

    const updated = await db.prepare('SELECT id, first_name, last_name, email, phone, drive_folder_url, drive_folder_id, drive_is_manual FROM contacts WHERE id = ?').bind(contact_id).first()

    console.log(`!!! ADMIN_CLIENT_UPDATE_OK id=${contact_id} fields=${updates.join(',')}`)

    return new Response(JSON.stringify({ success: true, contact: updated }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.log(`!!! ADMIN_CLIENT_UPDATE_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
