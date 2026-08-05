/**
 * Admin auth via Cloudflare Zero Trust — Google login only, no username/password.
 * Only allowlisted emails (ADMIN_EMAILS) can access admin routes.
 *
 * Cloudflare Access flow:
 * - User hits https://.../admin/*  -> CF Zero Trust intercepts
 * - Google OAuth login required (configured in CF dashboard, not code)
 * - On success CF adds headers:
 *   - Cf-Access-Jwt-Assertion: JWT signed by CF (contains email, exp, aud...)
 *   - Cf-Access-Authenticated-User-Email: plain email (easier)
 * - Our Worker trusts these headers because they only come from CF edge when Access allowed.
 * - We still decode JWT cheaply (no JWKS fetch to stay free-tier <10ms CPU).
 *
 * Free tier safety:
 * - No network fetches (no JWKS), only base64 decode + JSON parse (<1ms CPU)
 * - No R2/D1 calls in auth path
 * - No loops over large arrays (allowlist max few emails)
 *
 * Bypass:
 * - ADMIN_BYPASS=true → allow all, for local dev / alpha preview without Access
 * - ENVIRONMENT=local|test → bypass by default unless ADMIN_BYPASS explicitly false
 *   (matches existing pattern: Turnstile/GCal STUB bypass in local)
 */

import { resolveEnvVar, getEnvironment } from './env'

const ADMIN_BYPASS_ALIASES = ['ADMIN_BYPASS', 'ADMIN_BYPASS_ENABLED', 'BYPASS_ADMIN', 'ADMIN_BYPASS_FLAG']
const ADMIN_EMAILS_ALIASES = ['ADMIN_EMAILS', 'ADMIN_EMAIL', 'ALLOWED_EMAILS', 'ADMIN_ALLOWLIST', 'ADMIN_ALLOWED_EMAILS']

export interface AuthResult {
  authed: boolean
  email?: string
  bypass?: boolean
  error?: string
  payload?: any
}

// ---------- Bypass logic ----------
export function isAdminBypass(env: any): boolean {
  const raw = resolveEnvVar(env, ADMIN_BYPASS_ALIASES)
  if (raw !== undefined) {
    const lower = String(raw).toLowerCase().trim()
    if (['true', '1', 'yes', 'on', 'enabled'].includes(lower)) return true
    if (['false', '0', 'no', 'off', 'disabled'].includes(lower)) return false
    // If unparseable but present non-empty, treat as true to avoid lockout confusion
    return Boolean(raw)
  }
  // No explicit flag: allow bypass for local/test (dev convenience, TDD, Docker)
  const envName = getEnvironment(env as any)
  if (envName === 'local' || envName === 'test') {
    return true
  }
  return false
}

// ---------- Allowlist ----------
export function getAdminAllowlist(env: any): string[] {
  const raw = resolveEnvVar(env, ADMIN_EMAILS_ALIASES)
  if (!raw) return []
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

export function isEmailAllowed(email: string, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true // open when no restriction
  const lower = email.trim().toLowerCase()
  return allowlist.includes(lower)
}

// ---------- JWT parsing — free-tier cheap, no crypto verify ----------
function base64UrlDecode(input: string): string | null {
  try {
    // Replace URL-safe chars
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/')
    // Pad to multiple of 4
    const pad = b64.length % 4
    if (pad) {
      b64 += '='.repeat(4 - pad)
    }
    // Workers have atob, Node has Buffer
    if (typeof atob === 'function') {
      // atob expects binary string, may throw
      return atob(b64)
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf-8')
    }
    return null
  } catch {
    return null
  }
}

/**
 * Parse Cloudflare Access JWT without signature verification (CF edge already verified signature).
 * Returns payload or null if malformed/expired when checkExp=true.
 * Free tier: only decode, no fetch.
 */
export function parseAccessJwt(token: string | undefined | null, checkExp: boolean = true): any | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  const payloadB64 = parts[1]
  if (!payloadB64) return null
  const jsonStr = base64UrlDecode(payloadB64)
  if (!jsonStr) return null
  try {
    const payload = JSON.parse(jsonStr)
    if (typeof payload !== 'object' || payload === null) return null
    if (checkExp && typeof payload.exp === 'number') {
      const nowSec = Math.floor(Date.now() / 1000)
      if (payload.exp < nowSec) {
        return null // expired
      }
    }
    return payload
  } catch {
    return null
  }
}

/**
 * Extract email from request headers.
 * Priority: Cf-Access-Authenticated-User-Email (plain) → Cf-Access-Jwt-Assertion (JWT decode)
 * Handles case-insensitive header names (fetch Headers.get is case-insensitive).
 */
export function getEmailFromHeaders(headers: any): string | null {
  if (!headers) return null

  const get = (name: string): string | null => {
    try {
      if (typeof headers.get === 'function') {
        // Fetch Headers API — already case-insensitive
        const v = headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase())
        return v ? String(v).trim() : null
      }
      // Plain object fallback
      const lowerName = name.toLowerCase()
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === lowerName) {
          const v = (headers as any)[k]
          return v ? String(v).trim() : null
        }
      }
      return null
    } catch {
      return null
    }
  }

  // 1. Explicit email header from Cloudflare Access — cheapest, most reliable
  const explicitEmail = get('Cf-Access-Authenticated-User-Email') || get('cf-access-authenticated-user-email')
  if (explicitEmail && explicitEmail.includes('@')) {
    return explicitEmail.toLowerCase()
  }

  // 2. JWT header — decode payload to get email
  const jwt =
    get('Cf-Access-Jwt-Assertion') ||
    get('cf-access-jwt-assertion') ||
    get('CF-Access-Jwt-Assertion')
  if (jwt) {
    const payload = parseAccessJwt(jwt, true)
    if (payload?.email && typeof payload.email === 'string') {
      return String(payload.email).toLowerCase().trim()
    }
    // Try without exp check for diagnosis — caller will handle expired case separately
    // But here for email extraction we prefer valid only; return null if expired handled upstream
    return null
  }

  return null
}

/**
 * Main entry: checks if request is from an authenticated admin.
 * Returns AuthResult with email, bypass flag, error reason.
 *
 * Logic:
 * 1. If ADMIN_BYPASS or ENVIRONMENT=local/test → authed, bypass true
 * 2. Else extract email from CF Access headers
 * 3. If missing → not authed
 * 4. Check exp via JWT parse (if JWT present)
 * 5. Check allowlist ADMIN_EMAILS if set → must be in list else 403-style error
 * 6. Else authed true
 */
export function isAdminAuthenticated(request: any, env: any): AuthResult {
  // Bypass path — local dev, Docker, CI, or explicit ADMIN_BYPASS=true
  if (isAdminBypass(env)) {
    return {
      authed: true,
      email: 'bypass@local',
      bypass: true,
    }
  }

  // Extract headers from request (supports Request or {headers} shape)
  const headers = request?.headers
  if (!headers) {
    return {
      authed: false,
      error: 'Missing headers — no Cloudflare Access context',
    }
  }

  const rawJwt =
    (typeof headers.get === 'function'
      ? headers.get('Cf-Access-Jwt-Assertion') || headers.get('cf-access-jwt-assertion')
      : (headers as any)['Cf-Access-Jwt-Assertion'] || (headers as any)['cf-access-jwt-assertion']) || null

  const email = getEmailFromHeaders(headers)

  if (!email) {
    // Diagnose expired vs missing
    if (rawJwt) {
      const payloadNoExpCheck = parseAccessJwt(rawJwt, false)
      if (payloadNoExpCheck?.exp) {
        const nowSec = Math.floor(Date.now() / 1000)
        if (typeof payloadNoExpCheck.exp === 'number' && payloadNoExpCheck.exp < nowSec) {
          return {
            authed: false,
            error: 'Access JWT expired — please re-login via Cloudflare Access',
            payload: payloadNoExpCheck,
          }
        }
      }
      return {
        authed: false,
        error: 'Invalid Access JWT — cannot extract email',
      }
    }
    return {
      authed: false,
      error: 'Missing Cloudflare Access JWT — login required via Google',
    }
  }

  // Allowlist check — only few recognized emails can login as admin
  const allowlist = getAdminAllowlist(env)
  if (!isEmailAllowed(email, allowlist)) {
    return {
      authed: false,
      email,
      error: `Email ${email} not allowed — not in ADMIN_EMAILS allowlist`,
    }
  }

  // Final payload for debugging if JWT present
  let payload: any = undefined
  if (rawJwt) {
    payload = parseAccessJwt(rawJwt, false) || undefined
  }

  return {
    authed: true,
    email,
    bypass: false,
    payload,
  }
}

/**
 * Helper for Pages Functions: returns 401/403 Response if not authed, else null (continue).
 * Usage:
 *   const authRes = requireAdminAuth(request, env)
 *   if (authRes) return authRes
 */
export function requireAdminAuth(request: any, env: any): Response | null {
  const result = isAdminAuthenticated(request, env)
  if (result.authed) return null

  const isForbidden = result.error?.toLowerCase().includes('not allowed') || result.error?.toLowerCase().includes('allowlist')
  const status = isForbidden ? 403 : 401

  return new Response(
    JSON.stringify({
      error: status === 401 ? 'Unauthorized — admin login required' : 'Forbidden — email not authorized as admin',
      details: result.error,
      email: result.email,
      // Do NOT leak allowlist
      guidance:
        status === 401
          ? 'Login via Cloudflare Zero Trust Google OAuth at /admin — or set ADMIN_BYPASS=true for local dev'
          : 'Your email is not in ADMIN_EMAILS allowlist — contact owner to add your email',
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
}
