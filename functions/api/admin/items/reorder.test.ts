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
function mockRequest(body: any, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    url: 'http://localhost/api/admin/items/reorder',
    method: 'POST',
    headers: { get: (n: string) => lower[n.toLowerCase()] || null },
    json: async () => body,
  } as any
}

describe('POST /api/admin/items/reorder', () => {
  let mockD1: any
  let mockItems = [
    { id: 'item1', section_id: 'sec1', sort_order: 0 },
    { id: 'item2', section_id: 'sec1', sort_order: 1 },
  ]

  beforeEach(() => {
    mockItems = [
      { id: 'item1', section_id: 'sec1', sort_order: 0 },
      { id: 'item2', section_id: 'sec1', sort_order: 1 },
    ]
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => null,
        all: async () => ({ results: mockItems }),
        run: async () => {
          if (sql.includes('UPDATE section_items')) {
            const sort_order = args[0]
            const id = args[1]
            const it = mockItems.find((i) => i.id === id)
            if (it) it.sort_order = sort_order
          }
          return { success: true }
        },
      }),
      first: async () => null,
      all: async () => ({ results: mockItems }),
      run: async () => ({ success: true }),
    })
    mockD1 = { prepare: vi.fn().mockImplementation((s: string) => makeStmt(s)), batch: vi.fn(async (stmts: any[]) => { for (const st of stmts) await st.run() }) }
  })

  it('401 without auth', async () => {
    const { onRequestPost } = await import('./reorder')
    const req = mockRequest({ sectionId: 'sec1', orderedIds: ['item2', 'item1'] })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPost({ request: req, env } as any)
    expect(res.status).toBe(401)
  })

  it('400 when missing fields', async () => {
    const { onRequestPost } = await import('./reorder')
    const req = mockRequest({})
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPost({ request: req, env } as any)
    expect(res.status).toBe(400)
  })

  it('reorders items within section', async () => {
    const { onRequestPost } = await import('./reorder')
    const req = mockRequest({ sectionId: 'sec1', orderedIds: ['item2', 'item1'] })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPost({ request: req, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ordered).toEqual(['item2', 'item1'])
    expect(mockItems.find((i) => i.id === 'item2')?.sort_order).toBe(0)
  })

  it('allows JWT prod', async () => {
    const token = makeMockJwt('admin@example.com')
    const { onRequestPost } = await import('./reorder')
    const req = mockRequest({ sectionId: 'sec1', orderedIds: ['item1'] }, { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPost({ request: req, env } as any)
    expect(res.status).toBe(200)
  })
})
