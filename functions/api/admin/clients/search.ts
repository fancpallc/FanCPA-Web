import { isAdminAuthenticated } from '../../../_lib/auth'
import { extractFolderId } from '../../../_lib/google-drive'
import type { Env } from '../auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const qRaw = url.searchParams.get('q')?.trim() || ''
  const startDate = url.searchParams.get('start_date')?.trim() || ''
  const endDate = url.searchParams.get('end_date')?.trim() || ''

  if (!qRaw && !startDate && !endDate) {
    return new Response(JSON.stringify({ results: [], clients: [] }), { headers: { 'Content-Type': 'application/json' } })
  }

  const db = env.DB as any

  // F5: detect Drive URL or bare folder id in q
  const bareFolderId = /^[A-Za-z0-9_-]{20,}$/.test(qRaw) ? qRaw : null
  const folderIdFromUrl = extractFolderId(qRaw)
  const driveFolderId = folderIdFromUrl || bareFolderId

  // 1. Matched contacts (client-level link lives on contacts)
  let contactQuery: string
  let contactBinds: any[] = []

  if (driveFolderId) {
    contactQuery = `
      SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
             c.drive_folder_url, c.drive_folder_id, c.drive_is_manual
      FROM contacts c
      WHERE c.drive_folder_id = ?1
         OR EXISTS (
           SELECT 1 FROM client_drive_folders x
           WHERE x.contact_id = c.id AND (x.folder_id = ?1 OR x.parent_folder_id = ?1)
         )
      LIMIT 50
    `
    contactBinds = [driveFolderId]
  } else if (qRaw) {
    const like = `%${qRaw.toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
    contactQuery = `
      SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
             c.drive_folder_url, c.drive_folder_id, c.drive_is_manual
      FROM contacts c
      WHERE lower(c.email) LIKE ?1 ESCAPE '\\'
         OR lower(c.first_name) LIKE ?1 ESCAPE '\\'
         OR lower(c.last_name) LIKE ?1 ESCAPE '\\'
      ORDER BY c.created_at DESC
      LIMIT 50
    `
    contactBinds = [like]
  } else {
    // Date filter only, no q — return recent contacts with meetings in range
    contactQuery = `
      SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
             c.drive_folder_url, c.drive_folder_id, c.drive_is_manual
      FROM contacts c
      WHERE EXISTS (
        SELECT 1 FROM bookings b2 WHERE b2.contact_id = c.id AND b2.status = 'confirmed'
          ${startDate ? 'AND datetime(b2.slot_start) >= datetime(?1)' : ''}
          ${endDate ? `AND datetime(b2.slot_start) <= datetime(?${startDate ? 2 : 1})` : ''}
      )
      ORDER BY c.created_at DESC
      LIMIT 50
    `
    contactBinds = []
    if (startDate) contactBinds.push(startDate)
    if (endDate) contactBinds.push(endDate)
  }

  let contacts: any[] = []
  try {
    const contactsRes = await db.prepare(contactQuery).bind(...contactBinds).all()
    contacts = contactsRes?.results || []
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  if (!contacts.length) {
    return new Response(JSON.stringify({ results: [], clients: [] }), { headers: { 'Content-Type': 'application/json' } })
  }

  const contactIds = contacts.map((c: any) => c.contact_id)

  // 2. Year folders
  let yearFolders: any[] = []
  try {
    // Build IN clause with positional params
    const placeholders = contactIds.map((_: string, i: number) => `?${i + 1}`).join(', ')
    const foldersRes = await db
      .prepare(`SELECT contact_id, year, folder_url, folder_id, parent_folder_id, parent_folder_url, is_manual FROM client_drive_folders WHERE contact_id IN (${placeholders}) ORDER BY year DESC`)
      .bind(...contactIds)
      .all()
    yearFolders = foldersRes?.results || []
  } catch {
    yearFolders = []
  }

  // 3. Meetings — date filter narrows meetings only (M2 fix: client remains with empty list when outside range)
  let meetings: any[] = []
  try {
    const placeholders = contactIds.map((_: string, i: number) => `?${i + 1}`).join(', ')
    let meetingQuery = `SELECT contact_id, id as booking_id, calendar_event_id, meet_link, purpose, slot_start, slot_end, time_zone, status, cancel_token FROM bookings WHERE contact_id IN (${placeholders}) AND status = 'confirmed'`
    const meetingBinds: any[] = [...contactIds]
    let nextIdx = contactIds.length + 1
    if (startDate) {
      meetingQuery += ` AND datetime(slot_start) >= datetime(?${nextIdx})`
      meetingBinds.push(startDate)
      nextIdx++
    }
    if (endDate) {
      meetingQuery += ` AND datetime(slot_start) <= datetime(?${nextIdx})`
      meetingBinds.push(endDate)
      nextIdx++
    }
    meetingQuery += ` ORDER BY slot_start DESC LIMIT 500`
    const meetingsRes = await db.prepare(meetingQuery).bind(...meetingBinds).all()
    meetings = meetingsRes?.results || []
  } catch {
    meetings = []
  }

  // Group by contact (M1 fix: no fan-out)
  const folderMap = new Map<string, any[]>()
  for (const f of yearFolders) {
    const arr = folderMap.get(f.contact_id) || []
    arr.push({ year: f.year, folder_url: f.folder_url, folder_id: f.folder_id, parent_folder_id: f.parent_folder_id, is_manual: f.is_manual })
    folderMap.set(f.contact_id, arr)
  }
  const meetingMap = new Map<string, any[]>()
  for (const m of meetings) {
    const arr = meetingMap.get(m.contact_id) || []
    arr.push(m)
    meetingMap.set(m.contact_id, arr)
  }

  const clients = contacts.map((c: any) => ({
    ...c,
    year_folders: folderMap.get(c.contact_id) || [],
    meetings: meetingMap.get(c.contact_id) || [],
  }))

  // Backward compat: flat results array for old UI (deprecated) + new grouped clients
  // Old shape: one entry per booking — kept but deduped by using meetings only, not folders×meetings
  const legacyResults = clients.flatMap((client: any) => {
    if (!client.meetings.length) {
      // No meetings but client matched — return client row with no booking id (so search doesn't drop them per M2)
      return [{ ...client, booking_id: undefined, meet_link: undefined, purpose: undefined, slot_start: undefined, time_zone: client.time_zone, year: undefined, year_folder_url: client.drive_folder_url }]
    }
    return client.meetings.map((m: any) => ({
      contact_id: client.contact_id,
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
      booking_id: m.booking_id,
      meet_link: m.meet_link,
      purpose: m.purpose,
      slot_start: m.slot_start,
      time_zone: m.time_zone,
      year: undefined,
      year_folder_url: client.drive_folder_url,
      drive_folder_url: client.drive_folder_url,
      drive_folder_id: client.drive_folder_id,
    }))
  })

  return new Response(JSON.stringify({ results: legacyResults, clients }), { headers: { 'Content-Type': 'application/json' } })
}
