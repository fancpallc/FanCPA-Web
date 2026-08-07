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
function mockRequest(url: string, body: any, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    url,
    method: 'POST',
    headers: { get: (n: string) => lower[n.toLowerCase()] || null },
    json: async () => body,
  } as any
}

describe('POST /api/admin/sections/reorder', () => {
  let mockD1: any
  let mockSections = [
    { id: 'sec1', page_id: 'page1', sort_order: 0 },
    { id: 'sec2', page_id: 'page1', sort_order: 1 },
    { id: 'sec3', page_id: 'page1', sort_order: 2 },
  ]

  beforeEach(() => {
    mockSections = [
      { id: 'sec1', page_id: 'page1', sort_order: 0 },
      { id: 'sec2', page_id: 'page1', sort_order: 1 },
      { id: 'sec3', page_id: 'page1', sort_order: 2 },
    ]
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => null,
        all: async () => ({ results: mockSections }),
        run: async () => {
          if (sql.includes('UPDATE sections')) {
            const sort_order = args[0]
            const id = args[1]
            const sec = mockSections.find((s) => s.id === id)
            if (sec) sec.sort_order = sort_order
          }
          return { success: true }
        },
      }),
      first: async () => null,
      all: async () => ({ results: mockSections }),
      run: async () => ({ success: true }),
    })
    mockD1 = { prepare: vi.fn().mockImplementation((s: string) => makeStmt(s)), batch: vi.fn(async (stmts: any[]) => { for (const st of stmts) await st.run() }) }
  })

  it('returns 401 without auth production', async () => {
    const { onRequestPost } = await import('./reorder')
    const request = mockRequest('http://localhost/api/admin/sections/reorder', { orderedIds: ['sec3', 'sec1', 'sec2'] })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when orderedIds missing', async () => {
    const { onRequestPost } = await import('./reorder')
    const request = mockRequest('http://localhost/api/admin/sections/reorder', {})
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
  })

  it('reorders sections and returns updated order', async () => {
    const { onRequestPost } = await import('./reorder')
    const request = mockRequest('http://localhost/api/admin/sections/reorder', { orderedIds: ['sec3', 'sec1', 'sec2'] })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ordered).toEqual(['sec3', 'sec1', 'sec2'])
    // Check sort_order updated
    expect(mockSections.find((s) => s.id === 'sec3')?.sort_order).toBe(0)
    expect(mockSections.find((s) => s.id === 'sec1')?.sort_order).toBe(1)
  })

  it('allows JWT prod', async () => {
    const token = makeMockJwt('admin@example.com')
    const { onRequestPost } = await import('./reorder')
    const request = mockRequest('http://localhost/api/admin/sections/reorder', { orderedIds: ['sec1', 'sec2'] }, { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
  })
})
