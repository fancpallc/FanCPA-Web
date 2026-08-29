import { getBookingCalendarId, getGcalServiceKey, getResendApiKey, hasOAuthConfig } from '../../../_lib/env'
import { createBookingEvent, TIMEZONE, getDiagInfo } from '../../../_lib/google-calendar'
import { sendConfirmationEmail } from '../../../_lib/email'
import { ensureClientDriveFolder } from '../../../_lib/google-drive'

export interface Env {
  DB?: any
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  PERSONAL_CALENDAR_ID?: string
  PERSONAL?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REFRESH_TOKEN?: string
  SITE_URL?: string
  ENVIRONMENT?: string
  TIMEZONE?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  [key: string]: any
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const headers = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const htmlHeaders = {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
  }

  try {
    console.log('!!! CONFIRM_REQUEST_START')
    const token = (params as any)?.token as string
    if (!token) {
      console.log('!!! CONFIRM_MISSING_TOKEN')
      return new Response('<h1>Missing token</h1><p>Confirm link invalid.</p>', { status: 400, headers: htmlHeaders })
    }

    console.log(`!!! CONFIRM_TOKEN token=${token.slice(0, 8)}...`)

    const db = (env as any)?.DB
    if (!db) {
      console.log('!!! CONFIRM_DB_MISSING')
      return new Response('<h1>DB not configured</h1>', { status: 500, headers: htmlHeaders })
    }

    // Lookup pending booking
    let pending: any = null
    try {
      const stmt = db.prepare('SELECT * FROM pending_bookings WHERE confirm_token = ?1')
      pending = await stmt.bind(token).first()
    } catch (e: any) {
      console.log(`!!! CONFIRM_LOOKUP_ERROR ${e?.message}`)
      // Try fallback without contact_id etc
      try {
        const stmt = db.prepare('SELECT * FROM pending_bookings WHERE confirm_token = ?1')
        pending = await stmt.bind(token).first()
      } catch {}
    }

    if (!pending) {
      console.log('!!! CONFIRM_NOT_FOUND')
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Confirm link invalid or already used</h2>
          <p>Token <code>${token.slice(0, 8)}...</code> not found. It may have expired or already been confirmed.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `,
        { status: 404, headers: htmlHeaders }
      )
    }

    console.log(`!!! CONFIRM_PENDING_FOUND email=${pending.email} slot=${pending.slot_start} status=${pending.status} expires=${pending.expires_at} purpose=${pending.purpose || 'none'}`)

    // Check expiry
    const now = new Date()
    const expiresAt = new Date(pending.expires_at)
    if (isNaN(expiresAt.getTime()) || now > expiresAt) {
      console.log(`!!! CONFIRM_EXPIRED now=${now.toISOString()} expires=${pending.expires_at}`)
      try {
        const delStmt = db.prepare('DELETE FROM pending_bookings WHERE confirm_token = ?1')
        await delStmt.bind(token).run()
      } catch {}
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Confirm link expired ⏰</h2>
          <p>This link expired at ${pending.expires_at}. Please book again.</p>
          <a href="/#calendar" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Book again</a>
        </div>
        `,
        { status: 410, headers: htmlHeaders }
      )
    }

    if (pending.status === 'confirmed') {
      console.log('!!! CONFIRM_ALREADY_CONFIRMED')
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Already confirmed ✅</h2>
          <p>Your meeting for ${pending.slot_start} is already confirmed.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `,
        { status: 200, headers: htmlHeaders }
      )
    }

    // Check if slot still free via FreeBusy and past check
    const slotStartDate = new Date(pending.slot_start)
    console.log(`!!! CONFIRM_SLOT_CHECK start=${pending.slot_start} now=${new Date().toISOString()}`)
    if (isNaN(slotStartDate.getTime()) || slotStartDate.getTime() < Date.now()) {
      console.log('!!! CONFIRM_SLOT_PAST')
      return new Response('<h1>Slot expired — in past</h1><p>Please book a new slot.</p>', { status: 409, headers: htmlHeaders })
    }

    // Create Google Calendar event with purpose included
    const siteUrl = env?.SITE_URL || 'https://profile-webapp.pages.dev'
    const cancelToken = crypto.randomUUID()
    console.log(`!!! CONFIRM_GCAL_CREATE_START cancelToken=${cancelToken} purpose=${pending.purpose || 'none'}`)

    const diagBefore = getDiagInfo(env)
    const { calendarEventId, meetLink, source, error: gcalError } = await createBookingEvent(env, {
      firstName: pending.first_name,
      lastName: pending.last_name,
      email: pending.email,
      phone: pending.phone,
      purpose: pending.purpose,
      slot: { date: pending.slot_date, start: pending.slot_start, end: pending.slot_end },
      cancelToken,
      siteUrl,
    })

    console.log(`!!! CONFIRM_GCAL_RESULT source=${source} eventId=${calendarEventId} meetLink=${meetLink} error=${gcalError || 'none'}`)

    const hasLiveCreds = (!!getGcalServiceKey(env) || hasOAuthConfig(env)) && !!getBookingCalendarId(env)
    const expectedLive = hasLiveCreds && env?.ENVIRONMENT !== 'local' && env?.ENVIRONMENT !== 'test' && (env as any)?.STUB !== 'true'

    if (expectedLive && source === 'stub') {
      console.log(`!!! CONFIRM_GCAL_STUB_FAIL error=${gcalError} — not inserting, returning 502`)
      return new Response(
        `
        <div style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:24px;border:1px solid #fca5a5;border-radius:16px;background:#fef2f2;">
          <h2>Failed to schedule — calendar error</h2>
          <p>${gcalError || 'Google Calendar event creation failed'}</p>
          <pre style="font-size:11px; background:white; padding:12px; border-radius:8px; overflow:auto;">${JSON.stringify(diagBefore, null, 2)}</pre>
          <a href="/#calendar" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Try again</a>
        </div>
        `,
        { status: 502, headers: htmlHeaders }
      )
    }

    // Insert into bookings (only after Google 200)
    console.log('!!! CONFIRM_BOOKING_INSERT_START')
    let contactId = pending.contact_id
    let bookingId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    let driveResult = null, driveLink = null, meetingYear = new Date(pending.slot_start).getFullYear()

    try {
      // Ensure contact exists (might have been created in pending flow)
      if (!contactId) {
        const existingStmt = db.prepare('SELECT id FROM contacts WHERE email = ?1')
        const existing = (await existingStmt.bind(pending.email).first()) as any
        if (existing?.id) contactId = existing.id
        else {
          const newId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
          contactId = newId
          const insertStmt = db.prepare('INSERT INTO contacts (id, first_name, last_name, email, phone, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime("now"))')
          await insertStmt.bind(newId, pending.first_name, pending.last_name, pending.email, pending.phone || null).run().catch(() => {})
        }
      }

      // Drive: non-blocking per §5 + PR-3 — booking succeeds even if Drive fails, email without drive link.
      // Calendar event already created above; returning 502 here would leak duplicate calendar events on retry.
      try {
        // F4: honor client-level override — new years filed under admin-chosen folder
        let parentFolderId: string | undefined
        try {
          const c = (await db.prepare('SELECT drive_folder_id, drive_is_manual FROM contacts WHERE id = ?1').bind(contactId).first()) as any
          if (c?.drive_is_manual && c?.drive_folder_id) parentFolderId = c.drive_folder_id
        } catch {}
        try {
          driveResult = await ensureClientDriveFolder(env, pending.email, meetingYear, { parentFolderId, db })
          const isStub = driveResult?.source === 'stub'
          const isFakeId = String(driveResult?.yearFolderId || '').startsWith('fake-') || String(driveResult?.emailFolderId || '').startsWith('fake-')
          // Gate fake persistence on expectedLive (matching manual.ts:137,145) — in local/stub keep fake rows so PR-3 verifications and client-portal flow stay exercisable.
          // In live, refuse to persist fake and make Drive non-blocking (no 502, booking succeeds without link).
          if (expectedLive && (isStub || isFakeId)) {
            console.log(`!!! CONFIRM_DRIVE_STUB_FAIL_NONBLOCKING source=${driveResult?.source} fake=${isFakeId} error=${driveResult?.error} — booking succeeds without Drive link, refusing to persist fake`)
            driveResult = null
            driveLink = null
          } else {
            if (isStub || isFakeId) {
              console.log(`!!! CONFIRM_DRIVE_STUB_PERSIST_NONLIVE source=${driveResult?.source} fake=${isFakeId} — persisting fake for local dev exercisability`)
            }
            driveLink = driveResult?.yearFolderUrl
            // M10 fix: refresh all folder ids on conflict, not just folder_url
            const upsert = db.prepare(
              `INSERT INTO client_drive_folders (contact_id,email,year,folder_id,folder_url,parent_folder_id,parent_folder_url)
               VALUES (?1,?2,?3,?4,?5,?6,?7)
               ON CONFLICT(contact_id,year) DO UPDATE SET
                 folder_id=excluded.folder_id,
                 folder_url=excluded.folder_url,
                 parent_folder_id=excluded.parent_folder_id,
                 parent_folder_url=excluded.parent_folder_url,
                 email=excluded.email,
                 updated_at=datetime('now')`
            )
            await upsert
              .bind(contactId, pending.email.toLowerCase(), meetingYear, driveResult.yearFolderId, driveResult.yearFolderUrl, driveResult.emailFolderId, driveResult.emailFolderUrl)
              .run()
            try {
              await db
                .prepare('UPDATE contacts SET drive_folder_url=?1, drive_folder_id=COALESCE(drive_folder_id,?2) WHERE id=?3')
                .bind(driveResult.emailFolderUrl, driveResult.emailFolderId, contactId)
                .run()
            } catch {
              await db.prepare('UPDATE contacts SET drive_folder_url=?1 WHERE id=?2').bind(driveResult.emailFolderUrl, contactId).run().catch(() => {})
            }
          }
        } catch (e: any) {
          if (expectedLive) {
            console.log(`!!! CONFIRM_DRIVE_ERROR_LIVE_NONBLOCKING ${e?.message} — booking succeeds without drive link, logging loudly`)
          } else {
            console.log(`!!! CONFIRM_DRIVE_ERROR_NONBLOCKING ${e?.message} — non-blocking`)
          }
          driveResult = null
          driveLink = null
        }
      } catch (e: any) {
        console.log(`!!! CONFIRM_DRIVE_OUTER_ERROR ${e?.message} — non-blocking, will still attempt booking insert without drive link`)
        driveResult = null
        driveLink = null
      }

      // The pending row already carries the slot the visitor picked; carry it across so
      // "Manage bookings" shows the meeting time rather than the moment they confirmed.
      const insertBookingStmt = db.prepare('INSERT INTO bookings (id, contact_id, calendar_event_id, purpose, cancel_token, status, slot_start, slot_end, created_at, meet_link, time_zone, drive_folder_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime("now"), ?9, ?10, ?11)')
      await insertBookingStmt.bind(bookingId, contactId!, calendarEventId, pending.purpose || null, cancelToken, 'confirmed', pending.slot_start, pending.slot_end, meetLink, pending.time_zone || null, driveLink).run()
      console.log(`!!! CONFIRM_BOOKING_INSERT_OK bookingId=${bookingId}`)
    } catch (e: any) {
      console.log(`!!! CONFIRM_BOOKING_INSERT_ERROR ${e?.message}`)
    }

    // Delete pending (or mark confirmed)
    try {
      const delStmt = db.prepare('DELETE FROM pending_bookings WHERE confirm_token = ?1')
      await delStmt.bind(token).run()
      console.log('!!! CONFIRM_PENDING_DELETE_OK')
    } catch (e: any) {
      console.log(`!!! CONFIRM_PENDING_DELETE_ERROR ${e?.message}`)
      try {
        const updStmt = db.prepare('UPDATE pending_bookings SET status = ?1 WHERE confirm_token = ?2')
        await updStmt.bind('confirmed', token).run()
      } catch {}
    }

    // Send final confirmation email with Meet link + purpose + cancel
    const dateTimeEt = new Date(pending.slot_start).toLocaleString('en-US', {

      timeZone: pending.time_zone || env?.TIMEZONE || TIMEZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })

    const cancelUrl = `${new URL(request.url).origin}/api/cancel/${cancelToken}`
    console.log(`!!! CONFIRM_FINAL_EMAIL_SEND to=${pending.email} meetLink=${meetLink} purpose=${pending.purpose || 'none'}`)

    const emailResult = await sendConfirmationEmail({
      to: pending.email,
      firstName: pending.first_name,
      lastName: pending.last_name,
      meetLink,
      cancelUrl,
      dateTime: dateTimeEt,
      purpose: pending.purpose,
      driveFolderUrl: driveLink || undefined,
      driveYear: meetingYear,
      env: {
        RESEND_API_KEY: getResendApiKey(env) || env?.RESEND_API_KEY,
        EMAIL_FROM: env?.EMAIL_FROM,
        ENVIRONMENT: env?.ENVIRONMENT,
        SITE_URL: siteUrl,
        ...env,
      },
    })
    console.log(`!!! CONFIRM_FINAL_EMAIL_RESULT success=${emailResult.success} error=${emailResult.error || 'none'}`)

    const isJson = request.headers.get('Accept')?.includes('application/json') || new URL(request.url).searchParams.get('format') === 'json'

    if (isJson) {
      return new Response(
        JSON.stringify({
          success: true,
          confirmed: true,
          meetLink,
          dateTime: dateTimeEt,
          cancelUrl,
          purpose: pending.purpose || null,
          calendarEventId,
          source,
          emailResult,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      )
    }

    return new Response(
      `
      <div style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#f0fdf4;">
        <h1 style="font-family:Playfair Display,serif;font-size:28px;font-weight:900;letter-spacing:-0.02em;">Meeting Confirmed ✅</h1>
        <p style="margin-top:12px;color:#475569;line-height:1.6;">Hi ${pending.first_name}, your meeting for <strong>${dateTimeEt}</strong> is confirmed.</p>
        ${pending.purpose ? `<div style="margin-top:12px;background:white;padding:12px;border-radius:8px;border:1px solid #e2e8f0;"><strong>Purpose:</strong> ${pending.purpose}</div>` : ''}
        <p style="margin-top:12px;">Meet: <a href="${meetLink}" target="_blank" rel="noopener noreferrer" style="color:#0f172a; text-decoration:underline;">${meetLink || 'No Meet link (bare event — group calendar may not support Meet via SA, but slot blocked)'}</a></p>
        ${gcalError ? `<div style="margin-top:8px;padding:8px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:12px;">Note: ${gcalError}</div>` : ''}
        <p style="margin-top:8px;font-size:13px;color:#64748b;">Cancel anytime: <a href="${cancelUrl}" style="color:#dc2626; text-decoration:underline;">${cancelUrl}</a></p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="${meetLink}" target="_blank" style="padding:12px 24px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Open Meet →</a>
          <a href="/" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;">Back to home</a>
          <button onclick="(() => {
            const formatDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const data = [
              'BEGIN:VCALENDAR',
              'VERSION:2.0',
              'PRODID:-//FanCPA//Meeting//EN',
              'BEGIN:VEVENT',
              'SUMMARY:Meeting with ${pending.first_name} ${pending.last_name}',
              'DESCRIPTION:${pending.purpose || 'Intro call'}',
              'DTSTART:' + formatDate(new Date('${pending.slot_start}')),
              'DTEND:' + formatDate(new Date('${pending.slot_end}')),
              'LOCATION:${meetLink}',
              'END:VEVENT',
              'END:VCALENDAR'
            ].join('\\r\\n');
            const blob = new Blob([data], { type: 'text/calendar;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'meeting.ics';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          })()" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;cursor:pointer;">Download .ics</button>
        </div>
        <p style="margin-top:16px;font-size:12px;color:#94a3b8;">Purpose included in calendar invite: ${pending.purpose || 'Intro call'} — Google event ${calendarEventId} source ${source}</p>
      </div>
      `,
      { status: 200, headers: htmlHeaders }
    )
  } catch (e: any) {
    console.log(`!!! CONFIRM_EXCEPTION ${e?.message}`)
    return new Response(`<h1>Confirm failed</h1><p>${e?.message || String(e)}</p>`, { status: 500, headers: htmlHeaders })
  }
}
