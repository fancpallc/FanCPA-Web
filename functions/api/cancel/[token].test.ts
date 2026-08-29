import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/cancel/[token] — 24h cutoff (R2)', () => {
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

  async function callCancel(token: string | undefined, slot_start: string | undefined, headers: Record<string, string> = {}) {
    const { onRequestGet } = await import('./[token]')
    // Mock DB first() to return booking with slot_start
    if (slot_start !== undefined) {
      mockDb.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 'b1',
          calendar_event_id: null,
          cancel_token: token || 'tok',
          status: 'confirmed',
          slot_start,
        }),
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

  it('returns 400 when token missing', async () => {
    const { onRequestGet } = await import('./[token]')
    const request = new Request('http://localhost/api/cancel/')
    const env: any = { DB: mockDb }
    const res = await onRequestGet({ request, env, params: {} } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when booking not found', async () => {
    const res = await callCancel('notfound', undefined)
    expect(res.status).toBe(404)
  })

  it('rejects cancellation within 24h (HTML)', async () => {
    const slotIn23h = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
    const res = await callCancel('tok123', slotIn23h)
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toMatch(/Too late to cancel/i)
  })

  it('rejects cancellation within 24h (JSON)', async () => {
    const slotIn5h = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
    const res = await callCancel('tok123', slotIn5h, { Accept: 'application/json' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toMatch(/Too late/i)
  })

  it('allows cancellation outside 24h', async () => {
    const slotIn48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    const res = await callCancel('tok123', slotIn48h)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toMatch(/cancelled/i)
  })

  it('allows cancellation for past meetings (still cancellable)', async () => {
    const slotPast = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const res = await callCancel('tok123', slotPast)
    expect(res.status).toBe(200)
  })

  it('boundary: 24h -1min rejects, 24h +1min allows', async () => {
    const minus = new Date(Date.now() + (24 * 60 - 1) * 60 * 1000).toISOString()
    const plus = new Date(Date.now() + (24 * 60 + 1) * 60 * 1000).toISOString()
    const resMinus = await callCancel('tok123', minus)
    expect(resMinus.status).toBe(400)
    const resPlus = await callCancel('tok123', plus)
    expect(resPlus.status).toBe(200)
  })
})
