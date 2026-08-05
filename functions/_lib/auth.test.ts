import { describe, it, expect } from 'vitest'
import {
  isAdminBypass,
  parseAccessJwt,
  getEmailFromHeaders,
  isAdminAuthenticated,
  getAdminAllowlist,
  isEmailAllowed,
} from './auth'

// Helper to build mock JWT: header.payload.signature where payload is base64url JSON
function base64UrlEncode(obj: any): string {
  const json = JSON.stringify(obj)
  const b64 = Buffer.from(json).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeMockAccessJwt(email: string, extra: any = {}) {
  const header = { alg: 'RS256', kid: 'test-kid' }
  const payload = {
    email,
    aud: ['test-aud'],
    exp: Math.floor(Date.now() / 1000) + 3600, // 1h from now
    iat: Math.floor(Date.now() / 1000),
    ...extra,
  }
  const headerB64 = base64UrlEncode(header)
  const payloadB64 = base64UrlEncode(payload)
  const sig = 'mock-signature'
  return `${headerB64}.${payloadB64}.${sig}`
}

function makeExpiredJwt(email: string) {
  return makeMockAccessJwt(email, { exp: Math.floor(Date.now() / 1000) - 3600 })
}

function mockHeaders(obj: Record<string, string>) {
  // Simple headers mock that supports get() case-insensitive
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    lower[k.toLowerCase()] = v
  }
  return {
    get: (name: string) => lower[name.toLowerCase()] || null,
  } as any
}

function mockRequest(headers: Record<string, string>) {
  return {
    headers: mockHeaders(headers),
  } as any
}

describe('functions/_lib/auth.ts — Cloudflare Access Google Login', () => {
  describe('isAdminBypass', () => {
    it('returns true when ADMIN_BYPASS=true', () => {
      expect(isAdminBypass({ ADMIN_BYPASS: 'true' })).toBe(true)
    })

    it('returns true when ADMIN_BYPASS=1', () => {
      expect(isAdminBypass({ ADMIN_BYPASS: '1' })).toBe(true)
    })

    it('returns true when ENVIRONMENT=local even if ADMIN_BYPASS not set (dev convenience)', () => {
      // local env should allow bypass by default for TDD/Docker
      expect(isAdminBypass({ ENVIRONMENT: 'local' })).toBe(true)
    })

    it('returns true when ENVIRONMENT=test', () => {
      expect(isAdminBypass({ ENVIRONMENT: 'test' })).toBe(true)
    })

    it('returns false when ENVIRONMENT=production and no bypass flag', () => {
      expect(isAdminBypass({ ENVIRONMENT: 'production' })).toBe(false)
    })

    it('returns false when ADMIN_BYPASS=false explicitly even in local', () => {
      expect(isAdminBypass({ ENVIRONMENT: 'local', ADMIN_BYPASS: 'false' })).toBe(false)
    })

    it('returns false when ENVIRONMENT=alpha and no bypass', () => {
      expect(isAdminBypass({ ENVIRONMENT: 'alpha' })).toBe(false)
    })
  })

  describe('getAdminAllowlist', () => {
    it('parses comma-separated ADMIN_EMAILS', () => {
      const list = getAdminAllowlist({ ADMIN_EMAILS: 'admin@example.com, other@domain.com ' })
      expect(list).toEqual(['admin@example.com', 'other@domain.com'])
    })

    it('returns empty array when ADMIN_EMAILS not set', () => {
      expect(getAdminAllowlist({})).toEqual([])
    })

    it('lowercases emails for case-insensitive compare', () => {
      const list = getAdminAllowlist({ ADMIN_EMAILS: 'Admin@Example.COM' })
      expect(list).toEqual(['admin@example.com'])
    })

    it('supports ADMIN_EMAIL alias', () => {
      const list = getAdminAllowlist({ ADMIN_EMAIL: 'single@test.com' })
      expect(list).toEqual(['single@test.com'])
    })
  })

  describe('isEmailAllowed', () => {
    it('allows any email when allowlist empty (open when no restriction)', () => {
      expect(isEmailAllowed('anyone@example.com', [])).toBe(true)
    })

    it('allows email present in allowlist case-insensitive', () => {
      expect(isEmailAllowed('Admin@Example.com', ['admin@example.com'])).toBe(true)
    })

    it('denies email not in allowlist when list non-empty', () => {
      expect(isEmailAllowed('hacker@evil.com', ['admin@example.com'])).toBe(false)
    })
  })

  describe('parseAccessJwt', () => {
    it('parses valid mock JWT and extracts email', () => {
      const token = makeMockAccessJwt('admin@example.com')
      const payload = parseAccessJwt(token)
      expect(payload?.email).toBe('admin@example.com')
    })

    it('returns null for malformed JWT (missing parts)', () => {
      expect(parseAccessJwt('not.a.jwt')).toBeNull()
      expect(parseAccessJwt('onlyone')).toBeNull()
      expect(parseAccessJwt('')).toBeNull()
    })

    it('returns null for invalid base64 payload', () => {
      expect(parseAccessJwt('a.!!!invalid!!!.c')).toBeNull()
    })

    it('returns null for expired token when checkExp true (default)', () => {
      const token = makeExpiredJwt('admin@example.com')
      const payload = parseAccessJwt(token, true)
      expect(payload).toBeNull() // expired -> null when checkExp
    })

    it('returns payload even if expired when checkExp false', () => {
      const token = makeExpiredJwt('admin@example.com')
      const payload = parseAccessJwt(token, false)
      expect(payload?.email).toBe('admin@example.com')
    })
  })

  describe('getEmailFromHeaders', () => {
    it('extracts email from Cf-Access-Authenticated-User-Email header directly', () => {
      const headers = mockHeaders({
        'Cf-Access-Authenticated-User-Email': 'admin@example.com',
      })
      expect(getEmailFromHeaders(headers)).toBe('admin@example.com')
    })

    it('extracts email from Cf-Access-Jwt-Assertion JWT header', () => {
      const token = makeMockAccessJwt('jwtuser@example.com')
      const headers = mockHeaders({
        'Cf-Access-Jwt-Assertion': token,
      })
      expect(getEmailFromHeaders(headers)).toBe('jwtuser@example.com')
    })

    it('prefers explicit email header over JWT when both present', () => {
      const token = makeMockAccessJwt('jwtuser@example.com')
      const headers = mockHeaders({
        'Cf-Access-Authenticated-User-Email': 'explicit@example.com',
        'Cf-Access-Jwt-Assertion': token,
      })
      expect(getEmailFromHeaders(headers)).toBe('explicit@example.com')
    })

    it('returns null when no relevant headers', () => {
      const headers = mockHeaders({})
      expect(getEmailFromHeaders(headers)).toBeNull()
    })

    it('handles lowercase header names (case-insensitive)', () => {
      const token = makeMockAccessJwt('lower@example.com')
      const headers = mockHeaders({
        'cf-access-jwt-assertion': token,
      })
      expect(getEmailFromHeaders(headers)).toBe('lower@example.com')
    })
  })

  describe('isAdminAuthenticated — main entry', () => {
    it('allows when ADMIN_BYPASS=true even without headers', () => {
      const req = mockRequest({})
      const env = { ADMIN_BYPASS: 'true', ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(true)
      expect(result.bypass).toBe(true)
    })

    it('allows when ENVIRONMENT=local (dev bypass) even without headers', () => {
      const req = mockRequest({})
      const env = { ENVIRONMENT: 'local' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(true)
      expect(result.bypass).toBe(true)
    })

    it('denies when no bypass and no CF headers in production', () => {
      const req = mockRequest({})
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(false)
      expect(result.error).toMatch(/Missing/i)
    })

    it('allows with valid JWT header in production', () => {
      const token = makeMockAccessJwt('admin@example.com')
      const req = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(true)
      expect(result.email).toBe('admin@example.com')
      expect(result.bypass).toBeFalsy()
    })

    it('allows with explicit email header in production', () => {
      const req = mockRequest({ 'Cf-Access-Authenticated-User-Email': 'admin@example.com' })
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(true)
      expect(result.email).toBe('admin@example.com')
    })

    it('denies when email not in ADMIN_EMAILS allowlist', () => {
      const token = makeMockAccessJwt('hacker@evil.com')
      const req = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
      const env = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com, owner@company.com' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(false)
      expect(result.error).toMatch(/not allowed|allowlist/i)
    })

    it('allows when email IS in ADMIN_EMAILS allowlist', () => {
      const token = makeMockAccessJwt('admin@example.com')
      const req = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
      const env = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com, owner@company.com' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(true)
      expect(result.email).toBe('admin@example.com')
    })

    it('denies expired JWT', () => {
      const token = makeExpiredJwt('admin@example.com')
      const req = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(false)
      expect(result.error).toMatch(/expired/i)
    })

    it('denies invalid JWT format', () => {
      const req = mockRequest({ 'Cf-Access-Jwt-Assertion': 'invalid.token.here' })
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.authed).toBe(false)
    })

    it('returns email lowercased', () => {
      const req = mockRequest({ 'Cf-Access-Authenticated-User-Email': 'Admin@Example.COM' })
      const env = { ENVIRONMENT: 'production' }
      const result = isAdminAuthenticated(req, env)
      expect(result.email).toBe('admin@example.com')
    })
  })
})
