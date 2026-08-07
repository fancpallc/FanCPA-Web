import { describe, it, expect } from 'vitest'
import { onRequestGet } from './auth'

// Same helpers as auth.test.ts
function base64UrlEncode(obj: any): string {
  const json = JSON.stringify(obj)
  const b64 = Buffer.from(json).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeMockAccessJwt(email: string, extra: any = {}) {
  const header = { alg: 'RS256', kid: 'test-kid' }
  const payload = {
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...extra,
  }
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.mock-sig`
}

function mockRequest(headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v
  }
  return {
    headers: {
      get: (name: string) => lower[name.toLowerCase()] || null,
    },
  } as any
}

describe('GET /api/admin/auth', () => {
  it('returns 200 with bypass=true when ENVIRONMENT=local (dev convenience)', async () => {
    const request = mockRequest({})
    const env: any = { ENVIRONMENT: 'local' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authed).toBe(true)
    expect(json.bypass).toBe(true)
  })

  it('returns 200 with bypass=true when ADMIN_BYPASS=true', async () => {
    const request = mockRequest({})
    const env: any = { ENVIRONMENT: 'production', ADMIN_BYPASS: 'true' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authed).toBe(true)
    expect(json.bypass).toBe(true)
  })

  it('returns 401 when no CF headers and production env', async () => {
    const request = mockRequest({})
    const env: any = { ENVIRONMENT: 'production' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(401)
    const json = (await res.json()) as any
    expect(json.authed).toBeFalsy()
  })

  it('returns 200 with email when valid JWT present', async () => {
    const token = makeMockAccessJwt('admin@example.com')
    const request = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authed).toBe(true)
    expect(json.email).toBe('admin@example.com')
  })

  it('returns 200 with explicit email header', async () => {
    const request = mockRequest({ 'Cf-Access-Authenticated-User-Email': 'owner@company.com' })
    const env: any = { ENVIRONMENT: 'production' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.email).toBe('owner@company.com')
  })

  it('returns 403 when email not in allowlist', async () => {
    const token = makeMockAccessJwt('hacker@evil.com')
    const request = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(403)
    const json = (await res.json()) as any
    expect(json.authed).toBe(false)
  })

  it('returns 200 when email IS in allowlist', async () => {
    const token = makeMockAccessJwt('admin@example.com')
    const request = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com, owner@company.com' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authed).toBe(true)
    expect(json.email).toBe('admin@example.com')
  })

  it('returns 401 when JWT expired', async () => {
    const expired = makeMockAccessJwt('admin@example.com', { exp: Math.floor(Date.now() / 1000) - 3600 })
    const request = mockRequest({ 'Cf-Access-Jwt-Assertion': expired })
    const env: any = { ENVIRONMENT: 'production' }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(401)
  })

  it('returns no PII leak — does not expose allowlist in response', async () => {
    const token = makeMockAccessJwt('hacker@evil.com')
    const request = mockRequest({ 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'secret-admin@company.com' }
    const res = await onRequestGet({ request, env } as any)
    const text = await res.text()
    expect(text).not.toContain('secret-admin@company.com')
  })
})
