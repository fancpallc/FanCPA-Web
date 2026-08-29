import { getResendApiKey } from './env'

// L5: escape user-controlled fields that end up in HTML — self-injection only today, but prevents future XSS
function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface EmailEnv {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  ENVIRONMENT?: string
  SITE_URL?: string
  [key: string]: any
}

export interface SendEmailParams {
  to: string
  firstName: string
  lastName: string
  meetLink?: string
  cancelUrl?: string
  dateTime: string
  purpose?: string
  driveFolderUrl?: string
  driveLink?: string
  driveYear?: number
  env: EmailEnv
}

export interface SendEmailResult {
  success: boolean
  id?: string
  source: 'live' | 'stub'
  error?: string
}

// Rev2 shared meeting shape
export interface EmailMeeting {
  dateTime: string // pre-formatted in client time_zone by caller
  timeZone?: string
  purpose?: string
  meetLink?: string | null // null for legacy rows
  cancelUrl?: string
}

export function renderMeetingRows(meetings: EmailMeeting[]): string {
  if (!meetings.length) return '<p style="color:#64748b;">No upcoming meetings.</p>'
  return `
    <table style="width:100%;border-collapse:collapse;margin:12px 0;">
      <thead><tr style="text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">
        <th style="padding:6px;">Date &amp; Time</th><th style="padding:6px;">Purpose</th><th style="padding:6px;">Join</th><th style="padding:6px;">Cancel</th>
      </tr></thead>
      <tbody>
        ${meetings
          .map(
            (m) => `
          <tr style="border-bottom:1px solid #f1f5f9;font-size:13px;">
            <td style="padding:8px 6px;">${escapeHtml(m.dateTime)}${m.timeZone ? ` <span style="color:#94a3b8;">${escapeHtml(m.timeZone)}</span>` : ''}</td>
            <td style="padding:8px 6px;">${escapeHtml(m.purpose || '')}</td>
            <td style="padding:8px 6px;">${m.meetLink ? `<a href="${m.meetLink}">${escapeHtml(m.meetLink.slice(0, 32))}…</a>` : '<span style="color:#94a3b8;">Not recorded</span>'}</td>
            <td style="padding:8px 6px;">${m.cancelUrl ? `<a href="${m.cancelUrl}" style="color:#dc2626;">Cancel</a>` : ''}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `.trim()
}

export function buildConfirmationEmail(params: {
  firstName: string
  lastName: string
  email: string
  meetLink?: string
  cancelUrl?: string
  dateTime: string
  purpose?: string
  driveFolderUrl?: string
  driveLink?: string
  driveYear?: number
  env?: any
}): string {
  // Backward compat: driveLink alias for driveFolderUrl
  const driveUrl = params.driveFolderUrl || params.driveLink
  const { firstName, lastName, email, meetLink, cancelUrl, dateTime, purpose, driveYear } = params as any
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Meeting Confirmed — ${escapeHtml(dateTime)}</h2>
      <p>Hi ${escapeHtml(firstName)} ${escapeHtml(lastName || '')},</p>
      <p>Your meeting is confirmed for <strong>${escapeHtml(dateTime)}</strong>.</p>
      ${purpose ? `<p><strong>Purpose:</strong> ${escapeHtml(purpose)}</p>` : ''}
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${meetLink ? `<p>Meet link: <a href="${meetLink}">${escapeHtml(meetLink)}</a></p>` : ''}
      ${driveUrl ? `<p>Drive folder${driveYear ? ` (${driveYear})` : ''}: <a href="${driveUrl}">${escapeHtml(driveUrl)}</a></p>` : ''}
      ${cancelUrl ? `<p>Cancel link: <a href="${cancelUrl}">${escapeHtml(cancelUrl)}</a></p>` : ''}
      <p>Google Calendar invite also sent with Meet join button + description containing Meet link. Purpose included in invite.</p>
      <p>Thanks!</p>
    </div>
  `.trim()
}

export function buildPendingConfirmEmail(params: {
  firstName: string
  lastName: string
  email: string
  confirmUrl: string
  dateTime: string
  purpose?: string
  env?: any
}): string {
  const { firstName, lastName, email, confirmUrl, dateTime, purpose } = params
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px;">
      <h2 style="font-family: Playfair Display, serif; font-size: 24px; font-weight: 900;">Confirm your meeting — ${escapeHtml(dateTime)}</h2>
      <p>Hi ${escapeHtml(firstName)} ${escapeHtml(lastName || '')},</p>
      <p>You requested a meeting for <strong>${escapeHtml(dateTime)}</strong>.</p>
      ${purpose ? `<p style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;"><strong>Purpose:</strong> ${escapeHtml(purpose)}</p>` : ''}
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p>Please confirm your email to schedule the meeting. We'll create the Google Calendar invite with Meet link and purpose after confirmation.</p>
      <div style="margin: 24px 0;">
        <a href="${confirmUrl}" style="display:inline-block; padding:12px 24px; background:#0f172a; color:white; border-radius:999px; text-decoration:none; font-weight:600; font-size:14px;">Confirm meeting →</a>
      </div>
      <p style="font-size:12px; color:#94a3b8;">Purpose will be included in calendar invite: ${escapeHtml(purpose || 'Intro call')}</p>
    </div>
  `.trim()
}

export function getSubject(env?: EmailEnv, dateTime?: string): string {
  const isAlpha = env?.ENVIRONMENT === 'alpha'
  const prefix = isAlpha ? '[ALPHA] ' : ''
  return `${prefix}Meeting confirmed — ${dateTime || ''}`.trim()
}

export function getPendingSubject(env?: EmailEnv, dateTime?: string): string {
  const isAlpha = env?.ENVIRONMENT === 'alpha'
  const prefix = isAlpha ? '[ALPHA] ' : ''
  return `${prefix}Confirm your meeting — ${dateTime || ''}`.trim()
}

export interface PendingEmailParams {
  to: string
  firstName: string
  lastName: string
  confirmUrl: string
  dateTime: string
  purpose?: string
  env: EmailEnv
}

export async function sendPendingConfirmEmail(params: PendingEmailParams): Promise<SendEmailResult> {
  const { to, firstName, lastName, confirmUrl, dateTime, purpose, env } = params
  const from = env?.EMAIL_FROM || env?.FROM || 'onboarding@resend.dev'
  const apiKey = getResendApiKey(env) || env?.RESEND_API_KEY
  console.log(`!!! PENDING_EMAIL_START to=${to} from=${from} hasKey=${!!apiKey} env=${env?.ENVIRONMENT} confirmUrl=${confirmUrl} dateTime=${dateTime} purpose=${purpose || 'none'}`)

  if (!apiKey) {
    console.log(`!!! PENDING_EMAIL_STUB no key To=${to} ConfirmUrl=${confirmUrl}`)
    return { success: true, id: 'mock-pending-id', source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = getPendingSubject(env, dateTime)
    const html = buildPendingConfirmEmail({ firstName, lastName, email: to, confirmUrl, dateTime, purpose, env })
    console.log(`!!! PENDING_EMAIL_BUILD_SUBJECT subject=${subject}`)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    console.log(`!!! PENDING_EMAIL_FETCH_RESPONSE status=${res.status} ok=${res.ok}`)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      const msg = `Resend pending failed ${res.status} ${txt}`
      console.log(`!!! PENDING_EMAIL_FAILED ${msg}`)
      return { success: false, source: 'live', error: msg }
    }
    const json = (await res.json()) as any
    console.log(`!!! PENDING_EMAIL_SUCCESS id=${json.id}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    console.log(`!!! PENDING_EMAIL_EXCEPTION ${e?.message}`)
    return { success: false, source: 'live', error: e?.message }
  }
}

export async function sendConfirmationEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, firstName, lastName, meetLink, cancelUrl, dateTime, purpose, driveFolderUrl, driveLink, driveYear, env } = params
  const driveUrl = driveFolderUrl || driveLink
  const from = env?.EMAIL_FROM || env?.FROM || 'onboarding@resend.dev'
  const apiKey = getResendApiKey(env) || env?.RESEND_API_KEY

  console.log(`!!! EMAIL_START to=${to} from=${from} hasKey=${!!apiKey} env=${env?.ENVIRONMENT} meetLink=${meetLink} dateTime=${dateTime} purpose=${purpose || 'none'}`)

  if (!apiKey) {
    console.log(`!!! EMAIL_STUB no key To=${to} Meet=${meetLink} Cancel=${cancelUrl} Date=${dateTime} Purpose=${purpose} — RESEND_API_KEY missing, checked aliases`)
    return { success: true, id: 'mock-id', source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = getSubject(env, dateTime)
    const html = buildConfirmationEmail({ firstName, lastName, email: to, meetLink, cancelUrl, dateTime, purpose, driveFolderUrl: driveUrl, driveYear, env })
    console.log(`!!! EMAIL_BUILD_SUBJECT subject=${subject} from=${from}`)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    console.log(`!!! EMAIL_FETCH_RESPONSE status=${res.status} ok=${res.ok}`)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const msg = `Resend failed ${res.status} ${text}`
      console.log(`!!! EMAIL_FAILED ${msg} To=${to} From=${from} Env=${env?.ENVIRONMENT}`)
      console.error(`[Email live FAILED] ${msg} — To: ${to}, From: ${from}, Env: ${env?.ENVIRONMENT}`)
      return { success: false, id: undefined, source: 'live', error: msg }
    }

    const json = (await res.json()) as any
    console.log(`!!! EMAIL_SUCCESS To=${to} Id=${json.id} Env=${env?.ENVIRONMENT} from=${from}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.log(`!!! EMAIL_EXCEPTION Error=${errMsg} To=${to} Meet=${meetLink} Env=${env?.ENVIRONMENT}`)
    console.error(`[Email exception] Error: ${errMsg}, To: ${to}, Meet: ${meetLink}, Env: ${env?.ENVIRONMENT}`)
    if (env?.ENVIRONMENT === 'local' || env?.ENVIRONMENT === 'test') {
      return { success: true, id: 'mock-id-fallback', source: 'stub', error: errMsg }
    }
    return { success: false, source: 'live', error: errMsg }
  }
}

// ---- Rev2: portal + admin + cancelled templates ----

export function buildClientPortalDriveEmail(params: {
  firstName: string
  driveFolderUrl?: string
  yearFolders?: { year: number; url: string }[]
  driveLinks?: { year: number; url: string }[] // legacy backward compat
  meetings?: EmailMeeting[]
}): string {
  const { firstName } = params
  const driveFolderUrl = (params as any).driveFolderUrl
  const yearFolders = params.yearFolders || params.driveLinks || []
  const meetings = params.meetings || []

  const folderSection = driveFolderUrl && String(driveFolderUrl).startsWith('https://')
    ? `<p>Your documents folder: <a href="${driveFolderUrl}">${escapeHtml(driveFolderUrl)}</a></p>`
    : ''
  const yearSection = yearFolders.length
    ? `<ul>${yearFolders.map((l) => `<li><strong>${l.year}:</strong> <a href="${l.url}">${escapeHtml(l.url)}</a></li>`).join('')}</ul>`
    : !driveFolderUrl
      ? '<p style="color:#64748b;">Your folder will be created with your first booking.</p>'
      : ''

  const meetingsSection = meetings.length
    ? `<h3>Your upcoming meetings</h3>${renderMeetingRows(meetings)}`
    : '<p style="color:#64748b;">No upcoming meetings.</p>'

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your Client Portal</h2>
      <p>Hi ${escapeHtml(firstName)},</p>
      ${folderSection}
      ${yearSection}
      ${meetingsSection}
    </div>
  `.trim()
}

export function buildAdminDriveEmail(params: {
  firstName: string
  driveLink: string | null
  meetings: EmailMeeting[]
}): string {
  const { firstName, driveLink, meetings } = params
  // M1 fix: sentinel string must never be used as href — only render link if valid https URL
  const safeLink = driveLink && typeof driveLink === 'string' && driveLink.startsWith('https://') ? driveLink : null
  const folderSection = safeLink ? `<p>Folder: <a href="${safeLink}">${escapeHtml(safeLink)}</a></p>` : '<p>Folder: <span style="color:#64748b;">No folder found yet</span></p>'
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your documents &amp; upcoming meetings</h2>
      <p>Hi ${escapeHtml(firstName)},</p>
      ${folderSection}
      ${meetings.length ? renderMeetingRows(meetings) : '<p style="color:#64748b;">No upcoming meetings selected.</p>'}
    </div>
  `.trim()
}

export function buildBookingCancelledEmail(params: {
  firstName: string
  dateTime: string
  purpose?: string
  driveFolderUrl?: string
}): string {
  const { firstName, dateTime, purpose, driveFolderUrl } = params
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Meeting cancelled — ${escapeHtml(dateTime)}</h2>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your meeting${purpose ? ` <strong>${escapeHtml(purpose)}</strong>` : ''} scheduled for <strong>${escapeHtml(dateTime)}</strong> has been cancelled.</p>
      <p>No action is needed on your part.</p>
      ${driveFolderUrl && String(driveFolderUrl).startsWith('https://') ? `<p>Your documents folder is unchanged and still accessible: <a href="${driveFolderUrl}">${escapeHtml(driveFolderUrl)}</a></p>` : '<p>Your documents folder, if any, is unchanged.</p>'}
      <p>If this was unexpected, please reply to this email or book a new time.</p>
    </div>
  `.trim()
}

function resendFrom(env: EmailEnv): string {
  return env?.EMAIL_FROM || (env as any)?.FROM || 'onboarding@resend.dev'
}
function resendKey(env: EmailEnv): string | undefined {
  return getResendApiKey(env) || env?.RESEND_API_KEY
}

export async function sendClientPortalDriveEmail(params: {
  to: string
  firstName: string
  driveFolderUrl?: string
  yearFolders?: { year: number; url: string }[]
  driveLinks?: { year: number; url: string }[] // legacy compat
  meetings?: EmailMeeting[]
  env: EmailEnv
}): Promise<SendEmailResult> {
  const { to, firstName, env } = params
  const driveFolderUrl = (params as any).driveFolderUrl
  const yearFolders = params.yearFolders || params.driveLinks || []
  const meetings = params.meetings || []
  const from = resendFrom(env)
  const apiKey = resendKey(env)

  if (!apiKey) {
    console.log(`!!! CLIENT_PORTAL_EMAIL_STUB to=${to} — RESEND_API_KEY missing`)
    return { success: true, source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = 'Your Client Portal — documents & meetings'
    const html = buildClientPortalDriveEmail({ firstName, driveFolderUrl, yearFolders, meetings })
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    console.log(`!!! CLIENT_PORTAL_EMAIL_RESPONSE status=${res.status} ok=${res.ok}`)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      const msg = `Resend client portal failed ${res.status} ${txt}`
      console.log(`!!! CLIENT_PORTAL_EMAIL_FAILED ${msg}`)
      return { success: false, source: 'live', error: msg }
    }
    const json = (await res.json()) as any
    console.log(`!!! CLIENT_PORTAL_EMAIL_SUCCESS id=${json.id}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    console.log(`!!! CLIENT_PORTAL_EMAIL_EXCEPTION ${e?.message}`)
    return { success: false, source: 'live', error: e?.message }
  }
}

export async function sendAdminDriveEmail(params: {
  to: string
  firstName: string
  driveLink: string | null
  meetings: EmailMeeting[]
  env: EmailEnv
}): Promise<SendEmailResult> {
  const { to, firstName, driveLink, meetings, env } = params
  const from = resendFrom(env)
  const apiKey = resendKey(env)

  if (!apiKey) {
    console.log(`!!! ADMIN_DRIVE_EMAIL_STUB to=${to} — RESEND_API_KEY missing`)
    return { success: true, source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = `Your upcoming meetings — ${firstName}`
    const html = buildAdminDriveEmail({ firstName, driveLink, meetings })
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    console.log(`!!! ADMIN_DRIVE_EMAIL_RESPONSE status=${res.status} ok=${res.ok}`)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      const msg = `Resend admin drive failed ${res.status} ${txt}`
      console.log(`!!! ADMIN_DRIVE_EMAIL_FAILED ${msg}`)
      return { success: false, source: 'live', error: msg }
    }
    const json = (await res.json()) as any
    console.log(`!!! ADMIN_DRIVE_EMAIL_SUCCESS id=${json.id}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    console.log(`!!! ADMIN_DRIVE_EMAIL_EXCEPTION ${e?.message}`)
    return { success: false, source: 'live', error: e?.message }
  }
}

export async function sendBookingCancelledEmail(params: {
  to: string
  firstName: string
  dateTime: string
  purpose?: string
  driveFolderUrl?: string
  env: EmailEnv
}): Promise<SendEmailResult> {
  const { to, firstName, dateTime, purpose, driveFolderUrl, env } = params
  const from = resendFrom(env)
  const apiKey = resendKey(env)

  if (!apiKey) {
    console.log(`!!! BOOKING_CANCELLED_EMAIL_STUB to=${to} — RESEND_API_KEY missing`)
    return { success: true, source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = `Meeting cancelled — ${dateTime}`
    const html = buildBookingCancelledEmail({ firstName, dateTime, purpose, driveFolderUrl })
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    console.log(`!!! BOOKING_CANCELLED_EMAIL_RESPONSE status=${res.status} ok=${res.ok}`)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      const msg = `Resend cancelled failed ${res.status} ${txt}`
      console.log(`!!! BOOKING_CANCELLED_EMAIL_FAILED ${msg}`)
      return { success: false, source: 'live', error: msg }
    }
    const json = (await res.json()) as any
    console.log(`!!! BOOKING_CANCELLED_EMAIL_SUCCESS id=${json.id}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    console.log(`!!! BOOKING_CANCELLED_EMAIL_EXCEPTION ${e?.message}`)
    return { success: false, source: 'live', error: e?.message }
  }
}
