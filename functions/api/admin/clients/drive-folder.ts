import { isAdminAuthenticated } from '../../../_lib/auth'
import type { Env } from '../auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const contact_id = url.searchParams.get('contact_id')
  const year = url.searchParams.get('year')

  if (!contact_id || !year) return new Response('Missing params', { status: 400 })

  const db = env.DB as any
  const row = await db.prepare('SELECT * FROM client_drive_folders WHERE contact_id = ? AND year = ?')
    .bind(contact_id, year)
    .first()

  if (!row) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(JSON.stringify(row), { headers: { 'Content-Type': 'application/json' } })
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { contact_id, year, folder_url } = await request.json() as any

  if (!contact_id || !/^\d{4}$/.test(year) || !folder_url) {
    return new Response('Invalid input', { status: 400 })
  }

  const urlRegex = /^https:\/\/drive.google.com\/(drive\/folders|file\/d)\/([a-zA-Z0-9_-]+)/
  const match = folder_url.match(urlRegex)
  if (!match) return new Response('Invalid Drive URL', { status: 400 })

  const folder_id = match[2]
  const db = env.DB as any

  // Check if contact exists
  const contact = await db.prepare('SELECT id, email FROM contacts WHERE id = ?').bind(contact_id).first()
  if (!contact) return new Response('Contact not found', { status: 404 })

  console.log(`!!! ADMIN_DRIVE_FOLDER_PATCH contact_id=${contact_id} year=${year}`)

  await db.prepare(`
    INSERT INTO client_drive_folders (contact_id, email, year, folder_url, folder_id, is_manual, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(contact_id, year) DO UPDATE SET
      folder_url = excluded.folder_url,
      folder_id = excluded.folder_id,
      is_manual = 1,
      updated_at = datetime('now')
  `).bind(contact_id, contact.email, year, folder_url, folder_id).run()

  return new Response(JSON.stringify({ success: true }))
}

