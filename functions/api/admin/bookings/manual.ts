import { isAdminAuthenticated } from '../../../_lib/auth'
import { ensureClientDriveFolder, extractFolderId } from '../../../_lib/google-drive'
import { createBookingEvent, getDiagInfo } from '../../../_lib/google-calendar'
import { sendConfirmationEmail } from '../../../_lib/email'
import { hasOAuthConfig, getBookingCalendarId, getGcalServiceKey, getDriveRootFolderId } from '../../../_lib/env'

function formatInTimeZone(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
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

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const auth = isAdminAuthenticated(request, env)
  if (!auth.authed) {
    return new Response(JSON.stringify({ error: 'Unauthorized', details: auth.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const {
    first_name,
    last_name,
    email,
    phone,
    purpose,
    slot_start,
    slot_end,
    time_zone,
    sendEmail,
    drive_folder_url,
  } = body as {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    purpose?: string
    slot_start?: string
    slot_end?: string
    time_zone?: string
    sendEmail?: boolean
    drive_folder_url?: string
  }

  if (!first_name || !last_name || !email || !slot_start || !slot_end) {
    return new Response(JSON.stringify({ error: 'Missing required fields: first_name, last_name, email, slot_start, slot_end' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const startDate = new Date(slot_start)
  const endDate = new Date(slot_end)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return new Response(JSON.stringify({ error: 'Invalid slot_start or slot_end date' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (startDate >= endDate) {
    return new Response(JSON.stringify({ error: 'Start must be before end' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const db = env.DB as any
  const emailLower = email.toLowerCase().trim()
  // H2 fix: worker's Intl zone is always UTC on workerd — default to America/New_York when blank, don't trust browserTz from Worker
  const browserTz = (time_zone && String(time_zone).trim()) ? String(time_zone).trim() : 'America/New_York'

  // C1: expectedLive — same pattern as confirm/[token].ts:148 — if live creds configured and not local/test/STUB, a stub result is fatal
  const hasLiveCreds = (!!getGcalServiceKey(env) || hasOAuthConfig(env)) && !!getBookingCalendarId(env)
  const expectedLive = hasLiveCreds && env?.ENVIRONMENT !== 'local' && env?.ENVIRONMENT !== 'test' && env?.STUB !== 'true'

  // 1. Upsert contact (keep phone)
  const existing = (await db.prepare('SELECT id FROM contacts WHERE email = ?').bind(emailLower).first()) as any
  let contact_id: string
  if (existing?.id) {
    contact_id = existing.id
    // M4 fix: persist phone as well
    if (phone) {
      await db.prepare('UPDATE contacts SET first_name = ?, last_name = ?, phone = ? WHERE id = ?').bind(first_name.trim(), last_name.trim(), phone.trim(), contact_id).run()
    } else {
      await db.prepare('UPDATE contacts SET first_name = ?, last_name = ? WHERE id = ?').bind(first_name.trim(), last_name.trim(), contact_id).run()
    }
  } else {
    contact_id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO contacts (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)')
      .bind(contact_id, first_name.trim(), last_name.trim(), emailLower, phone?.trim() || null)
      .run()
  }

  // 2. Drive auto — B1 fix: bind all NOT NULL columns, C1 fix: fail on stub in prod, H1 fix: reject /file/d/
  const meetingYear = startDate.getFullYear()
  let driveLink: string = drive_folder_url?.trim() || ''
  let driveResult: any = null
  let folderIdFromUrl: string | null = null
  if (driveLink) {
    // H1: must be a folder URL, not a file
    if (!/^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+/.test(driveLink)) {
      return new Response(JSON.stringify({ error: 'Invalid drive_folder_url — must be https://drive.google.com/drive/folders/<id>' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    folderIdFromUrl = extractFolderId(driveLink) || null
  }

  if (!driveLink) {
    try {
      // F4: honor client-level override if present
      let parentFolderId: string | undefined
      try {
        const c = (await db.prepare('SELECT drive_folder_id, drive_is_manual FROM contacts WHERE id = ?').bind(contact_id).first()) as any
        if (c?.drive_is_manual && c?.drive_folder_id) parentFolderId = c.drive_folder_id
      } catch {}
      driveResult = await ensureClientDriveFolder(env, emailLower, meetingYear, { parentFolderId, db })
      // C1: when expectedLive and drive is stub (token exchange failed), refuse to fabricate and persist fake URL
      if (expectedLive && driveResult?.source === 'stub') {
        console.log(`!!! MANUAL_DRIVE_STUB_FAIL error=${driveResult?.error} — returning 502`)
        return new Response(JSON.stringify({ error: 'Drive folder creation failed — Google error', details: driveResult?.error || 'stub in prod', diag: getDiagInfo(env) }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
      if (driveResult) {
        // Extra safety: never persist fake- ids as canonical in live envs
        const isFake = String(driveResult.yearFolderId || '').startsWith('fake-') || String(driveResult.emailFolderId || '').startsWith('fake-')
        if (expectedLive && isFake) {
          return new Response(JSON.stringify({ error: 'Drive folder creation returned fake id in live env', details: driveResult?.error }), { status: 502, headers: { 'Content-Type': 'application/json' } })
        }
        driveLink = driveResult.yearFolderUrl
        // B1 fix: insert with all required columns
        await db
          .prepare(
            `INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, parent_folder_id, parent_folder_url)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(contact_id, year) DO UPDATE SET
               folder_url = excluded.folder_url,
               folder_id = excluded.folder_id,
               email = excluded.email,
               parent_folder_id = excluded.parent_folder_id,
               parent_folder_url = excluded.parent_folder_url,
               updated_at = datetime('now')`
          )
          .bind(
            contact_id,
            emailLower,
            meetingYear,
            driveResult.yearFolderId,
            driveResult.yearFolderUrl,
            driveResult.emailFolderId,
            driveResult.emailFolderUrl
          )
          .run()
      }
    } catch (e: any) {
      if (expectedLive) {
        console.log(`!!! MANUAL_DRIVE_ERROR_LIVE ${e?.message} — returning 502`)
        return new Response(JSON.stringify({ error: 'Drive folder creation failed', details: e?.message, diag: getDiagInfo(env) }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
      console.log(`!!! MANUAL_DRIVE_ERROR ${e?.message} — non-blocking in non-live env`)
    }
  } else if (folderIdFromUrl) {
    // Admin provided override drive_folder_url — persist as year folder + client root
    try {
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
        .bind(contact_id, emailLower, meetingYear, folderIdFromUrl, driveLink)
        .run()
    } catch (e: any) {
      console.log(`!!! MANUAL_DRIVE_OVERRIDE_ERROR ${e?.message}`)
    }
  }

  // 3. Calendar — C1 fix: must not fabricate fake Meet link in live env
  const cancelToken = crypto.randomUUID()
  let calResult: any = null
  try {
    calResult = await createBookingEvent(env, {
      firstName: first_name.trim(),
      lastName: last_name.trim(),
      email: emailLower,
      phone: phone?.trim(),
      purpose: purpose?.trim(),
      slot: { date: slot_start.split('T')[0], start: slot_start, end: slot_end },
      cancelToken,
      siteUrl: env?.SITE_URL,
    })
    // C1: confirm/[token].ts:148 already does this — expectedLive && source stub → 502
    if (expectedLive && calResult?.source === 'stub') {
      console.log(`!!! MANUAL_CALENDAR_STUB_FAIL error=${calResult?.error} — returning 502`)
      return new Response(JSON.stringify({ error: 'Calendar event creation failed — Google error', details: calResult?.error || 'stub in prod', diag: getDiagInfo(env) }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    // Extra guard: fake meet links must never become canonical in live env
    const isFakeMeet = !calResult || String(calResult.meetLink || '').includes('/fake-') || String(calResult.calendarEventId || '').startsWith('stub-') || String(calResult.calendarEventId || '').startsWith('missing-')
    if (expectedLive && isFakeMeet) {
      return new Response(JSON.stringify({ error: 'Calendar returned fake Meet link in live env', details: calResult?.error }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
  } catch (e: any) {
    if (expectedLive) {
      console.log(`!!! MANUAL_CALENDAR_ERROR_LIVE ${e?.message} — returning 502`)
      return new Response(JSON.stringify({ error: 'Calendar event creation failed', details: e?.message, diag: getDiagInfo(env) }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    console.log(`!!! MANUAL_CALENDAR_ERROR ${e?.message} — non-blocking in non-live, using stub`)
    calResult = { calendarEventId: `stub-${cancelToken}`, meetLink: `https://meet.google.com/fake-${cancelToken.slice(0, 4)}`, source: 'stub', error: e?.message }
  }
  // Fallback for non-live envs when create succeeded but result null (shouldn't happen)
  if (!calResult) {
    calResult = { calendarEventId: `stub-${cancelToken}`, meetLink: `https://meet.google.com/fake-${cancelToken.slice(0, 4)}`, source: 'stub' }
  }

  // 4. Insert booking — M4 fix: persist time_zone
  const bookingId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO bookings (id, contact_id, calendar_event_id, meet_link, purpose, cancel_token, status, slot_start, slot_end, drive_folder_url, time_zone)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`
    )
    .bind(
      bookingId,
      contact_id,
      calResult.calendarEventId || null,
      calResult.meetLink || null,
      purpose?.trim() || 'Meeting',
      cancelToken,
      slot_start,
      slot_end,
      driveLink || null,
      browserTz
    )
    .run()

  // 5. Email — M5 fix: formatted dateTime, include cancelUrl, driveYear
  if (sendEmail) {
    try {
      const formattedDate = formatInTimeZone(slot_start, browserTz)
      const origin = new URL(request.url).origin
      const cancelUrl = `${origin}/api/cancel/${cancelToken}`
      await sendConfirmationEmail({
        to: emailLower,
        firstName: first_name.trim(),
        lastName: last_name.trim(),
        dateTime: formattedDate,
        meetLink: calResult.meetLink,
        driveFolderUrl: driveLink || undefined,
        driveYear: meetingYear,
        cancelUrl,
        purpose: purpose?.trim() || undefined,
        env,
      })
    } catch (e: any) {
      console.log(`!!! MANUAL_EMAIL_ERROR ${e?.message} — non-blocking`)
    }
  }

  return new Response(
    JSON.stringify({ success: true, bookingId, meetLink: calResult.meetLink, driveLink: driveLink || null, calendarEventId: calResult.calendarEventId }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
