import { getResendApiKey } from './env'

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
  meetLink: string
  cancelUrl: string
  dateTime: string
  purpose?: string
  env: EmailEnv
}

export interface SendEmailResult {
  success: boolean
  id?: string
  source: 'live' | 'stub'
  error?: string
}

export function buildConfirmationEmail(params: {
  firstName: string
  lastName: string
  email: string
  meetLink: string
  cancelUrl: string
  dateTime: string
  purpose?: string
  env?: any
}): string {
  const { firstName, lastName, email, meetLink, cancelUrl, dateTime, purpose } = params

  // No calendar IDs leaked — only email/purpose/meetLink/cancelUrl/dateTime per requirement
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Meeting Confirmed — ${dateTime}</h2>
      <p>Hi ${firstName} ${lastName || ''},</p>
      <p>Your meeting is confirmed for <strong>${dateTime}</strong>.</p>
      ${purpose ? `<p><strong>Purpose:</strong> ${purpose}</p>` : ''}
      <p><strong>Email:</strong> ${email}</p>
      <p>Meet link: <a href="${meetLink}">${meetLink}</a></p>
      <p>Cancel link: <a href="${cancelUrl}">${cancelUrl}</a></p>
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
      <h2 style="font-family: Playfair Display, serif; font-size: 24px; font-weight: 900;">Confirm your meeting — ${dateTime}</h2>
      <p>Hi ${firstName} ${lastName || ''},</p>
      <p>You requested a meeting for <strong>${dateTime}</strong>.</p>
      ${purpose ? `<p style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;"><strong>Purpose:</strong> ${purpose}</p>` : ''}
      <p><strong>Email:</strong> ${email}</p>
      <p>Please confirm your email to schedule the meeting. We'll create the Google Calendar invite with Meet link and purpose after confirmation.</p>
      <div style="margin: 24px 0;">
        <a href="${confirmUrl}" style="display:inline-block; padding:12px 24px; background:#0f172a; color:white; border-radius:999px; text-decoration:none; font-weight:600; font-size:14px;">Confirm meeting →</a>
      </div>
      <p style="font-size:12px; color:#64748b;">This link expires in 30 minutes and is one-time use. If you didn't request this, ignore this email.</p>
      <p style="font-size:12px; color:#94a3b8;">Purpose will be included in calendar invite: ${purpose || 'Intro call'}</p>
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
  const { to, firstName, lastName, meetLink, cancelUrl, dateTime, purpose, env } = params

  const from = env?.EMAIL_FROM || env?.FROM || 'onboarding@resend.dev'
  const apiKey = getResendApiKey(env) || env?.RESEND_API_KEY

  console.log(`!!! EMAIL_START to=${to} from=${from} hasKey=${!!apiKey} env=${env?.ENVIRONMENT} meetLink=${meetLink} dateTime=${dateTime} purpose=${purpose || 'none'}`)

  // Stub when key missing — return mock success and log (test env with key should still call fetch via mocked global.fetch)
  if (!apiKey) {
    console.log(`!!! EMAIL_STUB no key To=${to} Meet=${meetLink} Cancel=${cancelUrl} Date=${dateTime} Purpose=${purpose} — RESEND_API_KEY missing, checked aliases`)
    return { success: true, id: 'mock-id', source: 'stub', error: 'RESEND_API_KEY missing' }
  }

  try {
    const subject = getSubject(env, dateTime)
    const html = buildConfirmationEmail({ firstName, lastName, email: to, meetLink, cancelUrl, dateTime, purpose, env })
    console.log(`!!! EMAIL_BUILD_SUBJECT subject=${subject} from=${from}`)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
      }),
    })

    console.log(`!!! EMAIL_FETCH_RESPONSE status=${res.status} ok=${res.ok}`)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const msg = `Resend failed ${res.status} ${text}`
      console.log(`!!! EMAIL_FAILED ${msg} To=${to} From=${from} Env=${env?.ENVIRONMENT}`)
      console.error(`[Email live FAILED] ${msg} — To: ${to}, From: ${from}, Env: ${env?.ENVIRONMENT}`)
      // For Resend test mode onboarding@resend.dev only to verified email, this will be 403
      // Return error but mark success false for diagnostics, caller will include emailError
      return { success: false, id: undefined, source: 'live', error: msg }
    }

    const json = (await res.json()) as any
    console.log(`!!! EMAIL_SUCCESS To=${to} Id=${json.id} Env=${env?.ENVIRONMENT} from=${from}`)
    return { success: true, id: json.id, source: 'live' }
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.log(`!!! EMAIL_EXCEPTION Error=${errMsg} To=${to} Meet=${meetLink} Env=${env?.ENVIRONMENT}`)
    console.error(`[Email exception] Error: ${errMsg}, To: ${to}, Meet: ${meetLink}, Env: ${env?.ENVIRONMENT}`)
    // In local/test, fallback to stub success for resilience; in alpha/prod, return live error so caller can surface
    if (env?.ENVIRONMENT === 'local' || env?.ENVIRONMENT === 'test') {
      return { success: true, id: 'mock-id-fallback', source: 'stub', error: errMsg }
    }
    return { success: false, source: 'live', error: errMsg }
  }
}
