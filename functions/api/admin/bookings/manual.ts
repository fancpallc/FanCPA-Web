import { isAdminAuthenticated } from '../../../_lib/auth'
import { ensureClientDriveFolder } from '../../../_lib/google-drive'
import { createBookingEvent } from '../../../_lib/google-calendar'
import { sendConfirmationEmail } from '../../../_lib/email'

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const auth = isAdminAuthenticated(request, env)
  if (!auth.authed) {
    return new Response(JSON.stringify({ error: 'Unauthorized', details: auth.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const body = await request.json() as any
  const { first_name, last_name, email, slot_start, slot_end, purpose, sendEmail, drive_folder_url } = body

  if (!first_name || !last_name || !email || !slot_start || !slot_end) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (new Date(slot_start) >= new Date(slot_end)) {
    return new Response(JSON.stringify({ error: 'Start must be before end' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // 1. Upsert Contact
  const contact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?').bind(email).first()
  let contact_id: string
  if (contact) {
    contact_id = contact.id
    await env.DB.prepare('UPDATE contacts SET first_name = ?, last_name = ? WHERE id = ?').bind(first_name, last_name, contact_id).run()
  } else {
    contact_id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO contacts (id, first_name, last_name, email) VALUES (?, ?, ?, ?)').bind(contact_id, first_name, last_name, email).run()
  }

  // 2. Drive auto
  const meetingYear = new Date(slot_start).getFullYear()
  let driveLink = drive_folder_url
  if (!driveLink) {
    const driveResult = await ensureClientDriveFolder(env, email, meetingYear)
    driveLink = driveResult.yearFolderUrl
    await env.DB.prepare('INSERT OR REPLACE INTO client_drive_folders (contact_id, folder_url, year) VALUES (?, ?, ?)')
      .bind(contact_id, driveLink, meetingYear).run()
  }

  // 3. Calendar blocking
  const cancelToken = crypto.randomUUID()
  const calResult = await createBookingEvent(env, {
    firstName: first_name,
    lastName: last_name,
    email,
    purpose,
    slot: { date: slot_start.split('T')[0], start: slot_start, end: slot_end },
    cancelToken
  })

  // 4. Insert booking
  const bookingId = crypto.randomUUID()
  await env.DB.prepare(`
    INSERT INTO bookings (id, contact_id, calendar_event_id, meet_link, purpose, cancel_token, status, slot_start, slot_end, drive_folder_url)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
  `).bind(bookingId, contact_id, calResult.calendarEventId, calResult.meetLink, purpose || 'Meeting', cancelToken, slot_start, slot_end, driveLink).run()

  // 5. Email
  if (sendEmail) {
    await sendConfirmationEmail({
      to: email,
      firstName: first_name,
      lastName: last_name,
      dateTime: slot_start,
      meetLink: calResult.meetLink,
      driveFolderUrl: driveLink,
      env
    })
  }

  return new Response(JSON.stringify({ success: true, bookingId, meetLink: calResult.meetLink, driveLink, calendarEventId: calResult.calendarEventId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
