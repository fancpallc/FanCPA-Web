import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockStmt = {
  first: () => Promise<any>
  all: () => Promise<{ results: any[] }>
  bind: (...args: any[]) => MockStmt
}
type MockD1 = {
  prepare: (sql: string) => MockStmt
}

describe('GET /api/content/:slug', () => {
  let mockD1: MockD1
  let mockPages = [
    { id: 'page1', slug: 'home', title: 'Portfolio', meta_description: 'My portfolio', sort_order: 0, is_published: 1 },
  ]
  let mockSections = [
    { id: 'sec1', page_id: 'page1', type: 'hero', heading: 'Welcome', subheading: 'Sub', sort_order: 0, config: '{"theme":"dark"}', is_visible: 1 },
    { id: 'sec2', page_id: 'page1', type: 'cards-grid', heading: 'Services', sort_order: 1, config: '{}', is_visible: 1 },
    { id: 'sec_hidden', page_id: 'page1', type: 'text-block', heading: 'Hidden', sort_order: 2, config: '{}', is_visible: 0 },
  ]
  let mockItems = [
    { id: 'item1', section_id: 'sec1', title: 'Hero Title', body: 'Hero body', image_url: '/img/hero.jpg', sort_order: 0, is_visible: 1 },
    { id: 'item2', section_id: 'sec2', title: 'Service 1', body: 'Desc 1', icon: 'star', sort_order: 1, is_visible: 1 },
    { id: 'item3', section_id: 'sec2', title: 'Service 2', body: 'Desc 2', sort_order: 0, is_visible: 1 },
    { id: 'item_hidden', section_id: 'sec2', title: 'Hidden', body: 'Should not show', sort_order: 2, is_visible: 0 },
  ]

  beforeEach(() => {
    // Helper that filters based on bind args for items
    const makeStmt = (sql: string, firstResult: any = null) => {
      let bindArgs: any[] = []
      return {
        bind: vi.fn().mockImplementation((...args: any[]) => {
          bindArgs = args
          return {
            first: vi.fn().mockImplementation(async () => {
              if (sql.includes('FROM pages')) {
                // filter by slug
                const slug = bindArgs[0]
                const found = mockPages.find((p) => p.slug === slug && p.is_published === 1)
                return found || null
              }
              return firstResult
            }),
            all: vi.fn().mockImplementation(async () => {
              if (sql.includes('FROM pages')) {
                return { results: [] }
              }
              if (sql.includes('FROM sections')) {
                const pageId = bindArgs[0]
                const filtered = mockSections.filter((s) => s.page_id === pageId)
                return { results: filtered }
              }
              if (sql.includes('FROM section_items')) {
                const sectionId = bindArgs[0]
                const filtered = mockItems.filter((it) => it.section_id === sectionId)
                return { results: filtered }
              }
              return { results: [] }
            }),
          } as any
        }),
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM pages')) {
            // When called without bind (fallback), return first page
            return firstResult ?? mockPages[0]
          }
          return firstResult
        }),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes('FROM pages')) return { results: [] }
          if (sql.includes('FROM sections')) return { results: mockSections }
          if (sql.includes('FROM section_items')) return { results: mockItems }
          return { results: [] }
        }),
      } as any
    }

    mockD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM pages')) {
          return makeStmt(sql, mockPages[0])
        }
        if (sql.includes('FROM sections')) {
          return makeStmt(sql)
        }
        if (sql.includes('FROM section_items')) {
          return makeStmt(sql)
        }
        return makeStmt(sql)
      }),
    } as any
  })

  it('should return 404 for unknown slug', async () => {
    const pageNotFoundD1 = {
      prepare: () => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    } as any

    const { onRequestGet } = await import('./[slug]')
    const env = { DB: pageNotFoundD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/unknown')
    const response = await onRequestGet({ request, env, params: { slug: 'unknown' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    expect(response.status).toBe(404)
    const json = await response.json() as any
    expect(json.error).toMatch(/not found/i)
  })

  it('should return page home with sections ordered by sort_order', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(200)
    const json = await response.json() as any
    expect(json.page.slug).toBe('home')
    expect(json.page.title).toBe('Portfolio')
    expect(json.sections.length).toBe(2) // hidden filtered
    expect(json.sections[0].id).toBe('sec1')
    expect(json.sections[0].sort_order).toBe(0)
    expect(json.sections[1].id).toBe('sec2')
  })

  it('should filter sections where is_visible=0', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    const ids = json.sections.map((s: any) => s.id)
    expect(ids).not.toContain('sec_hidden')
  })

  it('should include section_items ordered by sort_order for each section', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    const sec2 = json.sections.find((s: any) => s.id === 'sec2')
    expect(sec2).toBeDefined()
    // items ordered 0 then 1
    expect(sec2.items[0].id).toBe('item3')
    expect(sec2.items[1].id).toBe('item2')
  })

  it('should filter section_items where is_visible=0', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    const sec2 = json.sections.find((s: any) => s.id === 'sec2')
    const itemIds = sec2.items.map((i: any) => i.id)
    expect(itemIds).not.toContain('item_hidden')
  })

  it('should parse config JSON field safely', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    expect(json.sections[0].config).toEqual({ theme: 'dark' })
    expect(typeof json.sections[0].config).toBe('object')
  })

  it('should include meta_description from pages table', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    expect(json.page.meta_description).toBe('My portfolio')
  })

  it('should return cache header 5-min', async () => {
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const cache = response.headers.get('Cache-Control') || ''
    expect(cache).toMatch(/max-age=300|5-min|300/)
  })

  it('should handle empty sections', async () => {
    const emptySectionsD1 = {
      prepare: (sql: string) => ({
        bind: (..._args: any[]) => ({
          first: vi.fn().mockResolvedValue(mockPages[0]),
          all: vi.fn().mockResolvedValue({ results: sql.includes('sections') ? [] : [] }),
        }),
        first: vi.fn().mockResolvedValue(mockPages[0]),
        all: vi.fn().mockResolvedValue({ results: sql.includes('sections') ? [] : [] }),
      }),
    } as any
    const { onRequestGet } = await import('./[slug]')
    const env = { DB: emptySectionsD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/content/home')
    const response = await onRequestGet({ request, env, params: { slug: 'home' }, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    expect(json.sections).toEqual([])
  })
})
