import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyTurnstile } from './turnstile'

describe('turnstile lib — anti-bot verification', () => {
  beforeEach(() => vi.resetAllMocks())

  it('should return true for valid token when secret configured and siteverify ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any)

    const result = await verifyTurnstile('valid-token', 'secret-key')
    expect(result.ok).toBe(true)
  })

  it('should return false for invalid token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    } as any)

    const result = await verifyTurnstile('invalid-token', 'secret-key')
    expect(result.ok).toBe(false)
  })

  it('should bypass verification when STUB=true or ENVIRONMENT=local/test (mock true for TDD)', async () => {
    const resultLocal = await verifyTurnstile('any-token', '', { ENVIRONMENT: 'local' } as any)
    expect(resultLocal.ok).toBe(true)
    expect(resultLocal.source).toBe('stub')

    const resultTest = await verifyTurnstile('any-token', 'secret', { ENVIRONMENT: 'test' } as any)
    expect(resultTest.ok).toBe(true)

    const resultStub = await verifyTurnstile('any-token', 'secret', { STUB: 'true' } as any)
    expect(resultStub.ok).toBe(true)
  })

  it('should handle network error gracefully → false + error logged', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'))

    const result = await verifyTurnstile('token', 'secret')
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should include remote IP when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    global.fetch = fetchMock as any

    await verifyTurnstile('token', 'secret', { REMOTE_IP: '1.2.3.4' } as any)
    expect(fetchMock).toHaveBeenCalled()
    const body = fetchMock.mock.calls[0][1]?.body as any
    // Should include remoteip if provided (form data or JSON)
    expect(String(body)).toContain('1.2.3.4')
  })
})
