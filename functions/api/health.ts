import { checkD1, type D1Like } from '../_lib/db'
import { checkR2, type R2Like } from '../_lib/r2'
import { getEnvironment, type EnvVars, getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey, getResendApiKey, getTurnstileSecret } from '../_lib/env'

export interface Env {
  DB?: D1Like
  R2_BUCKET?: R2Like
  ENVIRONMENT?: string
  SITE_URL?: string
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  PERSONAL_CALENDAR_ID?: string
  PERSONAL?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  RESEND_API_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_SITE_KEY?: string
  [key: string]: any
}

interface HealthResponse {
  status: 'ok' | 'error' | 'degraded'
  db: 'ok' | 'error'
  r2: 'ok' | 'error'
  timestamp: string
  env: string
  checks: {
    d1Ms: number
    r2Ms: number
  }
  dbError?: string
  r2Error?: string
  sampleImageUrl?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const timestamp = new Date().toISOString()
  const envName = getEnvironment(env as EnvVars)
  const siteUrl = (env as any)?.SITE_URL || ''

  // Both D1 and R2 required for all envs (alpha = alpha D1+R2, prod = prod D1+R2)
  // R2 now enabled — must be checked for both preview (alpha) and production (prod)
  const [d1Result, r2Result] = await Promise.all([checkD1(env?.DB), checkR2(env?.R2_BUCKET)])

  const dbStatus = d1Result.ok ? 'ok' : 'error'
  const r2Status = r2Result.ok ? 'ok' : 'error'

  let status: HealthResponse['status'] = 'ok'
  if (!d1Result.ok || !r2Result.ok) {
    status = 'error'
  }

  const sampleImageUrl = r2Result.ok
    ? `${siteUrl || ''}/r2-sample/test-image.jpg`.replace(/\/\//g, '/').replace(':/', '://')
    : `https://via.placeholder.com/300x200?text=R2+${r2Status}`

  const response: HealthResponse & any = {
    status,
    db: dbStatus as any,
    r2: r2Status as any,
    timestamp,
    env: envName,
    checks: {
      d1Ms: d1Result.ms,
      r2Ms: r2Result.ms,
    },
    sampleImageUrl,
    // Diagnostics for booking calendar/email — booleans only, no PII leaked
    diagnostics: {
      bookingCalendar: !!getBookingCalendarId(env),
      personalCalendar: !!getPersonalCalendarId(env),
      gcalKey: !!getGcalServiceKey(env),
      resendKey: !!getResendApiKey(env),
      turnstileSecret: !!getTurnstileSecret(env),
      turnstileSiteKey: !!(env as any)?.TURNSTILE_SITE_KEY,
    },
  }

  if (!d1Result.ok) response.dbError = d1Result.error
  if (!r2Result.ok) response.r2Error = r2Result.error

  const httpStatus = status === 'ok' ? 200 : 500

  return new Response(JSON.stringify(response), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
