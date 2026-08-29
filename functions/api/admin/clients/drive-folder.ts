import { isAdminAuthenticated } from '../../../_lib/auth'
import { extractFolderId } from '../../../_lib/google-drive'
import type { Env } from '../auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const contact_id = url.searchParams.get('contact_id')
  const year = url.searchParams.get('year')

  if (!contact_id) return new Response('Missing contact_id', { status: 400 })

  const db = env.DB as any

  if (year) {
    const row = await db
      .prepare('SELECT * FROM client_drive_folders WHERE contact_id = ? AND year = ?')
      .bind(contact_id, Number(year))
      .first()
    return new Response(JSON.stringify(row || {}), { headers: { 'Content-Type': 'application/json' } })
  }

  // Client-level + year folders
  const contact = await db.prepare('SELECT id, drive_folder_url, drive_folder_id, drive_is_manual FROM contacts WHERE id = ?').bind(contact_id).first()
  if (!contact) return new Response('Contact not found', { status: 404, headers: { 'Content-Type': 'application/json' } })
  const yearFolders = await db
    .prepare('SELECT * FROM client_drive_folders WHERE contact_id = ? ORDER BY year DESC')
    .bind(contact_id)
    .all()
  return new Response(
    JSON.stringify({
      drive_folder_url: contact.drive_folder_url || null,
      drive_folder_id: contact.drive_folder_id || null,
      drive_is_manual: contact.drive_is_manual || 0,
      year_folders: yearFolders?.results || [],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { contact_id, year, folder_url } = body as { contact_id?: string; year?: string | number; folder_url?: string }

  if (!contact_id || !folder_url) {
    return new Response(JSON.stringify({ error: 'contact_id and folder_url required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // H1 fix: only accept /drive/folders/ URLs — /file/d/ is a file, not a folder, and extractFolderId only matches /folders/, so saving a file URL breaks lookup and parent-folder creation.
  const urlRegex = /^https:\/\/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/
  const match = folder_url.match(urlRegex)
  if (!match) return new Response(JSON.stringify({ error: 'Invalid Drive URL — must be https://drive.google.com/drive/folders/<id>' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const folder_id = match[1]
  // C1 extra guard: never persist fake- ids as canonical
  if (folder_id.startsWith('fake-') || folder_id.startsWith('stub-') || folder_id.startsWith('missing-')) {
    return new Response(JSON.stringify({ error: 'Refusing to save fabricated Drive folder id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const db = env.DB as any

  const contact = (await db.prepare('SELECT id, email FROM contacts WHERE id = ?').bind(contact_id).first()) as any
  if (!contact) return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  // When year is provided → year-level override (repoint one year's folder)
  if (year !== undefined && year !== null && String(year).trim() !== '') {
    const yearStr = String(year).trim()
    if (!/^\d{4}$/.test(yearStr)) {
      return new Response(JSON.stringify({ error: 'Year must be 4 digits' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const yearNum = parseInt(yearStr, 10)
    if (yearNum < 2000 || yearNum > 2100) {
      return new Response(JSON.stringify({ error: 'Year must be 2000..2100' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const emailLower = (contact.email || '').toLowerCase()
    // B1 fix: bind ALL NOT NULL columns (contact_id, email, year, folder_id, folder_url)
    await db
      .prepare(
        `INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, is_manual)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(contact_id, year) DO UPDATE SET
           folder_url = excluded.folder_url,
           folder_id = excluded.folder_id,
           email = excluded.email,
           is_manual = 1,
           updated_at = datetime('now')`
      )
      .bind(contact_id, emailLower, yearNum, folder_id, folder_url)
      .run()
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  // Client-level (default) — the one link rendered at top of card
  // Write contacts.drive_folder_url + drive_folder_id + is_manual=1
  await db
    .prepare('UPDATE contacts SET drive_folder_url = ?, drive_folder_id = ?, drive_is_manual = 1 WHERE id = ?')
    .bind(folder_url, folder_id, contact_id)
    .run()

  // Also refresh denormalized parent on existing year rows so they stay consistent
  // Does NOT rewrite per-year folder_url — those subfolders still exist under old parent
  try {
    await db
      .prepare(
        `UPDATE client_drive_folders SET parent_folder_id = ?, parent_folder_url = ?, updated_at = datetime('now')
         WHERE contact_id = ?`
      )
      .bind(folder_id, folder_url, contact_id)
      .run()
  } catch {}

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
}
