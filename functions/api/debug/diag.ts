import { getEnvironment, getBookingCalendarId, getPersonalCalendarId, getGcalServiceKey, getResendApiKey, getTurnstileSecret, getOAuthClientId, getOAuthClientSecret, getOAuthRefreshToken, hasOAuthConfig, getMaxBookingsPerWeek, isBookingLimitEnabled } from '../../_lib/env'
import { getDiagInfo } from '../../_lib/google-calendar'

export interface Env {
  ENVIRONMENT?: string
  SITE_URL?: string
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  BOOKING_CALENDAR?: string
  PERSONAL_CALENDAR_ID?: string
  PERSONAL?: string
  PERSONAL_CALENDAR?: string
  GCAL_SERVICE_ACCOUNT_KEY?: string
  GOOGLE_SERVICE_ACCOUNT_KEY?: string
  RESEND_API_KEY?: string
  RESEND_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_SECRET?: string
  TURNSTILE_SITE_KEY?: string
  EMAIL_FROM?: string
  FROM?: string
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REFRESH_TOKEN?: string
  OAUTH_CLIENT_ID?: string
  OAUTH_CLIENT_SECRET?: string
  OAUTH_REFRESH_TOKEN?: string
  [key: string]: any
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const envName = getEnvironment(env as any)

  // Only detailed booleans, no secret values leaked
  const diag = getDiagInfo(env)

  const details = {
    env: envName,
    timestamp: new Date().toISOString(),
    calendars: {
      bookingConfigured: !!getBookingCalendarId(env),
      personalConfigured: !!getPersonalCalendarId(env),
      bookingAliasesChecked: ['BOOKING_CALENDAR_ID', 'BOOKING', 'BOOKING_CALENDAR'],
      personalAliasesChecked: ['PERSONAL_CALENDAR_ID', 'PERSONAL', 'PERSONAL_CALENDAR'],
      // Show which alias is actually present (boolean only)
      bookingPresentVia: {
        BOOKING_CALENDAR_ID: !!(env as any)?.BOOKING_CALENDAR_ID,
        BOOKING: !!(env as any)?.BOOKING,
        BOOKING_CALENDAR: !!(env as any)?.BOOKING_CALENDAR,
      },
      personalPresentVia: {
        PERSONAL_CALENDAR_ID: !!(env as any)?.PERSONAL_CALENDAR_ID,
        PERSONAL: !!(env as any)?.PERSONAL,
        PERSONAL_CALENDAR: !!(env as any)?.PERSONAL_CALENDAR,
      },
    },
    gcal: {
      keyConfigured: !!getGcalServiceKey(env),
      aliasesChecked: ['GCAL_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'SERVICE_ACCOUNT_KEY'],
      presentVia: {
        GCAL_SERVICE_ACCOUNT_KEY: !!(env as any)?.GCAL_SERVICE_ACCOUNT_KEY,
        GOOGLE_SERVICE_ACCOUNT_KEY: !!(env as any)?.GOOGLE_SERVICE_ACCOUNT_KEY,
        SERVICE_ACCOUNT_KEY: !!(env as any)?.SERVICE_ACCOUNT_KEY,
      },
      // If key present, check if private_key looks valid (boolean only)
      keyHasPrivateKey: (() => {
        try {
          const raw = getGcalServiceKey(env)
          if (!raw) return false
          const json = JSON.parse(raw)
          return !!json.private_key && !!json.client_email
        } catch {
          return false
        }
      })(),
    },
    email: {
      resendKeyConfigured: !!getResendApiKey(env),
      aliasesChecked: ['RESEND_API_KEY', 'RESEND_KEY'],
      presentVia: {
        RESEND_API_KEY: !!(env as any)?.RESEND_API_KEY,
        RESEND_KEY: !!(env as any)?.RESEND_KEY,
      },
      fromConfigured: !!(env as any)?.EMAIL_FROM || !!(env as any)?.FROM,
      fromValue: (env as any)?.EMAIL_FROM || (env as any)?.FROM || 'onboarding@resend.dev (fallback)',
    },
    turnstile: {
      secretConfigured: !!getTurnstileSecret(env),
      siteKeyConfigured: !!(env as any)?.TURNSTILE_SITE_KEY,
      aliasesChecked: ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SECRET'],
      presentVia: {
        TURNSTILE_SECRET_KEY: !!(env as any)?.TURNSTILE_SECRET_KEY,
        TURNSTILE_SECRET: !!(env as any)?.TURNSTILE_SECRET,
      },
    },
    oauth: {
      clientIdConfigured: !!getOAuthClientId(env),
      clientSecretConfigured: !!getOAuthClientSecret(env),
      refreshTokenConfigured: !!getOAuthRefreshToken(env),
      hasFullConfig: hasOAuthConfig(env),
      aliasesChecked: {
        clientId: ['GOOGLE_OAUTH_CLIENT_ID', 'OAUTH_CLIENT_ID'],
        clientSecret: ['GOOGLE_OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_SECRET'],
        refreshToken: ['GOOGLE_OAUTH_REFRESH_TOKEN', 'OAUTH_REFRESH_TOKEN'],
      },
      presentVia: {
        GOOGLE_OAUTH_CLIENT_ID: !!(env as any)?.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: !!(env as any)?.GOOGLE_OAUTH_CLIENT_SECRET,
        GOOGLE_OAUTH_REFRESH_TOKEN: !!(env as any)?.GOOGLE_OAUTH_REFRESH_TOKEN,
      },
    },
    bookingLimit: {
      maxPerWeek: getMaxBookingsPerWeek(env),
      enabled: isBookingLimitEnabled(env),
      rawMax: (env as any)?.BOOKING_MAX_PER_WEEK || (env as any)?.MAX_BOOKINGS_PER_WEEK || 'not-set (default 3)',
      rawEnabled: (env as any)?.BOOKING_LIMIT_ENABLED || 'not-set (auto from max>0)',
      howToDisable: 'Set BOOKING_MAX_PER_WEEK=0 or BOOKING_LIMIT_ENABLED=false in .dev.vars (local) or Encrypted Secrets Preview/Prod (Cloudflare Dashboard) to turn off max per week',
    },
    site: {
      siteUrl: env?.SITE_URL || 'not-set',
    },
    diag,
    guidance: {
      fakeMeetLinkReasons: [
        'BOOKING_CALENDAR_ID missing — check Dashboard Preview secrets BOOKING_CALENDAR_ID or BOOKING',
        'GCAL_SERVICE_ACCOUNT_KEY missing or invalid JSON — check secret JSON whole file',
        'Calendar permission not Make changes and see all event details — Share booking calendar with SA as Make changes and see all event details (not free/busy)',
        'ENVIRONMENT still local/test or STUB=true — should be alpha in alpha env',
        'Google API returns 403/404 — event creation failed, check calendar ID exists and SA shared',
        'SA cannot invite attendees without DWD — code retries without attendees (personal Gmail cannot DWD)',
        'SA on group calendars fails Invalid conference type value — group calendars via SA may not support hangoutsMeet — code retries bare event, real Meet requires OAuth',
      ],
      emailNotSentReasons: [
        'RESEND_API_KEY missing — add as Encrypted Secret Preview+Production',
        'FROM onboarding@resend.dev test mode only to your own verified email metagtmtest1@gmail.com — booking with other email fails 403',
        'Need custom domain verified in Resend then FROM bookings@yourdomain.com to email any visitor',
        'Resend quota 100/day exceeded',
      ],
      oauthGuidance: {
        whenNeeded: 'To get real Meet links on group calendars with personal Gmail (no Workspace DWD), use OAuth user flow — SA alone cannot create Meet',
        how: 'Create OAuth client ID (Web app) with redirect https://developers.google.com/oauthplayground, get refresh token via playground with calendar scopes, store GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN as Encrypted Secrets Preview+Prod and in .dev.vars (gitignored)',
        check: '/api/debug/diag → oauth.hasFullConfig should be true',
      },
    },
  }

  return new Response(JSON.stringify(details, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
