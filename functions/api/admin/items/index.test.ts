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
  return { method, url, headers: { get: (n: string) => lower[n.toLowerCase()] || null }, json: async () => body } as any
}

describe('POST /api/admin/items — add an item to a section', () => {
  let mockD1: any
  let mockSections: any[]
  let mockItems: any[]

  beforeEach(() => {
    mockSections = [{ id: 'sec_gallery', page_id: 'page_home', type: 'image-gallery', heading: 'My Work' }]
    mockItems = []
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM sections')) return mockSections.find((s) => s.id === args[0]) || null
          if (sql.includes('FROM section_items') && sql.includes('WHERE id')) return mockItems.find((i) => i.id === args[0]) || null
          return null
        },
        all: async () => ({ results: mockItems.filter((i) => i.section_id === args[0]) }),
        run: async () => {
          if (sql.includes('INSERT INTO section_items')) {
            const [id, section_id, title, body, image_url, icon, link_url, link_text, author, rating, image_alt, sort_order, is_visible] = args
            mockItems.push({ id, section_id, title, body, image_url, icon, link_url, link_text, author, rating, image_alt, sort_order, is_visible })
          }
          return { success: true, meta: { changes: 1 } }
        },
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    })
    mockD1 = { prepare: vi.fn().mockImplementation((s: string) => makeStmt(s)) }
  })

  it('401 without auth in production', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'sec_gallery' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'production', DB: mockD1 } } as any)
    expect(res.status).toBe(401)
  })

  it('400 when sectionId is missing', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { title: 'Orphan' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect(res.status).toBe(400)
  })

  it('404 when the section does not exist', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'nope' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect(res.status).toBe(404)
  })

  it('creates an empty item and returns 201', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'sec_gallery', title: 'New project' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect(res.status).toBe(201)
    const json = (await res.json()) as any
    expect(json.section_id).toBe('sec_gallery')
    expect(json.title).toBe('New project')
    expect(json.sort_order).toBe(0)
    // Starts unpublished — a blank card must not appear on the live site on click.
    expect(json.is_visible).toBe(0)
    expect(mockItems).toHaveLength(1)
  })

  it('appends after the existing items', async () => {
    mockItems.push({ id: 'a', section_id: 'sec_gallery', sort_order: 0 }, { id: 'b', section_id: 'sec_gallery', sort_order: 1 })
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'sec_gallery' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect((await res.json() as any).sort_order).toBe(2)
  })

  it('starts a new testimonial at five stars', async () => {
    mockSections.push({ id: 'sec_testimonials', page_id: 'page_home', type: 'testimonials', heading: 'Happy Clients' })
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'sec_testimonials' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect((await res.json() as any).rating).toBe(5)
  })

  it('leaves rating null on section types that have no stars', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest('POST', 'http://localhost/api/admin/items', { sectionId: 'sec_gallery' })
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'local', DB: mockD1 } } as any)
    expect((await res.json() as any).rating).toBeNull()
  })

  it('allows a signed-in admin in production', async () => {
    const { onRequestPost } = await import('./index')
    const req = mockRequest(
      'POST',
      'http://localhost/api/admin/items',
      { sectionId: 'sec_gallery' },
      { 'Cf-Access-Jwt-Assertion': makeMockJwt('admin@example.com') },
    )
    const res = await onRequestPost({ request: req, env: { ENVIRONMENT: 'production', DB: mockD1 } } as any)
    expect(res.status).toBe(201)
  })
})
