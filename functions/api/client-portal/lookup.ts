import { verifyTurnstile } from '../../_lib/turnstile'
import { sendClientPortalDriveEmail, EmailMeeting } from '../../_lib/email'
import { getTurnstileSecret } from '../../_lib/env'

function formatInTimeZone(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
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

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  let body: any
  try {
    body = await request.json()
  } catch {
    console.log('!!! CLIENT_PORTAL_LOOKUP_BAD_JSON')
    return new Response(JSON.stringify({ success: true, message: 'If your email exists, we sent a link' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const { email, turnstileToken } = body as { email?: string; turnstileToken?: string }

  if (!email || typeof email !== 'string' || !email.trim()) {
    console.log('!!! CLIENT_PORTAL_LOOKUP_MISSING_EMAIL')
    return new Response(JSON.stringify({ success: true, message: 'If your email exists, we sent a link' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) {
    console.log('!!! CLIENT_PORTAL_LOOKUP_INVALID_EMAIL')
    return new Response(JSON.stringify({ success: true, message: 'If your email exists, we sent a link' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // B2 fix: use correct secret name and pass env for fallback + ENVIRONMENT detection
  const secret = getTurnstileSecret(env) || env?.TURNSTILE_SECRET_KEY || ''
  const result = await verifyTurnstile(turnstileToken || '', secret, env)

  if (!result.ok) {
    console.log(`!!! CLIENT_PORTAL_LOOKUP_TURNSTILE_FAIL error=${result.error} source=${result.source}`)
    return new Response(JSON.stringify({ error: 'Invalid Turnstile token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = env.DB
  const emailLower = email.toLowerCase().trim()

  console.log(`!!! CLIENT_PORTAL_LOOKUP_START email=${emailLower} turnstileSource=${result.source}`)

  const contact = (await db
    .prepare('SELECT * FROM contacts WHERE email = ?')
    .bind(emailLower)
    .first()) as any

  if (!contact) {
    console.log('!!! CLIENT_PORTAL_LOOKUP_NOT_FOUND')
    return new Response(JSON.stringify({ success: true, message: 'If your email exists, we sent a link' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Client-level drive link (Rev2) — contacts.drive_folder_url is the canonical 1:1 link
  let driveFolderUrl: string | undefined = contact.drive_folder_url || undefined

  const yearFoldersRes = (await db
    .prepare('SELECT year, folder_url FROM client_drive_folders WHERE contact_id = ? ORDER BY year DESC')
    .bind(contact.id)
    .all()) as any

  const yearFolders = (yearFoldersRes?.results || []).map((r: any) => ({
    year: r.year,
    url: r.folder_url,
  }))

  if (!driveFolderUrl && yearFolders.length) {
    // Legacy fallback: newest year folder url
    driveFolderUrl = yearFolders[0].url
  }

  // F1: upcoming bookings with cancel links
  const origin = new URL(request.url).origin
  const meetingsRaw = (await db
    .prepare(
      `SELECT id, slot_start, slot_end, time_zone, purpose, meet_link, cancel_token
       FROM bookings
       WHERE contact_id = ? AND status = 'confirmed' AND datetime(slot_start) >= datetime('now')
       ORDER BY slot_start ASC`
    )
    .bind(contact.id)
    .all()) as any

  const meetings: EmailMeeting[] = (meetingsRaw?.results || []).map((b: any) => ({
    dateTime: formatInTimeZone(b.slot_start, b.time_zone),
    timeZone: b.time_zone || undefined,
    purpose: b.purpose || undefined,
    meetLink: b.meet_link || null,
    cancelUrl: b.cancel_token ? `${origin}/api/cancel/${b.cancel_token}` : undefined,
  }))

  console.log(`!!! CLIENT_PORTAL_LOOKUP_FOUND contact=${contact.id} years=${yearFolders.length} meetings=${meetings.length}`)

  // Rev2: ALWAYS send when contact exists, even with zero folders/meetings
  try {
    await sendClientPortalDriveEmail({
      to: contact.email,
      firstName: contact.first_name,
      driveFolderUrl,
      yearFolders,
      meetings,
      env,
    })
  } catch (e: any) {
    console.log(`!!! CLIENT_PORTAL_LOOKUP_EMAIL_ERROR ${e?.message}`)
  }

  return new Response(JSON.stringify({ success: true, message: 'If your email exists, we sent a link' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
