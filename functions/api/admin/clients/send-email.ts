import { isAdminAuthenticated } from '../../../_lib/auth'
import { sendAdminDriveEmail, EmailMeeting } from '../../../_lib/email'
import type { Env } from '../auth'

function formatInTimeZone(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { contact_id, booking_ids: requestedBookingIds } = body as { contact_id?: string; booking_ids?: string[] }
  if (!contact_id) return new Response(JSON.stringify({ error: 'Missing contact_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const db = env.DB as any

  const contact = (await db.prepare('SELECT id, email, first_name, drive_folder_url FROM contacts WHERE id = ?').bind(contact_id).first()) as any
  if (!contact) return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

  // Candidate: upcoming confirmed bookings
  const allMeetingsRes = (await db
    .prepare(
      `SELECT id, slot_start, slot_end, time_zone, purpose, meet_link, cancel_token
       FROM bookings
       WHERE contact_id = ? AND status = 'confirmed' AND datetime(slot_start) >= datetime('now')
       ORDER BY slot_start ASC`
    )
    .bind(contact_id)
    .all()) as any

  const candidateMeetings: any[] = allMeetingsRes?.results || []
  const candidateIds = new Set(candidateMeetings.map((m: any) => m.id))

  // F2: optional booking_ids filtering with validation
  let selectedMeetings: any[] = candidateMeetings
  if (Array.isArray(requestedBookingIds) && requestedBookingIds.length > 0) {
    const invalid = requestedBookingIds.filter((id) => !candidateIds.has(id))
    if (invalid.length > 0) {
      return new Response(
        JSON.stringify({ error: 'booking_ids must belong to contact_id and be upcoming', invalid }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    selectedMeetings = candidateMeetings.filter((m: any) => requestedBookingIds.includes(m.id))
  }

  // Drive link: contacts.drive_folder_url (client-level 1:1) with legacy fallback — M1 fix: never use sentinel string as href
  let driveLink: string | null = contact.drive_folder_url || null
  if (!driveLink) {
    try {
      const folder = (await db
        .prepare('SELECT folder_url FROM client_drive_folders WHERE contact_id = ? ORDER BY year DESC LIMIT 1')
        .bind(contact_id)
        .first()) as any
      driveLink = folder?.folder_url || null
    } catch {
      driveLink = null
    }
  }

  const origin = new URL(request.url).origin
  const emailMeetings: EmailMeeting[] = selectedMeetings.map((m: any) => ({
    dateTime: formatInTimeZone(m.slot_start, m.time_zone),
    timeZone: m.time_zone || undefined,
    purpose: m.purpose || undefined,
    meetLink: m.meet_link || null,
    cancelUrl: m.cancel_token ? `${origin}/api/cancel/${m.cancel_token}` : undefined,
  }))

  console.log(`!!! ADMIN_CLIENT_SEND contact=${contact_id} email=${contact.email} selected=${selectedMeetings.length}/${candidateMeetings.length}`)

  let emailResult: any = null
  try {
    emailResult = await sendAdminDriveEmail({
      to: contact.email,
      firstName: contact.first_name || 'there',
      driveLink,
      meetings: emailMeetings,
      env,
    })
  } catch (e: any) {
    console.log(`!!! ADMIN_CLIENT_SEND_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  // M8 fix: return full contract
  return new Response(
    JSON.stringify({
      success: true,
      sentTo: contact.email,
      meetingsCount: selectedMeetings.length,
      driveLink,
      emailResult,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
