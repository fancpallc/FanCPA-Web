import { deleteBookingEvent, createBookingEvent } from '../../../_lib/google-calendar'
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

function clientFirstFallback(b: any): string {
  // If contact join failed, try plausible first name from purpose? No — use generic but email already validated
  return 'Client'
}

function isUpcomingConfirmed(b: any): boolean {
  if (!b) return false
  if (b.status !== 'confirmed' && b.status) {
    if (b.status === 'cancelled') return false
  }
  if (b.deleted_at) return false
  // P2 fix: use slot_end so in-progress meeting stays upcoming until end
  const endIso = b.slot_end || b.slot_start
  if (!endIso) return false
  const t = new Date(endIso).getTime()
  return !isNaN(t) && t >= Date.now() - 60_000
}

export async function onRequestDelete(context: { request: Request; env: any; params: { id: string } }) {
  const { request, env, params } = context

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
  const actionParam = url.searchParams.get('action')
  const hideParam = url.searchParams.get('hide') === 'true' || actionParam === 'hide'
  const cancelParam = actionParam === 'cancel'
  const wantsCancel = cancelMeeting || cancelParam
  const wantsHide = hideParam
  // If no explicit flag, legacy behavior: S8 requires explicit flag; bare DELETE without action is ambiguous
  const notifyClientRaw = url.searchParams.get('notifyClient')
  const notifyClient = notifyClientRaw === null ? wantsCancel : notifyClientRaw === 'true'

  try {
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

    if (booking.deleted_at) {
      return new Response(JSON.stringify({ error: 'Already hidden' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const upcoming = isUpcomingConfirmed(booking)

    // S8 design: Upcoming confirmed rows have no delete — action is Cancel meeting (status=cancelled, row stays)
    // Cancelled and past rows have no cancel — action is Hide (soft delete)
    if (wantsCancel) {
      if (!upcoming) {
        return new Response(JSON.stringify({ error: 'Cannot cancel past or already-cancelled meeting — use Hide' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }

      let calendarDeleteAttempted = 0
      let calendarDeleteSucceeded = 0
      let calendarDeleteErrors: string[] = []
      const isStubEvent = !booking.calendar_event_id || String(booking.calendar_event_id).startsWith('stub-') || String(booking.calendar_event_id).startsWith('missing-')

      if (booking.calendar_event_id && !isStubEvent) {
        const bookingCalId = getBookingCalendarId(env)
        const personalCalId = getPersonalCalendarId(env)
        const targets: string[] = []
        if (bookingCalId) targets.push(bookingCalId)
        if (personalCalId && personalCalId !== bookingCalId) targets.push(personalCalId)

        for (const calId of targets) {
          calendarDeleteAttempted++
          try {
            // P1 dedup + intentional silent-cancel path (review confirmation):
            // - shouldNotify:false hardcoded suppresses Google's sendUpdates=all so we never double-email
            //   (Google + Resend). When notifyClient=true we send custom Resend cancellation email only.
            // - When notifyClient=false (unchecked), BOTH Google and Resend send nothing — event vanishes
            //   from client's calendar with no notice. This is INTENTIONAL for test/mistyped bookings and
            //   matches S8 design "Cancel meeting — deletes event, optionally emails". Admin must consciously
            //   uncheck the box to get silent path; default is checked (notify). See AdminClients.tsx checkbox.
            const ok = await deleteBookingEvent(env, booking.calendar_event_id, calId, { shouldNotify: false })
            if (ok) calendarDeleteSucceeded++
            else calendarDeleteErrors.push(`delete failed for calendar ${calId.slice(0, 8)}...`)
          } catch (e: any) {
            calendarDeleteErrors.push(e?.message || String(e))
          }
        }

        if (calendarDeleteAttempted > 0 && calendarDeleteSucceeded < calendarDeleteAttempted) {
          const hasCredentials = !!getGcalServiceKey(env) || hasOAuthConfig(env)
          if (hasCredentials) {
            return new Response(JSON.stringify({
              error: calendarDeleteSucceeded === 0 ? 'Calendar event deletion failed' : 'Calendar event deletion partially failed',
              details: calendarDeleteErrors.join('; '),
              calendarDeleteAttempted,
              calendarDeleteSucceeded,
            }), { status: 502, headers: { 'Content-Type': 'application/json' } })
          }
        }
      }

      // Cancel = update status, not delete (L3 fix: update BEFORE email so email not sent if DB fails)
      try {
        await db.prepare(`UPDATE bookings SET status='cancelled', cancelled_at=datetime('now'), cancelled_by='admin', cancel_notified=?1, updated_at=datetime('now') WHERE id=?2`)
          .bind(notifyClient ? 1 : 0, bookingId).run()
      } catch (e: any) {
        // Fallback without new columns for old DBs
        try {
          await db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?1`).bind(bookingId).run()
        } catch {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      }

      let notified = false
      let notifyError: string | undefined
      if (notifyClient) {
        if (!booking.contact_email) {
          notifyError = 'No contact email to notify — client record missing email'
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
            if (!result.success) notifyError = result.error || 'Email send failed'
          } catch (e: any) {
            notifyError = e?.message || String(e)
          }
        }
      }

      const actuallyCancelled = calendarDeleteAttempted === 0 || calendarDeleteSucceeded === calendarDeleteAttempted
      return new Response(JSON.stringify({
        success: true,
        cancelled: actuallyCancelled,
        calendarDeleteAttempted,
        calendarDeleteSucceeded,
        calendarDeleteErrors: calendarDeleteErrors.length ? calendarDeleteErrors : undefined,
        notified,
        notifyError,
        notifyAttempted: notifyClient,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    if (wantsHide) {
      if (upcoming) {
        return new Response(JSON.stringify({ error: 'Upcoming meetings must be cancelled first — use Cancel meeting, then Hide' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      // Hide = soft delete — P1 fix: removed hard-delete fallback that previously destroyed rows when UPDATE failed (pattern that hid S7)
      try {
        await db.prepare(`UPDATE bookings SET deleted_at=datetime('now'), deleted_reason='hidden_by_admin', updated_at=datetime('now') WHERE id=?1`).bind(bookingId).run()
      } catch (e: any) {
        try {
          await db.prepare(`UPDATE bookings SET deleted_at=datetime('now') WHERE id=?1`).bind(bookingId).run()
        } catch (e2: any) {
          console.log(`!!! HIDE_FAILED id=${bookingId} ${e2?.message}`)
          return new Response(JSON.stringify({ error: `Failed to hide booking: ${e2?.message || String(e2)}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })
        }
      }
      return new Response(JSON.stringify({ success: true, hidden: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // No flag supplied — S8: bare DELETE without action is ambiguous. For safety:
    // If upcoming confirmed, reject (must use cancel). If past/cancelled, treat as hide.
    if (upcoming) {
      return new Response(JSON.stringify({ error: 'Upcoming meetings cannot be removed directly — use Cancel meeting' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    // Past/cancelled → hide (no hard-delete fallback)
    try {
      await db.prepare(`UPDATE bookings SET deleted_at=datetime('now'), deleted_reason='hidden_by_admin', updated_at=datetime('now') WHERE id=?1`).bind(bookingId).run()
    } catch (e: any) {
      try {
        await db.prepare(`UPDATE bookings SET deleted_at=datetime('now') WHERE id=?1`).bind(bookingId).run()
      } catch (e2: any) {
        console.log(`!!! HIDE_BARE_FAILED id=${bookingId} ${e2?.message}`)
        return new Response(JSON.stringify({ error: `Failed to hide booking: ${e2?.message || String(e2)}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ success: true, hidden: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function onRequestPatch(context: { request: Request; env: any; params: { id: string } }) {
  const { request, env, params } = context
  const { authed, error: authError } = isAdminAuthenticated(request, env)
  if (!authed) {
    return new Response(JSON.stringify({ error: 'Unauthorized', details: authError }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const db = env.DB
  const bookingId = params.id
  let body: any
  try { body = await request.json() } catch { body = {} }
  const action = body?.action as string

  try {
    // P0 fix: join contacts to get real email/name/phone, unlike previous SELECT * that lacked contact columns,
    // which made rebook create "Meeting with Client" with empty attendee email and corrupt the row with fake ids.
    const booking = (await db
      .prepare(
        `SELECT b.*, c.email as contact_email, c.first_name as contact_first_name, c.last_name as contact_last_name, c.phone as contact_phone, c.drive_folder_url as contact_drive_url
         FROM bookings b LEFT JOIN contacts c ON c.id = b.contact_id
         WHERE b.id = ?`
      )
      .bind(bookingId)
      .first()) as any
    if (!booking) return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })

    if (action === 'unhide') {
      try {
        await db.prepare(`UPDATE bookings SET deleted_at=NULL, deleted_reason=NULL, updated_at=datetime('now') WHERE id=?1`).bind(bookingId).run()
      } catch {
        await db.prepare(`UPDATE bookings SET deleted_at=NULL WHERE id=?1`).bind(bookingId).run().catch(() => {})
      }
      return new Response(JSON.stringify({ success: true, unhidden: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    if (action === 'rebook') {
      const siteUrl = env?.SITE_URL || new URL(request.url).origin
      const existingToken = booking.cancel_token
      const resolvedEmail = (body.email || booking.contact_email || '').trim()
      if (!resolvedEmail) {
        return new Response(JSON.stringify({ error: 'Cannot rebook — contact email missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      // P0 #4 fix: reusing original slot_start that is past creates event in past → row renders Completed.
      // If original is past and admin didn't provide new slot, reject and ask for new time (prevents Completed past rebook).
      const originalStart = booking.slot_start ? new Date(booking.slot_start).getTime() : NaN
      const isOriginalPast = !isNaN(originalStart) && originalStart < Date.now() - 60_000
      const overrideStart = body.slot_start || body.slot?.start
      const overrideEnd = body.slot_end || body.slot?.end
      const hasSlotOverride = !!(overrideStart && overrideEnd)
      if (isOriginalPast && !hasSlotOverride) {
        return new Response(JSON.stringify({ error: 'Cannot rebook past meeting — original time is in the past. Provide new slot_start and slot_end in the request body to reschedule.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      // Resolve slot from overrides if provided, else original (which is now guaranteed future unless overridden past explicitly)
      const finalSlotStart = overrideStart || booking.slot_start
      const finalSlotEnd = overrideEnd || booking.slot_end
      const finalSlotDate = body.slot_date || body.slot?.date || booking.slot_date || finalSlotStart?.split('T')[0]
      if (!finalSlotStart || !finalSlotEnd) {
        return new Response(JSON.stringify({ error: 'Cannot rebook — slot_start/slot_end missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      // Validate final slot not in past (defensive)
      const finalStartMs = new Date(finalSlotStart).getTime()
      if (!isNaN(finalStartMs) && finalStartMs < Date.now() - 60_000) {
        // Allow if explicitly past override? No — block past rebook even with override to prevent Completed
        return new Response(JSON.stringify({ error: 'Cannot rebook to a time in the past — pick a future slot.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
      const resolvedFirst = body.first_name || booking.contact_first_name || booking.first_name || clientFirstFallback(booking)
      const resolvedLast = body.last_name || booking.contact_last_name || booking.last_name || ''
      const createRes = await createBookingEvent(env, {
        firstName: resolvedFirst,
        lastName: resolvedLast,
        email: resolvedEmail,
        phone: body.phone || booking.contact_phone,
        purpose: body.purpose || booking.purpose,
        slot: { date: finalSlotDate, start: finalSlotStart, end: finalSlotEnd },
        cancelToken: existingToken,
        siteUrl,
        timeZone: body.time_zone || booking.time_zone || undefined,
      })
      // P0: if Google rejected (fake- id), do NOT write corrupt row — return error so toast does not claim success
      if (!createRes.calendarEventId || String(createRes.calendarEventId).startsWith('stub-') || String(createRes.calendarEventId).startsWith('missing-') || String(createRes.calendarEventId).startsWith('fake-') || createRes.meetLink.includes('fake-')) {
        // In live env with creds, stub means failure; in local/test we allow stub? For rebook, never allow fake to corrupt
        const hasCreds = !!getGcalServiceKey(env) || hasOAuthConfig(env)
        if (hasCreds) {
          return new Response(JSON.stringify({ error: createRes.error || 'Failed to create calendar event — rebook aborted to avoid corrupt booking', source: createRes.source, calendarEventId: createRes.calendarEventId }), { status: 502, headers: { 'Content-Type': 'application/json' } })
        }
      }
      // Update row to confirmed again, clear cancelled/hidden
      try {
        await db.prepare(`UPDATE bookings SET status='confirmed', calendar_event_id=?1, meet_link=?2, deleted_at=NULL, deleted_reason=NULL, cancelled_at=NULL, cancelled_by=NULL, updated_at=datetime('now') WHERE id=?3`)
          .bind(createRes.calendarEventId, createRes.meetLink, bookingId).run()
      } catch {
        await db.prepare(`UPDATE bookings SET status='confirmed', calendar_event_id=?1 WHERE id=?2`).bind(createRes.calendarEventId, bookingId).run()
      }
      return new Response(JSON.stringify({ success: true, rebooked: true, calendarEventId: createRes.calendarEventId, meetLink: createRes.meetLink, source: createRes.source, error: createRes.error }), { headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Invalid action (unhide|rebook)' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
