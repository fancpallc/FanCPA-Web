/**
 * Admin auth via Cloudflare Zero Trust — Google login only, no username/password.
 * Only allowlisted emails (ADMIN_EMAILS) can access admin routes.
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
    return Boolean(raw)
  }
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
  if (!allowlist || allowlist.length === 0) return true
  const lower = email.trim().toLowerCase()
  return allowlist.includes(lower)
}

function base64UrlDecode(input: string): string | null {
  try {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) {
      b64 += '='.repeat(4 - pad)
    }
    if (typeof atob === 'function') {
      return atob(b64)
    } else if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf-8')
    }
    return null
  } catch {
    return null
  }
}

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
        return null
      }
    }
    return payload
  } catch {
    return null
  }
}

export function getEmailFromHeaders(headers: any): string | null {
  if (!headers) return null

  const get = (name: string): string | null => {
    try {
      if (typeof headers.get === 'function') {
        const v = headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase())
        return v ? String(v).trim() : null
      }
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

  const explicitEmail = get('Cf-Access-Authenticated-User-Email') || get('cf-access-authenticated-user-email')
  if (explicitEmail && explicitEmail.includes('@')) {
    return explicitEmail.toLowerCase()
  }

  const jwt =
    get('Cf-Access-Jwt-Assertion') ||
    get('cf-access-jwt-assertion') ||
    get('CF-Access-Jwt-Assertion')
  if (jwt) {
    const payload = parseAccessJwt(jwt, true)
    if (payload?.email && typeof payload.email === 'string') {
      return String(payload.email).toLowerCase().trim()
    }
    return null
  }

  return null
}

export function isAdminAuthenticated(request: any, env: any): AuthResult {
  const headers = request?.headers
  const keys = headers && typeof headers.keys === 'function' ? Array.from(headers.keys()) : (headers ? Object.keys(headers) : [])
  console.log('!!! ADMIN_AUTH_DEBUG_START headers_keys=' + keys.join(','))

  if (isAdminBypass(env)) {
    return {
      authed: true,
      email: 'bypass@local',
      bypass: true,
    }
  }

  const headers = request?.headers
  if (!headers) {
    return {
      authed: false,
      error: 'Missing headers — no Cloudflare Access context',
    }
  }

  const get = (n: string) => typeof headers.get === 'function' ? headers.get(n) || headers.get(n.toLowerCase()) : (headers as any)[n] || (headers as any)[n.toLowerCase()]
  const rawJwt = get('Cf-Access-Jwt-Assertion') || null

  const email = getEmailFromHeaders(headers)
  console.log('!!! ADMIN_AUTH_DEBUG_EMAIL email=' + email)

  if (!email) {
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

  const allowlist = getAdminAllowlist(env)
  console.log('!!! ADMIN_AUTH_DEBUG_ALLOWLIST count=' + allowlist.length + ' allowed=' + isEmailAllowed(email, allowlist))
  if (!isEmailAllowed(email, allowlist)) {
    return {
      authed: false,
      email,
      error: `Email ${email} not allowed — not in ADMIN_EMAILS allowlist`,
    }
  }

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
