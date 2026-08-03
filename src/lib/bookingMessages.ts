/**
 * What a visitor is told when part of the booking pipeline fails.
 *
 * The confirmation panel used to render the vendor's own error string. A booking to an
 * unverified sending domain ended with the visitor reading
 * `Resend failed 422 {"statusCode":422,…"Please use our testing email address instead of
 * domains like example.com. See our documentation…"}` — the email provider talking to a
 * developer, on a prospective client's screen — and the calendar case told them to go
 * check `/api/debug/diag`. Neither is the visitor's problem, and both buried the one
 * fact that matters: the meeting is booked.
 *
 * The raw errors still reach the developer via `debug()`, which is DEV-only.
 */

export const BOOKING_MESSAGES = {
  /** The meeting exists; only the confirmation email failed. */
  emailNotSent: {
    heading: 'Confirmation email couldn’t be sent',
    detail: 'Your meeting is booked — save the details below so you have them.',
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
