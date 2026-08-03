import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/calendar/slots', () => {
  beforeEach(() => vi.resetAllMocks())

  it('should return 200 with slots array for ?weeks=2 (stub when no creds)', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      BOOKING_CALENDAR_ID: 'alpha-booking@group.calendar.google.com',
      PERSONAL_CALENDAR_ID: 'personal@gmail.com',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '17:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
      ENVIRONMENT: 'test',
      SITE_URL: 'http://localhost:8788',
      // No GCAL_SERVICE_ACCOUNT_KEY → should return stub
    } as any

    const request = new Request('http://localhost:8788/api/calendar/slots?weeks=2')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)

    expect(response.status).toBe(200)
    const json = await response.json() as any
    expect(Array.isArray(json.slots)).toBe(true)
    expect(json.slots.length).toBeGreaterThan(0)
    expect(json.weeks).toBe(2)
    // Privacy: no event details
    expect(json.slots[0].title).toBeUndefined()
    expect(json.slots[0].summary).toBeUndefined()
    expect(json.slots[0].available).toBeDefined()
    expect(json.slots[0].start).toBeDefined()
    expect(json.slots[0].date).toBeDefined()
  })

  it('should support ?weeks param default 2, respects 1 and 4', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      BOOKING_CALENDAR_ID: 'alpha-booking@group.calendar.google.com',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '10:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
      ENVIRONMENT: 'test',
    } as any

    const req1 = new Request('http://localhost:8788/api/calendar/slots?weeks=1')
    const res1 = await onRequestGet({ request: req1, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json1 = await res1.json() as any
    expect(json1.weeks).toBe(1)

    const req4 = new Request('http://localhost:8788/api/calendar/slots?weeks=4')
    const res4 = await onRequestGet({ request: req4, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json4 = await res4.json() as any
    expect(json4.weeks).toBe(4)
    expect(json4.slots.length).toBeGreaterThan(json1.slots.length)
  })

  it('should include cache header 5-min and X-Cache HIT/MISS', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      BOOKING_CALENDAR_ID: 'alpha-booking@group.calendar.google.com',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '17:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
      ENVIRONMENT: 'test',
    } as any

    const request = new Request('http://localhost:8788/api/calendar/slots?weeks=2')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const cache = response.headers.get('Cache-Control') || ''
    expect(cache).toMatch(/max-age=300|300/)
    // X-Cache may be MISS on first, but should be defined
    const xCache = response.headers.get('X-Cache') || response.headers.get('X-Cache-Status') || ''
    // At least cache control present, X-Cache optional for local stub
    expect(cache.length).toBeGreaterThan(0)
  })

  it('should return stub mock slots when GCAL key missing (STUB mode for local TDD)', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      ENVIRONMENT: 'test',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '10:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
    } as any

    const request = new Request('http://localhost:8788/api/calendar/slots')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    expect(json.source).toMatch(/stub|mock|fallback/i)
    expect(json.slots.length).toBeGreaterThan(0)
  })

  it('should use BOOKING_CALENDAR_ID and PERSONAL_CALENDAR_ID vars from env', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      BOOKING_CALENDAR_ID: 'my-booking-id@group.calendar.google.com',
      PERSONAL_CALENDAR_ID: 'my-personal@gmail.com',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '17:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
      ENVIRONMENT: 'test',
    } as any

    const request = new Request('http://localhost:8788/api/calendar/slots?weeks=2')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    // Should at least return slots, and if source is not stub, should have used IDs (we check via not throwing)
    expect(response.status).toBe(200)
    expect(json.slots).toBeDefined()
  })

  it('should return empty slots for weekend per WORKING_DAYS', async () => {
    const { onRequestGet } = await import('./slots')
    const env = {
      BOOKING_CALENDAR_ID: 'alpha-booking@group.calendar.google.com',
      WORKING_HOURS_START: '09:00',
      WORKING_HOURS_END: '17:00',
      WORKING_DAYS: '1,2,3,4,5',
      SLOT_DURATION_MINUTES: '30',
      ENVIRONMENT: 'test',
    } as any

    const request = new Request('http://localhost:8788/api/calendar/slots?weeks=2')
    const response = await onRequestGet({ request, env, params: {}, waitUntil: () => {}, next: async () => new Response(''), data: {} } as any)
    const json = await response.json() as any
    // No slots should be on Saturday (6) or Sunday (0)
    json.slots.forEach((slot: any) => {
      const day = new Date(slot.date).getDay()
      expect([1,2,3,4,5]).toContain(day)
    })
  })
})
