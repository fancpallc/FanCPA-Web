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

describe('PUT /api/admin/items/:id', () => {
  let mockD1: any
  let mockItems = [
    { id: 'item1', section_id: 'sec1', title: 'Title', body: 'Body', image_url: '/img.jpg', sort_order: 0, is_visible: 1 },
  ]

  beforeEach(() => {
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM section_items') && sql.includes('WHERE id')) {
            const id = args[0]
            return mockItems.find((i) => i.id === id) || null
          }
          return null
        },
        run: async () => {
          if (sql.includes('UPDATE section_items')) {
            const id = args[args.length - 1]
            const item = mockItems.find((i) => i.id === id)
            if (item) {
              // args: title, body, image_url, sort_order, is_visible, icon, link_url, link_text, author, rating, image_alt, id
              if (args[0] !== undefined) item.title = args[0]
              if (args[1] !== undefined) item.body = args[1]
              if (args[2] !== undefined) item.image_url = args[2]
              ;(item as any).rating = args[9]
              ;(item as any).image_alt = args[10]
            }
            return { success: true, meta: { changes: 1 } }
          }
          if (sql.includes('DELETE FROM section_items')) {
            const id = args[0]
            const idx = mockItems.findIndex((i) => i.id === id)
            if (idx >= 0) mockItems.splice(idx, 1)
            return { success: true }
          }
          return { success: true }
        },
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    })
    mockD1 = { prepare: vi.fn().mockImplementation((sql: string) => makeStmt(sql)) }
  })

  it('returns 401 when no auth', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', { title: 'New' })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'item1' } } as any)
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown item', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/unknown', { title: 'New' })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'unknown' } } as any)
    expect(res.status).toBe(404)
  })

  it('updates title and image_url (PNG/WebP)', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', {
      title: 'Updated',
      image_url: '/api/images/portfolio/new.png',
    })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.title).toBe('Updated')
    expect(json.image_url).toContain('portfolio')
  })

  it('supports WebP image_url fallback', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', {
      image_url: '/api/images/portfolio/photo.webp',
    })
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.image_url).toMatch(/\.webp$/)
  })

  it('stores a star rating the owner picked', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', { rating: 3 })
    const res = await onRequestPut({ request, env: { ENVIRONMENT: 'local', DB: mockD1 } as any, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
    expect((await res.json() as any).rating).toBe(3)
  })

  it.each([0, 6, 2.5, 'five'])('rejects %p as a rating rather than storing it', async (bad) => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', { rating: bad })
    const res = await onRequestPut({ request, env: { ENVIRONMENT: 'local', DB: mockD1 } as any, params: { id: 'item1' } } as any)
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/1 to 5/)
  })

  it('leaves the stored rating alone when the patch does not mention it', async () => {
    const { onRequestPut } = await import('./[id]')
    await onRequestPut({ request: mockRequest('PUT', 'http://localhost/api/admin/items/item1', { rating: 4 }), env: { ENVIRONMENT: 'local', DB: mockD1 } as any, params: { id: 'item1' } } as any)
    const res = await onRequestPut({ request: mockRequest('PUT', 'http://localhost/api/admin/items/item1', { title: 'Renamed' }), env: { ENVIRONMENT: 'local', DB: mockD1 } as any, params: { id: 'item1' } } as any)
    expect((await res.json() as any).rating).toBe(4)
  })

  it('stores the image description the owner wrote', async () => {
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', { image_alt: 'Jane at her desk sketching a logo' })
    const res = await onRequestPut({ request, env: { ENVIRONMENT: 'local', DB: mockD1 } as any, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
    expect((await res.json() as any).image_alt).toBe('Jane at her desk sketching a logo')
  })

  it('allows JWT in production', async () => {
    const token = makeMockJwt('admin@example.com')
    const { onRequestPut } = await import('./[id]')
    const request = mockRequest('PUT', 'http://localhost/api/admin/items/item1', { title: 'Prod' }, { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestPut({ request, env, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/admin/items/:id', () => {
  let mockD1: any
  let mockItems = [{ id: 'item1', section_id: 'sec1', title: 'Title', body: 'Body', sort_order: 0, is_visible: 1 }]

  beforeEach(() => {
    mockItems = [{ id: 'item1', section_id: 'sec1', title: 'Title', body: 'Body', sort_order: 0, is_visible: 1 }]
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM section_items') && sql.includes('WHERE id')) {
            return mockItems.find((i) => i.id === args[0]) || null
          }
          return null
        },
        run: async () => {
          if (sql.includes('DELETE')) {
            const id = args[0]
            const idx = mockItems.findIndex((i) => i.id === id)
            if (idx >= 0) mockItems.splice(idx, 1)
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
    mockD1 = { prepare: vi.fn().mockImplementation((sql: string) => makeStmt(sql)) }
  })

  it('deletes item and returns 200', async () => {
    const { onRequestDelete } = await import('./[id]')
    const request = { method: 'DELETE', url: 'http://localhost/api/admin/items/item1', headers: { get: () => null } } as any
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestDelete({ request, env, params: { id: 'item1' } } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.success).toBe(true)
  })
})
