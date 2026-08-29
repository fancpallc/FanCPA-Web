import { deleteBookingEvent } from '../../../_lib/google-calendar'
import { getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey, hasOAuthConfig } from '../../../_lib/env'
import { isAdminAuthenticated } from '../../../_lib/auth'
import { sendBookingCancelledEmail } from '../../../_lib/email'

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

export async function onRequestDelete(context: { request: Request; env: any; params: { id: string } }) {
  const { request, env, params } = context

  // B3 fix: admin auth required
  const { authed, error: authError } = isAdminAuthenticated(request, env)
  if (!authed) {
    return new Response(JSON.stringify({ error: 'Unauthorized', details: authError }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = env.DB
  const bookingId = params.id
  const url = new URL(request.url)
  const cancelMeeting = url.searchParams.get('cancelMeeting') === 'true'
  // F3: notifyClient flag, defaults to cancelMeeting per plan
  const notifyClientRaw = url.searchParams.get('notifyClient')
  const notifyClient = notifyClientRaw === null ? cancelMeeting : notifyClientRaw === 'true'

  try {
    // Need contact for cancellation email
    const booking = (await db
      .prepare(
        `SELECT b.*, c.email as contact_email, c.first_name as contact_first_name, c.drive_folder_url as contact_drive_url
         FROM bookings b LEFT JOIN contacts c ON c.id = b.contact_id
         WHERE b.id = ?`
      )
      .bind(bookingId)
      .first()) as any

    if (!booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    let calendarDeleteAttempted = 0
    let calendarDeleteSucceeded = 0
    let calendarDeleteErrors: string[] = []
    const isStubEvent = !booking.calendar_event_id || String(booking.calendar_event_id).startsWith('stub-') || String(booking.calendar_event_id).startsWith('missing-')

    if (cancelMeeting && booking.calendar_event_id && !isStubEvent) {
      const bookingCalId = getBookingCalendarId(env)
      const personalCalId = getPersonalCalendarId(env)
      const targets: string[] = []
      if (bookingCalId) targets.push(bookingCalId)
      if (personalCalId && personalCalId !== bookingCalId) targets.push(personalCalId)

      for (const calId of targets) {
        calendarDeleteAttempted++
        try {
          const ok = await deleteBookingEvent(env, booking.calendar_event_id, calId)
          if (ok) {
            calendarDeleteSucceeded++
          } else {
            calendarDeleteErrors.push(`delete failed for calendar ${calId.slice(0, 8)}...`)
          }
        } catch (e: any) {
          const msg = e?.message || String(e)
          calendarDeleteErrors.push(msg)
          console.log(`!!! ADMIN_CANCEL_MEETING_EXCEPTION calendarId=${calId.slice(0, 8)}... ${msg}`)
        }
      }
      console.log('!!! ADMIN_CANCEL_MEETING', { bookingId, calendarDeleteAttempted, calendarDeleteSucceeded, calendarDeleteErrors })

      // If any calendar delete failed (including partial: 1 of 2), block DB delete so admin can retry.
      // Previously guard was succeeded===0, allowing 2 attempted / 1 succeeded to slip through and delete DB row,
      // leaving a ghost event on the failed calendar with no record to retry.
      if (calendarDeleteAttempted > 0 && calendarDeleteSucceeded < calendarDeleteAttempted) {
        const hasCredentials = !!getGcalServiceKey(env) || hasOAuthConfig(env) || !!(env?.GCAL_SERVICE_ACCOUNT_KEY || env?.GOOGLE_SERVICE_ACCOUNT_KEY)
        if (!hasCredentials) {
          // No credentials configured — treat as stub-deletion and allow DB delete with warning
          console.log(`!!! ADMIN_CANCEL_NO_CREDENTIALS bookingId=${bookingId} — allowing DB delete but returning warning`)
        } else {
          return new Response(JSON.stringify({
            error: calendarDeleteSucceeded === 0 ? 'Calendar event deletion failed' : 'Calendar event deletion partially failed',
            details: calendarDeleteErrors.join('; ') || 'One or more calendar delete attempts returned false',
            calendarDeleteAttempted,
            calendarDeleteSucceeded,
          }), { status: 502, headers: { 'Content-Type': 'application/json' } })
        }
      }
    } else if (cancelMeeting) {
      console.log('!!! ADMIN_CANCEL_MEETING_SKIP_STUB', { bookingId, calendar_event_id: booking.calendar_event_id })
    }

    // L3 fix: DELETE booking row BEFORE sending cancellation email — if DELETE throws, client must not be told it's cancelled
    await db.prepare('DELETE FROM bookings WHERE id = ?').bind(bookingId).run()

    // F3: cancellation email — report actual outcome, not intent, non-blocking after DB delete
    let notified = false
    let notifyError: string | undefined
    let notifyAttempted = false
    if (notifyClient) {
      notifyAttempted = true
      if (!booking.contact_email) {
        notifyError = 'No contact_email on booking — notification not sent'
        console.log(`!!! ADMIN_CANCEL_NOTIFY_SKIP_NO_EMAIL bookingId=${bookingId}`)
      } else {
        try {
          const dateTime = formatInTimeZone(booking.slot_start, booking.time_zone)
          const result = await sendBookingCancelledEmail({
            to: booking.contact_email,
            firstName: booking.contact_first_name || 'there',
            dateTime,
            purpose: booking.purpose || undefined,
            driveFolderUrl: booking.contact_drive_url || undefined,
            env,
          })
          notified = !!result.success
          if (!result.success) {
            notifyError = result.error || 'sendBookingCancelledEmail returned success=false'
            console.log(`!!! ADMIN_CANCEL_NOTIFY_ERROR bookingId=${bookingId} error=${notifyError}`)
          } else {
            console.log(`!!! ADMIN_CANCEL_NOTIFY_SENT bookingId=${bookingId} to=${booking.contact_email}`)
          }
        } catch (e: any) {
          notified = false
          notifyError = e?.message || String(e)
          console.log(`!!! ADMIN_CANCEL_NOTIFY_EXCEPTION bookingId=${bookingId} ${notifyError}`)
        }
      }
    }

    // cancelled true only when all requested deletes succeeded (or were stub/no-creds)
    const actuallyCancelled = cancelMeeting ? (isStubEvent || calendarDeleteAttempted === 0 || calendarDeleteSucceeded === calendarDeleteAttempted) : false

    return new Response(JSON.stringify({
      success: true,
      cancelled: actuallyCancelled,
      calendarDeleteAttempted,
      calendarDeleteSucceeded,
      calendarDeleteErrors: calendarDeleteErrors.length ? calendarDeleteErrors : undefined,
      // warn when creds missing and deletes failed — DB row gone but calendar may still have ghost event
      warning: calendarDeleteAttempted > 0 && calendarDeleteSucceeded < calendarDeleteAttempted ? 'No calendar credentials configured — DB booking deleted but calendar event may survive' : undefined,
      notified, // actual outcome, not intent
      notifyError: notifyError || undefined,
      notifyAttempted,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
