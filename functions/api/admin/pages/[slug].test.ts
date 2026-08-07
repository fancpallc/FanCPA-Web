import { describe, it, expect, vi, beforeEach } from 'vitest'

function base64UrlEncode(obj: any): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function makeMockJwt(email: string) {
  return `${base64UrlEncode({ alg: 'RS256', kid: 'test' })}.${base64UrlEncode({ email, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
function mockRequest(body: any, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return { method: 'PUT', url: 'http://localhost/api/admin/pages/home', headers: { get: (n: string) => lower[n.toLowerCase()] || null }, json: async () => body } as any
}

describe('PUT /api/admin/pages/:slug — the site’s own name', () => {
  let mockD1: any
  let page: any

  beforeEach(() => {
    page = { id: 'page_home', slug: 'home', title: 'Jane Doe — Designer', meta_description: 'Old', site_name: 'Jane Doe', footer_tagline: 'Old line' }
    const makeStmt = (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => (sql.includes('FROM pages') && args[args.length - 1] === page.slug ? page : null),
        run: async () => {
          if (sql.startsWith('UPDATE pages')) {
            const fields = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1])
            fields.forEach((f, i) => { page[f] = args[i] })
          }
          return { success: true }
        },
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
    })
    mockD1 = { prepare: vi.fn().mockImplementation(makeStmt) }
  })

  const put = async (body: any, env: any = { ENVIRONMENT: 'local', DB: mockD1 }, headers = {}) => {
    const { onRequestPut } = await import('./[slug]')
    return onRequestPut({ request: mockRequest(body, headers), env, params: { slug: 'home' } } as any)
  }

  it('401 without auth in production', async () => {
    expect((await put({ site_name: 'X' }, { ENVIRONMENT: 'production', DB: mockD1 })).status).toBe(401)
  })

  it('allows a signed-in admin in production', async () => {
    const res = await put({ site_name: 'Studio Nine' }, { ENVIRONMENT: 'production', DB: mockD1 }, { 'Cf-Access-Jwt-Assertion': makeMockJwt('admin@example.com') })
    expect(res.status).toBe(200)
  })

  it('renames the site', async () => {
    const res = await put({ site_name: 'Studio Nine' })
    expect(res.status).toBe(200)
    expect((await res.json() as any).site_name).toBe('Studio Nine')
  })

  it('updates several fields at once and leaves the rest alone', async () => {
    const res = await put({ site_name: 'Studio Nine', footer_tagline: 'Brand work for founders.' })
    const json = (await res.json()) as any
    expect(json.site_name).toBe('Studio Nine')
    expect(json.footer_tagline).toBe('Brand work for founders.')
    expect(json.title).toBe('Jane Doe — Designer')
  })

  it('trims whitespace rather than storing a padded name', async () => {
    expect(((await (await put({ site_name: '  Studio Nine  ' })).json()) as any).site_name).toBe('Studio Nine')
  })

  it.each(['site_name', 'title'])('refuses to blank %s, which would render as nothing', async (field) => {
    const res = await put({ [field]: '   ' })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/cannot be empty/)
  })

  it('rejects a site name too long for the header', async () => {
    const res = await put({ site_name: 'x'.repeat(41) })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/40 characters/)
  })

  it('ignores fields that are not the owner’s to change', async () => {
    const res = await put({ slug: 'hijacked', id: 'other' })
    expect(res.status).toBe(400)
    expect(page.slug).toBe('home')
  })

  it('404 for a page that does not exist', async () => {
    const { onRequestPut } = await import('./[slug]')
    const res = await onRequestPut({ request: mockRequest({ site_name: 'X' }), env: { ENVIRONMENT: 'local', DB: mockD1 }, params: { slug: 'nope' } } as any)
    expect(res.status).toBe(404)
  })
})
