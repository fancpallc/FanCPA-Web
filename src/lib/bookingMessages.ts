/**
 * What a visitor is told when part of the booking pipeline fails.
 *
 * The confirmation panel used to render the vendor's own error string. A booking to an
 * unverified sending domain ended with the visitor reading
 * `Resend failed 422 {"statusCode":422,…"Please use our testing email address instead of
 * domains like example.com. See our documentation…"}` — the email provider talking to a
 * developer, on a prospective client's screen.
 *
 * Double opt-in note: pending_bookings is created BEFORE email. If sendPendingConfirmEmail
 * fails, nothing is booked yet (no bookings row until token click) — so detail must NOT say
 * "Your meeting is booked". See P0 #1.
 */

export const BOOKING_MESSAGES = {
  /** Pending exists but confirmation email failed — nothing booked yet (double opt-in). */
  emailNotSent: {
    heading: 'Confirmation email couldn’t be sent',
    detail: 'Your time isn’t booked yet — we couldn’t deliver the confirmation email. Check spam for “Confirm your meeting”, wait a minute and try again, or contact us.',
  },
  /** The meeting exists; the video link is a stand-in until Calendar is connected. */
  placeholderMeetLink: {
    heading: 'This video link is a placeholder',
    detail: 'Your booking is saved. The site owner has been notified and will send you the real link.',
  },
} as const

/** True when the Meet URL is the stub the backend returns with no calendar configured. */
export function isPlaceholderMeetLink(meetLink?: string | null): boolean {
  return Boolean(meetLink && meetLink.includes('fake-'))
}
