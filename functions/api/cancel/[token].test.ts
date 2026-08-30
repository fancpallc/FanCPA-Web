import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/cancel/[token] — 24h cutoff + Safe Links interstitial (R2 + P0 #3)', () => {
  let mockDb: any

  beforeEach(() => {
    vi.resetAllMocks()
    mockDb = {
      prepare: vi.fn().mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
    }
  })

  function makeBooking(slot_start: string | undefined, token: string) {
    return {
      id: 'b1',
      calendar_event_id: null,
      cancel_token: token,
      status: 'confirmed',
      slot_start,
    }
  }

  async function callGet(token: string | undefined, slot_start: string | undefined, headers: Record<string, string> = {}) {
    const { onRequestGet } = await import('./[token]')
    if (slot_start !== undefined) {
      mockDb.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(makeBooking(slot_start, token || 'tok')),
        run: vi.fn().mockResolvedValue({}),
      } as any)
    } else {
      mockDb.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
      } as any)
    }
    const url = token ? `http://localhost/api/cancel/${token}` : 'http://localhost/api/cancel/'
    const request = new Request(url, { headers } as any)
    const env: any = { DB: mockDb }
    const params: any = token ? { token } : {}
    return onRequestGet({ request, env, params } as any)
  }

  async function callPost(token: string | undefined, slot_start: string | undefined, headers: Record<string, string> = {}) {
    const { onRequestPost } = await import('./[token]')
    mockDb.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(slot_start !== undefined ? makeBooking(slot_start, token || 'tok') : null),
      run: vi.fn().mockResolvedValue({}),
    } as any)
    const url = token ? `http://localhost/api/cancel/${token}` : 'http://localhost/api/cancel/'
    const request = new Request(url, { method: 'POST', headers } as any)
    const env: any = { DB: mockDb }
    const params: any = token ? { token } : {}
    return onRequestPost({ request, env, params } as any)
  }

  it('returns 400 when token missing', async () => {
    const { onRequestGet } = await import('./[token]')
    const request = new Request('http://localhost/api/cancel/')
    const env: any = { DB: mockDb }
    const res = await onRequestGet({ request, env, params: {} } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when booking not found', async () => {
    const res = await callGet('notfound', undefined)
    expect(res.status).toBe(404)
  })

  it('rejects cancellation within 24h (HTML)', async () => {
    const slotIn23h = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
    const res = await callGet('tok123', slotIn23h)
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/Too late to cancel/i)
  })

  it('rejects cancellation within 24h (JSON)', async () => {
    const slotIn5h = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
    const res = await callGet('tok123', slotIn5h, { Accept: 'application/json' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/Too late/i)
  })

  it('allows cancellation outside 24h — HTML GET returns interstitial not immediate cancel', async () => {
    const slotIn48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const res = await callGet('tok123', slotIn48h)
    expect(res.status).toBe(200)
    const text = await res.text()
    // Should be interstitial, not already cancelled
    expect(text).toMatch(/Cancel this meeting\?/i)
    expect(text).toMatch(/form method="POST"/i)
  })

  it('allows cancellation outside 24h — POST actually cancels', async () => {
    const slotIn48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const res = await callPost('tok123', slotIn48h)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toMatch(/Meeting cancelled/i)
  })

  it('allows cancellation outside 24h — JSON GET immediate cancel for API compat', async () => {
    const slotIn48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const res = await callGet('tok123', slotIn48h, { Accept: 'application/json' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.cancelled).toBe(true)
  })

  it('allows cancellation for past meetings (still cancellable) — GET interstitial, POST cancels', async () => {
    const slotPast = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const getRes = await callGet('tok123', slotPast)
    expect(getRes.status).toBe(200)
    const getText = await getRes.text()
    expect(getText).toMatch(/Cancel this meeting\?/i)
    const postRes = await callPost('tok123', slotPast)
    expect(postRes.status).toBe(200)
  })

  it('boundary: 24h -1min rejects, 24h +1min interstitial and POST allows', async () => {
    const minus = new Date(Date.now() + (24 * 60 - 1) * 60 * 1000).toISOString()
    const plus = new Date(Date.now() + (24 * 60 + 1) * 60 * 1000).toISOString()
    const resMinus = await callGet('tok123', minus)
    expect(resMinus.status).toBe(400)
    const resPlusGet = await callGet('tok123', plus)
    expect(resPlusGet.status).toBe(200)
    const plusText = await resPlusGet.text()
    expect(plusText).toMatch(/Cancel this meeting\?/i)
    const resPlusPost = await callPost('tok123', plus)
    expect(resPlusPost.status).toBe(200)
  })
})
