import { describe, it, expect, vi, beforeEach } from 'vitest'

type MockD1 = {
  prepare: (sql: string) => { first: () => Promise<any> }
}
type MockR2 = {
  put: (key: string, value: string) => Promise<any>
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>
  delete: (key: string) => Promise<void>
}

describe('GET /api/health', () => {
  let mockD1: MockD1
  let mockR2: MockR2
  let lastPutValue = ''

  beforeEach(() => {
    lastPutValue = ''
    mockD1 = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ one: 1 }),
      }),
    } as any

    mockR2 = {
      put: vi.fn().mockImplementation((_key: string, value: string) => {
        lastPutValue = value
        return Promise.resolve(undefined)
      }),
      get: vi.fn().mockImplementation(() => {
        return Promise.resolve({
          text: vi.fn().mockResolvedValue(lastPutValue || 'ok'),
        })
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as any
  })

  it('should return db:ok + r2:ok when both bindings succeed', async () => {
    const { onRequestGet } = await import('./health')
    const env = {
      DB: mockD1,
      R2_BUCKET: mockR2,
      ENVIRONMENT: 'test',
      SITE_URL: 'http://localhost:8788',
    } as any

    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(200)
    const json = await response.json() as any
    expect(json.status).toBe('ok')
    expect(json.db).toBe('ok')
    expect(json.r2).toBe('ok')
    expect(json.timestamp).toBeDefined()
    expect(json.env).toBe('test')
    expect(json.checks).toBeDefined()
  })

  it('should return db:error when D1 SELECT fails', async () => {
    const failingD1 = {
      prepare: vi.fn().mockReturnValue({
        first: vi.fn().mockRejectedValue(new Error('D1 down')),
      }),
    } as any

    const { onRequestGet } = await import('./health')
    const env = { DB: failingD1, R2_BUCKET: mockR2, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(500)
    const json = await response.json() as any
    expect(json.db).toBe('error')
    expect(json.dbError).toBeDefined()
  })

  it('should return r2:error when R2 PUT/GET fails', async () => {
    const failingR2 = {
      put: vi.fn().mockRejectedValue(new Error('R2 down')),
      get: vi.fn().mockRejectedValue(new Error('R2 down')),
      delete: vi.fn().mockResolvedValue(undefined),
    } as any

    const { onRequestGet } = await import('./health')
    const env = { DB: mockD1, R2_BUCKET: failingR2, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(500)
    const json = await response.json() as any
    expect(json.r2).toBe('error')
    expect(json.r2Error).toBeDefined()
  })

  it('should handle missing bindings gracefully - both D1 and R2 error', async () => {
    const { onRequestGet } = await import('./health')
    const env = { ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(500)
    const json = await response.json() as any
    expect(json.status).toBe('error')
    expect(json.db).toBe('error')
    expect(json.r2).toBe('error')
  })

  it('should return r2:error when R2 binding missing but D1 ok (R2 required for both envs)', async () => {
    const { onRequestGet } = await import('./health')
    const env = { DB: mockD1, ENVIRONMENT: 'test' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(500)
    const json = await response.json() as any
    expect(json.db).toBe('ok')
    expect(json.r2).toBe('error')
  })

  it('should return db:ok r2:ok for alpha env (preview) with alpha D1+R2', async () => {
    const { onRequestGet } = await import('./health')
    const env = { DB: mockD1, R2_BUCKET: mockR2, ENVIRONMENT: 'alpha', SITE_URL: 'https://alpha.profile-webapp.pages.dev' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(200)
    const json = await response.json() as any
    expect(json.db).toBe('ok')
    expect(json.r2).toBe('ok')
    expect(json.env).toBe('alpha')
  })

  it('should return db:ok r2:ok for production env with prod D1+R2', async () => {
    const { onRequestGet } = await import('./health')
    const env = { DB: mockD1, R2_BUCKET: mockR2, ENVIRONMENT: 'production', SITE_URL: 'https://profile-webapp.pages.dev' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(200)
    const json = await response.json() as any
    expect(json.db).toBe('ok')
    expect(json.r2).toBe('ok')
    expect(json.env).toBe('production')
  })

  it('should include timing and ENVIRONMENT var', async () => {
    const { onRequestGet } = await import('./health')
    const env = { DB: mockD1, R2_BUCKET: mockR2, ENVIRONMENT: 'alpha' } as any
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    const json = await response.json() as any
    expect(json.env).toBe('alpha')
    expect(json.checks.d1Ms).toBeGreaterThanOrEqual(0)
    expect(json.checks.r2Ms).toBeGreaterThanOrEqual(0)
  })
})
