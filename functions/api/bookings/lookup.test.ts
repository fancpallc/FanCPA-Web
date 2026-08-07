import { describe, it, expect, vi, beforeEach } from 'vitest'

const HOUR = 60 * 60 * 1000

function mockRequest(body: any) {
  return { method: 'POST', url: 'http://localhost/api/bookings/lookup', headers: { get: () => null }, json: async () => body } as any
}

/**
 * "Manage bookings" printed `created_at` — the moment the form was submitted — because
 * the meeting time was never stored. A visitor who booked Friday 4:30 PM saw their
 * booking listed as the Saturday lunchtime they filled the form in, and the cancel
 * confirmation repeated that wrong time.
 */
describe('POST /api/bookings/lookup — which meeting am I cancelling?', () => {
  let mockD1: any
  let rows: any[]

  beforeEach(() => {
    rows = []
    mockD1 = {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: () => ({
          first: async () => (sql.includes('FROM contacts') ? { id: 'c1', email: 'visitor@example.com' } : null),
          all: async () => ({ results: sql.includes('FROM bookings') ? rows : [] }),
          run: async () => ({ success: true }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      })),
    }
  })

  const lookup = async () => {
    const { onRequestPost } = await import('./lookup')
    const res = await onRequestPost({ request: mockRequest({ email: 'visitor@example.com' }), env: { ENVIRONMENT: 'local', STUB: 'true', DB: mockD1 }, params: {} } as any)
    return (await res.json()) as any
  }

  it('shows the meeting time, not the moment the form was submitted', async () => {
    const meeting = new Date(Date.now() + 72 * HOUR)
    rows.push({ id: 'b1', status: 'confirmed', cancel_token: 't1', slot_start: meeting.toISOString(), slot_end: new Date(meeting.getTime() + HOUR / 2).toISOString(), created_at: '2026-08-01 12:25:00' })

    const json = await lookup()
    const expected = meeting.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    expect(json.bookings[0].dateTime).toBe(expected)
    expect(json.bookings[0].dateTime).not.toContain('12:25')
  })

  it('leaves a meeting that has already happened off a list headed "upcoming"', async () => {
    rows.push(
      { id: 'past', status: 'confirmed', cancel_token: 't1', slot_start: new Date(Date.now() - 48 * HOUR).toISOString(), created_at: '2026-07-01 09:00:00' },
      { id: 'future', status: 'confirmed', cancel_token: 't2', slot_start: new Date(Date.now() + 48 * HOUR).toISOString(), created_at: '2026-07-01 09:00:00' },
    )
    const json = await lookup()
    expect(json.bookings.map((b: any) => b.id)).toEqual(['future'])
  })

  it('lists the soonest meeting first', async () => {
    rows.push(
      { id: 'later', status: 'confirmed', cancel_token: 't1', slot_start: new Date(Date.now() + 96 * HOUR).toISOString(), created_at: '2026-07-01 09:00:00' },
      { id: 'sooner', status: 'confirmed', cancel_token: 't2', slot_start: new Date(Date.now() + 24 * HOUR).toISOString(), created_at: '2026-07-02 09:00:00' },
    )
    const json = await lookup()
    expect(json.bookings.map((b: any) => b.id)).toEqual(['sooner', 'later'])
  })

  it('says so rather than inventing a time for rows predating the slot columns', async () => {
    rows.push({ id: 'legacy', status: 'confirmed', cancel_token: 't1', slot_start: null, created_at: '2026-07-01 09:00:00' })
    const json = await lookup()
    expect(json.bookings[0].dateTime).toMatch(/not recorded/i)
    expect(json.bookings[0].dateTime).not.toMatch(/July/)
  })

  it('still hides cancelled bookings', async () => {
    rows.push({ id: 'gone', status: 'cancelled', cancel_token: 't1', slot_start: new Date(Date.now() + 24 * HOUR).toISOString(), created_at: '2026-07-01 09:00:00' })
    expect((await lookup()).bookings).toHaveLength(0)
  })
})
