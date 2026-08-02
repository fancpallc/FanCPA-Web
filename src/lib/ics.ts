export interface IcsEvent {
  title: string
  description?: string
  location?: string
  start: string // ISO
  end: string // ISO
  meetLink?: string
  organizer?: string
  attendee?: string
}

function formatDateUtcForIcs(iso: string): string {
  // Convert ISO to UTC format YYYYMMDDTHHMMSSZ for .ics DTSTART/DTEND in UTC
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z'
    )
  } catch {
    return iso.replace(/[-:]/g, '').split('.')[0] + 'Z'
  }
}

export function generateIcsContent(event: IcsEvent): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@profile-webapp.pages.dev`
  const dtstamp = formatDateUtcForIcs(new Date().toISOString())
  const dtstart = formatDateUtcForIcs(event.start)
  const dtend = formatDateUtcForIcs(event.end)
  const description = (event.description || '').replace(/\n/g, '\\n').replace(/,/g, '\\,')
  const meetLink = event.meetLink || ''
  const location = event.location || meetLink || ''
  const summary = event.title.replace(/,/g, '\\,')

  // VCALENDAR with VEVENT containing Meet link in LOCATION and DESCRIPTION + URL
  // For Google Meet, LOCATION is Meet link, DESCRIPTION includes Meet link per user request
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//profile-webapp//Portfolio Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}${meetLink ? '\\n\\nMeet: ' + meetLink : ''}`,
    `LOCATION:${location}`,
    meetLink ? `URL:${meetLink}` : '',
    `ORGANIZER;CN=Portfolio:MAILTO:bookings@profile-webapp.pages.dev`,
    event.attendee ? `ATTENDEE;CN=${event.attendee}:MAILTO:${event.attendee}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

export function downloadIcsFile(content: string, filename: string = 'meeting.ics') {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
