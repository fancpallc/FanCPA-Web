import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from './upload-image'

function base64UrlEncode(obj: any): string {
  const b64 = Buffer.from(JSON.stringify(obj)).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeMockJwt(email: string) {
  const header = { alg: 'RS256', kid: 'test' }
  const payload = { email, exp: Math.floor(Date.now() / 1000) + 3600 }
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig`
}

function mockRequestWithFormData(
  formData: FormData,
  headers: Record<string, string> = {},
  url: string = 'http://localhost/api/admin/upload-image'
) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v
  }
  return {
    url,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] || null,
    },
    formData: async () => formData,
  } as any
}

function makeMockR2() {
  return {
    put: vi.fn(async (key: string, body: any, opts?: any) => ({
      key,
      size: 12345,
      etag: 'test-etag',
      httpMetadata: opts?.httpMetadata,
    })),
    get: vi.fn(),
    delete: vi.fn(async (key: string) => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
  }
}

function makePngFile(name: string, size: number, type: string = 'image/png'): File {
  const buf = new Uint8Array(size)
  // PNG magic for PNG type
  if (type === 'image/png') {
    if (size >= 4) {
      buf[0] = 137
      buf[1] = 80
      buf[2] = 78
      buf[3] = 71
    }
  }
  return new File([buf], name, { type })
}

function makeTextFile(): File {
  return new File(['hello'], 'test.txt', { type: 'text/plain' })
}

describe('POST /api/admin/upload-image — PNG if ≤1MB else WebP', () => {
  it('returns 401 when no auth in production', async () => {
    const fd = new FormData()
    const file = makePngFile('test.png', 1000)
    fd.append('file', file)
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'production', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when no file provided', async () => {
    const fd = new FormData()
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/file/i)
  })

  it('returns 400 for non-image MIME type', async () => {
    const fd = new FormData()
    fd.append('file', makeTextFile())
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/image/i)
  })

  it('returns 400 when file >1MB (server safety net, client should have resized PNG→WebP)', async () => {
    const fd = new FormData()
    const bigFile = makePngFile('big.png', 1_500_000, 'image/png') // 1.5MB
    fd.append('file', bigFile)
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/too large/i)
    expect(json.error).toMatch(/1MB/)
  })

  it('uploads valid PNG ≤1MB and returns url/key', async () => {
    const fd = new FormData()
    const pngFile = makePngFile('profile.png', 500_000, 'image/png') // 500KB PNG lossless
    fd.append('file', pngFile)
    const mockR2 = makeMockR2()
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.key).toMatch(/^portfolio\/.*\.png$/)
    expect(json.url).toContain('/api/images/')
    expect(json.size).toBeDefined()
    expect(json.format).toBe('png')
    expect(mockR2.put).toHaveBeenCalledTimes(1)
    const putCall = mockR2.put.mock.calls[0]
    expect(putCall[0]).toMatch(/^portfolio\//)
    expect(putCall[2]?.httpMetadata?.contentType).toBe('image/png')
  })

  it('uploads valid WebP fallback when PNG too big (client fallback) and returns webp key', async () => {
    const fd = new FormData()
    const webpFile = makePngFile('photo.webp', 350_000, 'image/webp') // 350KB WebP compressed within 1MB
    fd.append('file', webpFile)
    const mockR2 = makeMockR2()
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.key).toMatch(/\.webp$/)
    expect(json.format).toBe('webp')
    expect(mockR2.put).toHaveBeenCalledWith(
      expect.stringMatching(/\.webp$/),
      expect.anything(),
      expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: 'image/webp' }) })
    )
  })

  it('deletes oldKey before putting new when replace-on-update (stays under 10GB free tier)', async () => {
    const fd = new FormData()
    const newFile = makePngFile('new.png', 300_000, 'image/png')
    fd.append('file', newFile)
    fd.append('oldKey', 'portfolio/old-image.png')
    const mockR2 = makeMockR2()
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
    // Delete should be called BEFORE put
    expect(mockR2.delete).toHaveBeenCalledWith('portfolio/old-image.png')
    expect(mockR2.put).toHaveBeenCalledTimes(1)
    const deleteOrder = mockR2.delete.mock.invocationCallOrder[0]
    const putOrder = mockR2.put.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(putOrder)
  })

  it('rejects path traversal in oldKey', async () => {
    const fd = new FormData()
    fd.append('file', makePngFile('test.png', 1000))
    fd.append('oldKey', '../../etc/passwd')
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/oldKey/i)
  })

  it('rejects oldKey not starting with portfolio/', async () => {
    const fd = new FormData()
    fd.append('file', makePngFile('test.png', 1000))
    fd.append('oldKey', 'other/bucket/file.png')
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(400)
  })

  it('returns 200 with valid JWT in production (passwordless Google login)', async () => {
    const token = makeMockJwt('admin@example.com')
    const fd = new FormData()
    fd.append('file', makePngFile('test.png', 1000))
    const request = mockRequestWithFormData(fd, { 'Cf-Access-Jwt-Assertion': token }, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'production', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
  })

  it('returns 403 when email not in allowlist', async () => {
    const token = makeMockJwt('hacker@evil.com')
    const fd = new FormData()
    fd.append('file', makePngFile('test.png', 1000))
    const request = mockRequestWithFormData(fd, { 'Cf-Access-Jwt-Assertion': token }, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'production', ADMIN_EMAILS: 'admin@example.com', R2_BUCKET: makeMockR2() }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(403)
  })

  it('sanitizes generated key no path traversal', async () => {
    const fd = new FormData()
    fd.append('file', makePngFile('../../../etc.png', 1000))
    const mockR2 = makeMockR2()
    const request = mockRequestWithFormData(fd, {}, 'http://localhost/api/admin/upload-image')
    const env: any = { ENVIRONMENT: 'local', R2_BUCKET: mockR2 }
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.key).not.toContain('..')
    expect(json.key).toMatch(/^portfolio\//)
  })
})
