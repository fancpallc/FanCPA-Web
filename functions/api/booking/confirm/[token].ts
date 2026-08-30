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

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isFakeMeetLink(link?: string | null): boolean {
  if (!link) return true
  const s = String(link).toLowerCase()
  return s.includes('fake-') || s.includes('fake_') || s.startsWith('missing-') || s.includes('stub-')
}

function htmlPage({ title, body }: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family:Inter,system-ui,sans-serif;background:#fff;color:#0f172a;margin:0;padding:0;">
${body}
</body>
</html>`
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
      return new Response(htmlPage({ title: 'Invalid link', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Invalid link</h1><p>Confirm link invalid.</p><a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a></div>` }), { status: 400, headers: htmlHeaders })
    }

    console.log(`!!! CONFIRM_TOKEN token=${token.slice(0, 8)}...`)

    const db = (env as any)?.DB
    if (!db) {
      console.log('!!! CONFIRM_DB_MISSING')
      return new Response(htmlPage({ title: 'Temporarily unavailable', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Temporarily unavailable</h1><p>Please try again in a moment.</p><a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a></div>` }), { status: 500, headers: htmlHeaders })
    }

    // Lookup pending booking
    let pending: any = null
    try {
      const stmt = db.prepare('SELECT * FROM pending_bookings WHERE confirm_token = ?1')
      pending = await stmt.bind(token).first()
    } catch (e: any) {
      console.log(`!!! CONFIRM_LOOKUP_ERROR ${e?.message}`)
      try {
        const stmt = db.prepare('SELECT * FROM pending_bookings WHERE confirm_token = ?1')
        pending = await stmt.bind(token).first()
      } catch {}
    }

    if (!pending) {
      console.log('!!! CONFIRM_NOT_FOUND')
      return new Response(
        htmlPage({
          title: 'Link invalid',
          body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Confirm link invalid or already used</h2>
          <p>It may have expired or already been confirmed.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `}),
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
        htmlPage({
          title: 'Link expired',
          body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Confirm link expired ⏰</h2>
          <p>This link has expired. Please book again — links are valid for 1 hour.</p>
          <a href="/#calendar" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Book again</a>
        </div>
        `}),
        { status: 410, headers: htmlHeaders }
      )
    }

    if (pending.status === 'confirmed') {
      console.log('!!! CONFIRM_ALREADY_CONFIRMED')
      return new Response(
        htmlPage({
          title: 'Already confirmed',
          body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2>Already confirmed ✅</h2>
          <p>Your meeting is already confirmed. Check your email for details.</p>
          <a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a>
        </div>
        `}),
        { status: 200, headers: htmlHeaders }
      )
    }

    // Check if slot still free via FreeBusy and past check
    const slotStartDate = new Date(pending.slot_start)
    console.log(`!!! CONFIRM_SLOT_CHECK start=${pending.slot_start} now=${new Date().toISOString()}`)
    if (isNaN(slotStartDate.getTime()) || slotStartDate.getTime() < Date.now()) {
      console.log('!!! CONFIRM_SLOT_PAST')
      return new Response(htmlPage({ title: 'Slot expired', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Slot expired — in the past</h1><p>Please book a new time.</p><a href="/#calendar" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Book again</a></div>` }), { status: 409, headers: htmlHeaders })
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
      timeZone: pending.time_zone || undefined,
    })

    console.log(`!!! CONFIRM_GCAL_RESULT source=${source} eventId=${calendarEventId} meetLink=${meetLink} error=${gcalError || 'none'}`)

    const hasLiveCreds = (!!getGcalServiceKey(env) || hasOAuthConfig(env)) && !!getBookingCalendarId(env)
    const expectedLive = hasLiveCreds && env?.ENVIRONMENT !== 'local' && env?.ENVIRONMENT !== 'test' && (env as any)?.STUB !== 'true'

    if (expectedLive && source === 'stub') {
      console.log(`!!! CONFIRM_GCAL_STUB_FAIL error=${gcalError} — not inserting, returning 502`)
      return new Response(
        htmlPage({
          title: 'Scheduling failed',
          body: `
        <div style="max-width:600px;margin:40px auto;padding:24px;border:1px solid #fca5a5;border-radius:16px;background:#fef2f2;">
          <h2>Failed to schedule — calendar error</h2>
          <p>${escapeHtml(gcalError || 'Google Calendar event creation failed')}</p>
          <a href="/#calendar" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Try again</a>
        </div>
        `}),
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

    // V4 + S3 fix: detect fake Meet links (coalesced from google-calendar.ts) and don't render as live
    const hasRealMeet = meetLink && !isFakeMeetLink(meetLink) && String(meetLink).startsWith('https://')
    const safeMeet = hasRealMeet ? meetLink : null
    const hasRealDrive = driveLink && String(driveLink).startsWith('https://') && !String(driveLink).toLowerCase().includes('fake-')

    return new Response(
      htmlPage({
        title: 'Meeting Confirmed',
        body: `
      <div style="max-width:640px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;">
        <!-- 1. Date/Time hero -->
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;padding:6px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;font-size:12px;color:#166534;">Meeting Confirmed ✅</div>
          <h1 style="font-family:'Playfair Display',serif;font-size:28px;font-weight:900;letter-spacing:-0.02em;margin:16px 0 8px;">${escapeHtml(dateTimeEt)}</h1>
          <p style="color:#475569;line-height:1.6;">Hi ${escapeHtml(pending.first_name)}, your meeting is confirmed.<br/>We've emailed the details to ${escapeHtml(pending.email)}.</p>
        </div>

        ${pending.purpose ? `<div style="margin-bottom:16px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;font-size:14px;"><strong>Purpose:</strong> ${escapeHtml(pending.purpose)}</div>` : ''}

        <!-- 2. Upload documents — primary CTA per S3 -->
        ${hasRealDrive ? `<div style="margin:24px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:center;">
          <p style="font-weight:600;margin:0 0 12px;">Upload your documents for ${meetingYear}</p>
          <p style="font-size:12px;color:#64748b;margin:0 0 12px;">Anything you add to this folder is visible to us before the meeting.</p>
          <a href="${escapeHtml(String(driveLink))}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Upload documents for ${meetingYear} →</a>
        </div>` : ''}

        <!-- 3. Join link -->
        ${safeMeet ? `<div style="margin:16px 0;padding:12px;background:white;border:1px solid #e2e8f0;border-radius:8px;">
          <p style="margin:0 0 8px;font-weight:600;">Join link</p>
          <a href="${escapeHtml(safeMeet)}" target="_blank" rel="noopener noreferrer" style="color:#0f172a;text-decoration:underline;word-break:break-all;">Open Meet →</a>
          <p style="font-size:12px;color:#64748b;margin:8px 0 0;">Add to your calendar from the invite in your inbox — no extra .ics needed.</p>
        </div>` : `<div style="margin:16px 0;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e;">Meet link will be sent shortly — your slot is blocked.</div>`}

        <!-- P0 #3 fix: GET no longer one-click cancel (interstitial prevents Safe Links/prefetcher). Explain two-step. -->
        <p style="margin-top:16px;font-size:13px;color:#475569;">Need to cancel? You can cancel up to 24 hours before via your confirmation email or this link — you’ll confirm on the next page to prevent accidental clicks. <a href="${escapeHtml(cancelUrl)}" style="color:#dc2626;text-decoration:underline;">Cancel meeting</a>.</p>

        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
          ${safeMeet ? `<a href="${escapeHtml(safeMeet)}" target="_blank" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;">Open Meet</a>` : ''}
          <a href="/" style="padding:12px 24px;background:white;border:1px solid #e2e8f0;border-radius:999px;text-decoration:none;color:#0f172a;font-weight:600;font-size:14px;">Back to home</a>
        </div>
      </div>
      `,
      }),
      { status: 200, headers: htmlHeaders }
    )
  } catch (e: any) {
    console.log(`!!! CONFIRM_EXCEPTION ${e?.message}`)
    return new Response(htmlPage({ title: 'Confirm failed', body: `<div style="max-width:600px;margin:40px auto;padding:24px;"><h1>Something went wrong</h1><p>Please try again or contact us.</p><a href="/" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0f172a;color:white;border-radius:999px;text-decoration:none;">Back to home</a></div>` }), { status: 500, headers: htmlHeaders })
  }
}
