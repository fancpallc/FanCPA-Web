import { deleteBookingEvent } from '../../../_lib/google-calendar'
import { getBookingCalendarId, getPersonalCalendarId } from '../../../_lib/env'

export async function onRequestDelete(context: { request: Request; env: any; params: { id: string } }) {
  const { request, env, params } = context
  
  // D1 is usually injected via env.DB in Cloudflare Workers
  const db = env.DB 
  
  const bookingId = params.id
  const url = new URL(request.url)
  const cancelMeeting = url.searchParams.get('cancelMeeting') === 'true'

  try {
    const booking = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first()
    if (!booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404 })
    }

    if (cancelMeeting && booking.calendar_event_id) {
      const bookingCalId = getBookingCalendarId(env)
      const personalCalId = getPersonalCalendarId(env)

      // Delete from both if applicable - ignore 404 as requested
      if (bookingCalId) await deleteBookingEvent(env, booking.calendar_event_id, bookingCalId)
      if (personalCalId) await deleteBookingEvent(env, booking.calendar_event_id, personalCalId)
      
      console.log('ADMIN_CANCEL_MEETING', { bookingId })
    }

    await db.prepare('DELETE FROM bookings WHERE id = ?').bind(bookingId).run()

    return new Response(JSON.stringify({ success: true, cancelled: cancelMeeting }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
