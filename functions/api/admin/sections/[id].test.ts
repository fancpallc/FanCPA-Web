import { describe, it, expect, vi, beforeEach } from 'vitest'

function base64UrlEncode(obj: any): string {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function makeMockJwt(email: string) {
  const header = { alg: 'RS256', kid: 'test' }
  const payload = { email, exp: Math.floor(Date.now() / 1000) + 3600 }
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig`
}
function mockRequest(method: string, url: string, body: any, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    method,
    url,
    headers: { get: (n: string) => lower[n.toLowerCase()] || null },
    json: async () => body,
  } as any
}

describe('PUT /api/admin/sections/:id', () => {
  let mockD1: any
  let mockSections = [
    { id: 'sec1', page_id: 'page1', type: 'hero', heading: 'Welcome', subheading: 'Sub', sort_order: 0, config: '{}', is_visible: 1 },
  ]

  beforeEach(() => {
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM sections') && sql.includes('WHERE id')) {
            const id = args[0]
            return mockSections.find((s) => s.id === id) || null
          }
          return null
        },
        run: async () => {
          // Update mock
          if (sql.includes('UPDATE sections')) {
            const id = args[args.length - 1]
            const sec = mockSections.find((s) => s.id === id)
            if (sec) {
              // Simulate update heading etc from args - args order: heading, subheading, sort_order, is_visible, config, id
              if (args.length >= 2) sec.heading = args[0] ?? sec.heading
              if (args.length >= 3) sec.subheading = args[1] ?? sec.subheading
              if (args.length >= 4) sec.sort_order = args[2] ?? sec.sort_order
              if (args.length >= 5) sec.is_visible = args[3] ?? sec.is_visible
              if (args.length >= 6) sec.config = args[4] ?? sec.config
            }
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true }
        },
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    })

    mockD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => makeStmt(sql)),
    }
  })

  it('returns 401 when no auth', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/sections/sec1', { heading: 'New' })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'sec1' } } as any)
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown id', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/sections/unknown', { heading: 'New' })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'unknown' } } as any)
    expect(res.status).toBe(404)
  })

  it('returns 400 when body empty', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/sections/sec1', {})
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'sec1' } } as any)
    expect(res.status).toBe(400)
  })

  it('updates heading and returns updated section', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/sections/sec1', { heading: 'Updated Heading', subheading: 'New Sub' })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'sec1' } } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.id).toBe('sec1')
    expect(json.heading).toBe('Updated Heading')
  })

  it('allows valid JWT in production', async () => {
    const token = makeMockJwt('admin@example.com')
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/sections/sec1', { heading: 'Prod Update' }, { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'sec1' } } as any)
    expect(res.status).toBe(200)
  })
})
