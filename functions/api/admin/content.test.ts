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
function mockRequest(url: string, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return { url, headers: { get: (n: string) => lower[n.toLowerCase()] || null } } as any
}

describe('GET /api/admin/content — admin view all including hidden', () => {
  let mockD1: any
  let mockPages = [{ id: 'page1', slug: 'home', title: 'Portfolio', meta_description: 'My portfolio', sort_order: 0, is_published: 1 }]
  let mockSections = [
    { id: 'sec1', page_id: 'page1', type: 'hero', heading: 'Welcome', subheading: 'Sub', sort_order: 0, config: '{"theme":"dark"}', is_visible: 1 },
    { id: 'sec_hidden', page_id: 'page1', type: 'text-block', heading: 'Hidden', sort_order: 1, config: '{}', is_visible: 0 },
  ]
  let mockItems = [
    { id: 'item1', section_id: 'sec1', title: 'Hero', body: 'Body', image_url: '/img/hero.jpg', sort_order: 0, is_visible: 1 },
    { id: 'item_hidden', section_id: 'sec1', title: 'Hidden Item', body: 'Hidden', sort_order: 1, is_visible: 0 },
  ]

  beforeEach(() => {
    const makeStmt = (sql: string) => ({
      bind: vi.fn().mockImplementation((...args: any[]) => ({
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM pages')) {
            const slug = args[0]
            return mockPages.find((p) => p.slug === slug) || null
          }
          if (sql.includes('FROM sections') && sql.includes('WHERE id')) {
            const id = args[0]
            return mockSections.find((s) => s.id === id) || null
          }
          if (sql.includes('FROM section_items') && sql.includes('WHERE id')) {
            const id = args[0]
            return mockItems.find((i) => i.id === id) || null
          }
          return null
        }),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM pages')) return { results: mockPages }
          if (sql.includes('FROM sections')) {
            const pageId = args[0] || 'page1'
            return { results: mockSections.filter((s) => s.page_id === pageId) }
          }
          if (sql.includes('FROM section_items')) {
            const secId = args[0]
            return { results: mockItems.filter((it) => it.section_id === secId) }
          }
          return { results: [] }
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      })),
      first: vi.fn().mockImplementation(async () => mockPages[0]),
      all: vi.fn().mockImplementation(async () => {
        if (sql.includes('FROM sections')) return { results: mockSections }
        if (sql.includes('FROM section_items')) return { results: mockItems }
        return { results: mockPages }
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    })

    mockD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => makeStmt(sql)),
      exec: vi.fn(),
    }
  })

  it('returns 401 when no auth in production', async () => {
    const { onRequestGet } = await import('./content')
    const request = mockRequest('http://localhost/api/admin/content')
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(401)
  })

  it('returns 200 with bypass local and includes hidden sections and items', async () => {
    const { onRequestGet } = await import('./content')
    const request = mockRequest('http://localhost/api/admin/content')
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.page.slug).toBe('home')
    // Should include hidden section
    expect(json.sections.length).toBe(2)
    const hiddenSec = json.sections.find((s: any) => s.id === 'sec_hidden')
    expect(hiddenSec).toBeDefined()
    expect(hiddenSec.is_visible).toBe(0)
    // Hidden items included
    const sec1 = json.sections.find((s: any) => s.id === 'sec1')
    expect(sec1.items.length).toBe(2)
    const hiddenItem = sec1.items.find((i: any) => i.id === 'item_hidden')
    expect(hiddenItem).toBeDefined()
  })

  it('returns ordered by sort_order', async () => {
    const { onRequestGet } = await import('./content')
    const request = mockRequest('http://localhost/api/admin/content')
    const env: any = { ENVIRONMENT: 'local', DB: mockD1 }
    const res = await onRequestGet({ request, env } as any)
    const json = (await res.json()) as any
    expect(json.sections[0].id).toBe('sec1')
    expect(json.sections[1].id).toBe('sec_hidden')
  })

  it('allows valid JWT in production', async () => {
    const token = makeMockJwt('admin@example.com')
    const { onRequestGet } = await import('./content')
    const request = mockRequest('http://localhost/api/admin/content', { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', DB: mockD1 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
  })

  it('returns 403 when email not in allowlist', async () => {
    const token = makeMockJwt('hacker@evil.com')
    const { onRequestGet } = await import('./content')
    const request = mockRequest('http://localhost/api/admin/content', { 'Cf-Access-Jwt-Assertion': token })
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com', DB: mockD1 }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(403)
  })
})
