import { describe, it, expect, vi } from 'vitest'
import { onRequestGet } from './images/[[key]]'

function mockRequest(url: string) {
  return { url } as any
}

function makeMockR2(data: Map<string, { body: Uint8Array; contentType: string }>) {
  return {
    get: vi.fn(async (key: string) => {
      const entry = data.get(key)
      if (!entry) return null
      return {
        key,
        size: entry.body.length,
        httpMetadata: { contentType: entry.contentType },
        body: entry.body,
        // R2 object body has arrayBuffer method in real, but we mock via body
        // Our impl will use object.body as stream or Uint8Array
        // We'll make body use entry.body
        // For simplicity, we return object with body property that is Uint8Array and also has arrayBuffer
        arrayBuffer: async () => entry.body.buffer,
        // For .body stream handling, we'll have body as Uint8Array
      } as any
    }),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  }
}

describe('GET /api/images/* — public R2 image serving', () => {
  it('returns 404 when key missing', async () => {
    const request = mockRequest('http://localhost/api/images/')
    const env: any = { R2_BUCKET: makeMockR2(new Map()) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when key not in R2', async () => {
    const request = mockRequest('http://localhost/api/images/portfolio/missing.png')
    const env: any = { R2_BUCKET: makeMockR2(new Map()) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(404)
  })

  it('returns image with correct content-type and cache headers for PNG', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]) // PNG magic
    const store = new Map([['portfolio/test.png', { body: pngBytes, contentType: 'image/png' }]])
    const request = mockRequest('http://localhost/api/images/portfolio/test.png')
    const env: any = { R2_BUCKET: makeMockR2(store) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=31536000/)
    expect(res.headers.get('Content-Length')).toBe(String(pngBytes.length))
  })

  it('returns image for WebP fallback format', async () => {
    const webpBytes = new Uint8Array([82, 73, 70, 70]) // RIFF
    const store = new Map([['portfolio/photo.webp', { body: webpBytes, contentType: 'image/webp' }]])
    const request = mockRequest('http://localhost/api/images/portfolio/photo.webp')
    const env: any = { R2_BUCKET: makeMockR2(store) }
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
  })

  it('sanitizes path traversal attempts', async () => {
    const request = mockRequest('http://localhost/api/images/../../etc/passwd')
    const env: any = { R2_BUCKET: makeMockR2(new Map()) }
    const res = await onRequestGet({ request, env } as any)
    // Should reject traversal with 400 or 404, not attempt to read
    expect([400, 404]).toContain(res.status)
  })

  it('requires key to start with portfolio/ prefix', async () => {
    const store = new Map([['other/key.png', { body: new Uint8Array([1]), contentType: 'image/png' }]])
    const request = mockRequest('http://localhost/api/images/other/key.png')
    const env: any = { R2_BUCKET: makeMockR2(store) }
    const res = await onRequestGet({ request, env } as any)
    // Should reject non-portfolio prefix for security - only allow portfolio/* (our upload strategy)
    expect([400, 404]).toContain(res.status)
  })

  it('returns 500 when R2 binding missing', async () => {
    const request = mockRequest('http://localhost/api/images/portfolio/test.png')
    const env: any = {}
    const res = await onRequestGet({ request, env } as any)
    expect(res.status).toBe(500)
  })
})
