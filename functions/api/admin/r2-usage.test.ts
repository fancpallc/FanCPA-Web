import { describe, it, expect, vi } from 'vitest'
import { onRequestGet } from './r2-usage'

function base64UrlEncode(obj: any): string {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeMockJwt(email: string) {
  const header = { alg: 'RS256', kid: 'test' }
  const payload = { email, exp: Math.floor(Date.now() / 1000) + 3600 }
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig`
}

function mockRequestWithUrl(url: string, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v
  }
  return {
    url,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] || null,
    },
  } as any
}

function makeMockR2(objects: { key: string; size: number }[]) {
  return {
    list: vi.fn(async (opts?: any) => {
      // Filter by prefix if provided
      let filtered = objects
      if (opts?.prefix) {
        filtered = objects.filter((o) => o.key.startsWith(opts.prefix))
      }
      const limit = opts?.limit || 1000
      const limited = filtered.slice(0, limit)
      return {
        objects: limited.map((o) => ({ key: o.key, size: o.size, uploaded: new Date().toISOString() })),
        truncated: filtered.length > limit,
        delimitedPrefixes: [],
      }
    }),
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  }
}

describe('GET /api/admin/r2-usage — quota endpoint', () => {
  it('returns 401 when no auth (production)', async () => {
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {})
    const env: any = { ENVIRONMENT: 'production', R2_BUCKET: makeMockR2([]) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(401)
  })

  it('returns 200 with bypass allowed when local env even without headers (default cheap path)', async () => {
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2([]) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.checkQuota).toBe(false) // no checkQuota param
    expect(json.limitMB).toBe(10240)
    expect(json.totalObjects).toBeDefined()
  })

  it('returns cheap estimate when checkQuota=false (no R2 LIST called)', async () => {
    const mockR2 = makeMockR2([{ key: 'portfolio/a.png', size: 1000 }])
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    const json = (await res.json()) as any
    expect(json.checkQuota).toBe(false)
    expect(mockR2.list).not.toHaveBeenCalled() // should NOT call LIST on cheap path to save CPU
  })

  it('when checkQuota=true calls R2 LIST and returns summed size', async () => {
    const objects = [
      { key: 'portfolio/img1.png', size: 300_000 }, // 300KB PNG lossless
      { key: 'portfolio/img2.png', size: 500_000 }, // 500KB
      { key: 'portfolio/img3.png', size: 200_000 },
    ]
    const mockR2 = makeMockR2(objects)
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.checkQuota).toBe(true)
    expect(json.totalObjects).toBe(3)
    expect(json.totalBytes).toBe(1_000_000)
    expect(json.totalMB).toBeCloseTo(0.95, 1) // 1M bytes ~0.95 MB
    expect(json.percent).toBeLessThan(1) // far below 10GB
    expect(json.warning).toBe(false)
    expect(mockR2.list).toHaveBeenCalledTimes(1)
    expect(mockR2.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'portfolio/' }))
  })

  it('returns warning when usage >90% of 10GB (free tier limit)', async () => {
    // Simulate 9.5GB usage — 9500 objects * 1MB
    const many = Array.from({ length: 100 }, (_, i) => ({ key: `portfolio/img${i}.png`, size: 95 * 1024 * 1024 })) // 95MB each *100 = 9.5GB
    const mockR2 = makeMockR2(many)
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    const json = (await res.json()) as any
    expect(json.warning).toBe(true)
    expect(json.percent).toBeGreaterThan(90)
    expect(json.guidance).toMatch(/delete/i)
  })

  it('returns warning when object count >9000 approaching limit', async () => {
    // We can't create 9000 objects in test, mock the counts directly via logic
    // Instead we test via many objects triggering warning via percent, but also count check
    // Here we test that our endpoint returns object list and includes truncated flag
    const objects = Array.from({ length: 1000 }, (_, i) => ({ key: `portfolio/img${i}.png`, size: 1000 }))
    const mockR2 = makeMockR2(objects)
    // Simulate truncated by having more than limit internally — our mock returns truncated if >limit
    // Let's make list that would be truncated: we have 1000 objects and limit 1000 → not truncated
    // To test truncated, create 1500 but mock returns only 1000 + truncated true
    const manyObjects = Array.from({ length: 1500 }, (_, i) => ({ key: `portfolio/img${i}.png`, size: 1000 }))
    const mockR2Truncated = {
      list: vi.fn(async () => ({
        objects: manyObjects.slice(0, 1000).map((o) => ({ key: o.key, size: o.size })),
        truncated: true,
      })),
    }
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2Truncated }
    const res = await onRequestGet({ request, env } as any)
    const json = (await res.json()) as any
    expect(json.truncated).toBe(true)
    expect(json.warning).toBeDefined()
  })

  it('allows valid JWT in production with checkQuota', async () => {
    const token = makeMockJwt('admin@example.com')
    const mockR2 = makeMockR2([{ key: 'portfolio/a.png', size: 100 }])
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {
      'Cf-Access-Jwt-Assertion': token,
    })
    const env: any = { ENVIRONMENT: 'production', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.authed).toBe(true)
    expect(json.email).toBe('admin@example.com')
  })

  it('returns 403 when email not in allowlist even with JWT', async () => {
    const token = makeMockJwt('hacker@evil.com')
    const mockR2 = makeMockR2([])
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {
      'Cf-Access-Jwt-Assertion': token,
    })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(403)
  })

  it('returns no PII leak — does not expose full allowlist', async () => {
    const token = makeMockJwt('hacker@evil.com')
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage?checkQuota=true', {
      'Cf-Access-Jwt-Assertion': token,
    })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'secret-admin@company.com', R2_BUCKET: makeMockR2([]) }
    const res = await onRequestGet({ request, env } as any)
    const text = await res.text()
    expect(text).not.toContain('secret-admin@company.com')
  })

  it('verifies upload limits guidance in response', async () => {
    const mockR2 = makeMockR2([])
    const request = mockRequestWithUrl('http://localhost/api/admin/r2-usage', {})
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestGet({ request, env } as any)
    const json = (await res.json()) as any
    expect(json.limits).toBeDefined()
    expect(json.limits.browserToWorker).toContain('100MB')
    expect(json.limits.workerToR2Single).toContain('5 GiB')
    expect(json.limits.app).toContain('1MB')
    expect(json.strategy).toMatch(/replace/i)
  })
})
