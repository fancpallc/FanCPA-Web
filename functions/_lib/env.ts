export type EnvironmentName = 'production' | 'preview' | 'alpha' | 'local' | 'test'

export interface EnvVars {
  ENVIRONMENT?: string
  SITE_URL?: string
  [key: string]: any
}

const BOOKING_ALIASES = [
  'BOOKING_CALENDAR_ID',
  'BOOKING',
  'BOOKING_CALENDAR',
  'CALENDAR_ID',
  'GCAL_BOOKING_CALENDAR_ID',
]

const PERSONAL_ALIASES = [
  'PERSONAL_CALENDAR_ID',
  'PERSONAL',
  'PERSONAL_CALENDAR',
  'GCAL_PERSONAL_CALENDAR_ID',
]

const GCAL_KEY_ALIASES = [
  'GCAL_SERVICE_ACCOUNT_KEY',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'SERVICE_ACCOUNT_KEY',
  'GCAL_KEY',
]

const RESEND_KEY_ALIASES = [
  'RESEND_API_KEY',
  'RESEND_KEY',
  'EMAIL_API_KEY',
]

const TURNSTILE_SECRET_ALIASES = [
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_SECRET',
  'CF_TURNSTILE_SECRET',
]

const OAUTH_CLIENT_ID_ALIASES = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_ID',
  'GCAL_OAUTH_CLIENT_ID',
]

const OAUTH_CLIENT_SECRET_ALIASES = [
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'OAUTH_CLIENT_SECRET',
  'GCAL_OAUTH_CLIENT_SECRET',
]

const OAUTH_REFRESH_TOKEN_ALIASES = [
  'GOOGLE_OAUTH_REFRESH_TOKEN',
  'OAUTH_REFRESH_TOKEN',
  'GCAL_OAUTH_REFRESH_TOKEN',
]

const MAX_BOOKINGS_ALIASES = [
  'BOOKING_MAX_PER_WEEK',
  'MAX_BOOKINGS_PER_WEEK',
  'MAX_PER_WEEK',
  'BOOKING_LIMIT_MAX',
]

const BOOKING_LIMIT_ENABLED_ALIASES = [
  'BOOKING_LIMIT_ENABLED',
  'BOOKING_MAX_ENABLED',
  'MAX_BOOKINGS_ENABLED',
]

const ADMIN_BYPASS_ALIASES = ['ADMIN_BYPASS', 'ADMIN_BYPASS_ENABLED', 'BYPASS_ADMIN', 'ADMIN_BYPASS_FLAG']
const ADMIN_EMAILS_ALIASES = ['ADMIN_EMAILS', 'ADMIN_EMAIL', 'ALLOWED_EMAILS', 'ADMIN_ALLOWLIST', 'ADMIN_ALLOWED_EMAILS']

export function resolveEnvVar(env: any, aliases: string[]): string | undefined {
  if (!env) return undefined
  for (const key of aliases) {
    const val = env[key]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
    if (val && typeof val !== 'string') return String(val)
  }
  return undefined
}

export function getBookingCalendarId(env: any): string | undefined {
  return resolveEnvVar(env, BOOKING_ALIASES)
}

export function getPersonalCalendarId(env: any): string | undefined {
  return resolveEnvVar(env, PERSONAL_ALIASES)
}

export function getGcalServiceKey(env: any): string | undefined {
  return resolveEnvVar(env, GCAL_KEY_ALIASES)
}

export function getResendApiKey(env: any): string | undefined {
  return resolveEnvVar(env, RESEND_KEY_ALIASES)
}

export function getTurnstileSecret(env: any): string | undefined {
  return resolveEnvVar(env, TURNSTILE_SECRET_ALIASES)
}

export function getOAuthClientId(env: any): string | undefined {
  return resolveEnvVar(env, OAUTH_CLIENT_ID_ALIASES)
}

export function getOAuthClientSecret(env: any): string | undefined {
  return resolveEnvVar(env, OAUTH_CLIENT_SECRET_ALIASES)
}

export function getOAuthRefreshToken(env: any): string | undefined {
  return resolveEnvVar(env, OAUTH_REFRESH_TOKEN_ALIASES)
}

export function hasOAuthConfig(env: any): boolean {
  return !!getOAuthClientId(env) && !!getOAuthClientSecret(env) && !!getOAuthRefreshToken(env)
}

export function getMaxBookingsPerWeek(env: any): number {
  const raw = resolveEnvVar(env, MAX_BOOKINGS_ALIASES)
  if (!raw) return 3 // default 3 per week as existing behavior
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed)) {
    // allow "0" or "disabled" or "off" to disable
    const lower = raw.toLowerCase()
    if (lower === '0' || lower === 'disabled' || lower === 'off' || lower === 'false' || lower === 'no') return 0
    return 3
  }
  return parsed // 0 = disabled, negative = disabled, positive = limit
}

export function isBookingLimitEnabled(env: any): boolean {
  const raw = resolveEnvVar(env, BOOKING_LIMIT_ENABLED_ALIASES)
  if (raw === undefined) {
    // If MAX is 0, disabled
    return getMaxBookingsPerWeek(env) > 0
  }
  const lower = String(raw).toLowerCase()
  if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'disabled' || lower === 'no') return false
  if (lower === 'true' || lower === '1' || lower === 'on' || lower === 'enabled' || lower === 'yes') return true
  return true // default enabled when flag present but unparsable
}

export function getEnvironment(env?: EnvVars | null): EnvironmentName {
  if (!env || !env.ENVIRONMENT) {
    return 'production'
  }
  const raw = String(env.ENVIRONMENT).toLowerCase() as EnvironmentName
  const allowed: EnvironmentName[] = ['production', 'preview', 'alpha', 'local', 'test']
  if (allowed.includes(raw)) {
    return raw
  }
  return 'production'
}

export function isPreview(env: string | EnvironmentName): boolean {
  return env === 'preview'
}

export function isAlpha(env: string | EnvironmentName): boolean {
  return env === 'alpha'
}

export function isProduction(env: string | EnvironmentName): boolean {
  return env === 'production'
}

export function isLocal(env: string | EnvironmentName): boolean {
  return env === 'local' || env === 'test'
}

export function getAdminBypassRaw(env: any): string | undefined {
  return resolveEnvVar(env, ADMIN_BYPASS_ALIASES)
}

export function getAdminEmailsRaw(env: any): string | undefined {
  return resolveEnvVar(env, ADMIN_EMAILS_ALIASES)
}

export function isAdminBypassEnabled(env: any): boolean {
  const raw = getAdminBypassRaw(env)
  if (raw !== undefined) {
    const lower = String(raw).toLowerCase().trim()
    if (['true', '1', 'yes', 'on', 'enabled'].includes(lower)) return true
    if (['false', '0', 'no', 'off', 'disabled'].includes(lower)) return false
    return Boolean(raw)
  }
  const envName = getEnvironment(env as any)
  return envName === 'local' || envName === 'test'
}

export function getAdminAllowlistFromEnv(env: any): string[] {
  const raw = getAdminEmailsRaw(env)
  if (!raw) return []
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}
