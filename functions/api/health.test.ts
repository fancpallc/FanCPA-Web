import { describe, it, expect } from 'vitest'

describe('GET /api/health', () => {
  it('returns ok with timestamp and env', async () => {
    const { onRequestGet } = await import('./health')
    const env = { ENVIRONMENT: 'test', SITE_URL: 'http://localhost:8788' }

    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({
      request,
      env,
      params: {},
      waitUntil: () => {},
      next: async () => new Response(''),
      data: {},
    } as any)

    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      status: string
      message: string
      timestamp: string
      env: string
    }
    expect(json.status).toBe('ok')
    expect(json.message).toBe('FanCPA API is running')
    expect(json.env).toBe('test')
    expect(json.timestamp).toBeDefined()
  })

  it('defaults env to unknown when ENVIRONMENT is missing', async () => {
    const { onRequestGet } = await import('./health')
    const request = new Request('http://localhost:8788/api/health')
    const response = await onRequestGet({
      request,
      env: {},
      params: {},
      waitUntil: () => {},
      next: async () => new Response(''),
      data: {},
    } as any)

    const json = (await response.json()) as { env: string }
    expect(json.env).toBe('unknown')
  })
})
