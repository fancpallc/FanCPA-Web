export interface Env {
  DB?: any
  [key: string]: any
}

function escapeIcsText(str: string): string {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

function toIcsUtc(dt: string | Date): string {
  const d = typeof dt === 'string' ? new Date(dt) : dt
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = (params as any)?.id as string
  const headers = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }
  if (!id) {
    return new Response('Missing booking id', { status: 400, headers })
  }
  const db = (env as any)?.DB
  if (!db) {
    return new Response('DB not configured', { status: 500, headers })
  }
  let row: any = null
  try {
    // Bookings joined with contacts for name/email
    row = await db.prepare(
      `SELECT b.id, b.slot_start, b.slot_end, b.purpose, b.meet_link, b.drive_folder_url, b.time_zone, b.cancel_token,
              c.first_name, c.last_name, c.email, c.phone
       FROM bookings b JOIN contacts c ON c.id = b.contact_id WHERE b.id = ?1 LIMIT 1`
    ).bind(id).first()
  } catch (e: any) {
    console.log(`!!! INVITE_ICS_LOOKUP_ERROR ${e?.message}`)
    // Fallback simple lookup without join for test envs
    try {
      row = await db.prepare('SELECT * FROM bookings WHERE id = ?1 LIMIT 1').bind(id).first()
    } catch {}
  }

  if (!row) {
    return new Response('Booking not found', { status: 404, headers })
  }

  const slotStart = row.slot_start
  const slotEnd = row.slot_end
  if (!slotStart || !slotEnd) {
    return new Response('Booking missing slot times', { status: 400, headers })
  }

  const dtStamp = toIcsUtc(new Date())
  const dtStart = toIcsUtc(slotStart)
  const dtEnd = toIcsUtc(slotEnd)
  const uid = `${row.id}@fancpa.local`
  const firstName = row.first_name || 'Client'
  const lastName = row.last_name || ''
  const summary = `Meeting with ${firstName} ${lastName}`.trim()
  const meetLink = row.meet_link && String(row.meet_link).startsWith('https://') && !String(row.meet_link).includes('fake-') ? String(row.meet_link) : ''
  const driveLink = row.drive_folder_url && String(row.drive_folder_url).startsWith('https://') ? String(row.drive_folder_url) : ''
  const cancelToken = row.cancel_token
  const siteUrl = env?.SITE_URL || 'https://fancpa.example'
  const cancelUrl = cancelToken ? `${siteUrl}/api/cancel/${cancelToken}` : ''

  const descLines: string[] = []
  if (row.purpose) descLines.push(row.purpose)
  if (driveLink) {
    descLines.push('')
    descLines.push(`Drive folder (upload your documents): ${driveLink}`)
  }
  if (meetLink) {
    descLines.push('')
    descLines.push(`Meet: ${meetLink}`)
  }
  if (cancelUrl) {
    descLines.push(`Cancel: ${cancelUrl}`)
  }
  descLines.push('')
  descLines.push(`Contact: ${row.email || ''} ${row.phone || ''}`.trim())

  const description = escapeIcsText(descLines.join('\n'))

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FanCPA//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${description}`,
    ...(meetLink ? [`LOCATION:${escapeIcsText(meetLink)}`, `URL:${escapeIcsText(meetLink)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')

  return new Response(ics, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="meeting-${row.id}.ics"`,
    },
  })
}
