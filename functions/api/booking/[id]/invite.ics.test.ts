import { describe, it, expect } from 'vitest'
import { onRequestGet } from './invite.ics'

function mockDbWithBooking(booking: any, contact?: any) {
  return {
    prepare: (sql: string) => {
      const s = sql.toLowerCase()
      return {
        bind: (...args: any[]) => ({
          first: async () => {
            if (s.includes('from bookings') && s.includes('join contacts')) {
              return { ...booking, ...contact }
            }
            if (s.includes('from bookings')) return booking
            return null
          },
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
        first: async () => {
          if (s.includes('from bookings') && s.includes('join contacts')) return { ...booking, ...contact }
          if (s.includes('from bookings')) return booking
          return null
        },
      }
    },
  }
}

describe('GET /api/booking/:id/invite.ics (T2 restore .ics via server endpoint)', () => {
  it('returns 404 when booking not found', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }), first: async () => null }),
    }
    const res = await onRequestGet({ params: { id: 'missing' }, env: { DB: db }, request: new Request('http://x/') } as any)
    expect(res.status).toBe(404)
  })

  it('returns valid VCALENDAR with UID/DTSTAMP/DTSTART/DTEND, escapes commas/semicolons', async () => {
    const booking = {
      id: 'b123',
      slot_start: '2026-07-20T13:00:00.000Z', // 09:00 EDT
      slot_end: '2026-07-20T14:00:00.000Z',
      purpose: 'Tax filing, LLC; urgent',
      meet_link: 'https://meet.google.com/abc-defg-hij',
      drive_folder_url: 'https://drive.google.com/drive/folders/1ABCDEF',
      cancel_token: 'tok-123',
    }
    const contact = {
      first_name: "O'Brien",
      last_name: 'Test',
      email: 'client@example.com',
      phone: '555-1234',
    }
    const db = mockDbWithBooking(booking, contact)
    const res = await onRequestGet({ params: { id: 'b123' }, env: { DB: db, SITE_URL: 'https://example.com' }, request: new Request('http://x/') } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/calendar')
    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('BEGIN:VEVENT')
    expect(body).toContain('UID:b123@fancpa.local')
    expect(body).toContain('DTSTART:20260720T130000Z')
    expect(body).toContain('DTEND:20260720T140000Z')
    expect(body).toContain('DTSTAMP:')
    // Summary must handle apostrophe (O'Brien) — server-generated ICS must not break on single-quoted JS attr like old inline handler did
    expect(body).toContain('SUMMARY:')
    expect(body).toContain("O'Brien")
    // Purpose with comma/semicolon must be escaped with \,
    expect(body).toContain('\\,') // comma escaped
    expect(body).toContain('\\;') // semicolon escaped
    // Must contain Meet and Drive
    expect(body).toContain('meet.google.com')
    expect(body).toContain('drive.google.com')
    expect(body).toContain('STATUS:CONFIRMED')
  })

  it('does not emit fake Meet links as LOCATION', async () => {
    const booking = {
      id: 'b456',
      slot_start: '2026-07-20T13:00:00.000Z',
      slot_end: '2026-07-20T14:00:00.000Z',
      purpose: 'Intro',
      meet_link: 'https://meet.google.com/fake-no-meet-abc',
      drive_folder_url: '',
      cancel_token: 'tok-456',
    }
    const db = mockDbWithBooking(booking, { first_name: 'A', last_name: 'B', email: 'a@b.com' })
    const res = await onRequestGet({ params: { id: 'b456' }, env: { DB: db }, request: new Request('http://x/') } as any)
    const body = await res.text()
    // LOCATION must not contain fake- path per T2 preserve no-Meet path
    expect(body.includes('LOCATION:') ? !body.match(/LOCATION:.*fake-/) : true).toBe(true)
  })
})
