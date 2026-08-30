import { describe, it, expect } from 'vitest'
import {
  computeSlotsForDay, computeSlots, parseTime, filterWorkingDays, getStubBusyBlocks, getStubSlots,
  normalizeSlotMinutes, getNext14Days, getTimezoneOffsetHours, wallTimeToUtcIso, TIMEZONE,
} from './google-calendar'

describe('google-calendar lib — slot math', () => {
  it('should parse working hours vars START/END 09:00/17:00', () => {
    expect(parseTime('09:00')).toBe(9 * 60)
    expect(parseTime('17:00')).toBe(17 * 60)
    expect(parseTime('09:30')).toBe(570)
    expect(parseTime('')).toBe(0)
  })

  it('should compute slots for day with no busy → full working hours 09-17 60min in Eastern (converted to UTC)', () => {
    const date = new Date('2026-07-20T00:00:00Z') // Monday in July — EDT UTC-4, so 09:00 ET =13:00 UTC
    const slots = computeSlotsForDay(date, { start: '09:00', end: '17:00', slotMinutes: 60 }, [])
    expect(slots.length).toBe(8)
    expect(slots[0].available).toBe(true)
    // 09:00 ET =13:00 UTC in July DST, ET display should be 09:00
    expect(slots[0].start).toContain('13:00')
    const et = new Date(slots[0].start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })
    expect(et).toContain('09:00')
  })

  it('should exclude busy blocks overlapping (Eastern 10-11 ET =14-15 UTC)', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    // Busy 10-11 ET in July =14-15 UTC
    const busy = [{ start: '2026-07-20T14:00:00Z', end: '2026-07-20T15:00:00Z' }]
    const slots = computeSlotsForDay(date, { start: '09:00', end: '12:00', slotMinutes: 60 }, busy as any)
    const available = slots.filter((s) => s.available)
    expect(available.length).toBe(2)
    // Slots are ET 09,10,11 → UTC 13,14,15 — busy 14-15 UTC (10:00-11:00 ET) removes 10:00 ET
    expect(slots.find((s) => s.start.includes('14:00'))?.available).toBe(false)
    expect(slots.find((s) => s.start.includes('13:00'))?.available).toBe(true)
    expect(slots.find((s) => s.start.includes('15:00'))?.available).toBe(true)
  })

  it('should handle partial overlap busy 09:00-09:30 ET (13:00-13:30 UTC) removes 09:00 ET slot', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const busy = [{ start: '2026-07-20T13:00:00Z', end: '2026-07-20T13:30:00Z' }]
    const slots = computeSlotsForDay(date, { start: '09:00', end: '11:00', slotMinutes: 60 }, busy as any)
    expect(slots.length).toBe(2)
    expect(slots[0].available).toBe(false)
    expect(slots[1].available).toBe(true)
  })

  it('should respect working days 1-5 filter (Mon-Fri) — weekend no slots', () => {
    // Use noon UTC so local getDay() matches UTC for all US timezones (day boundary at noon is safe)
    const monday = new Date('2026-07-20T12:00:00Z') // Monday noon UTC
    const saturday = new Date('2026-07-25T12:00:00Z') // Saturday noon UTC
    const filtered = filterWorkingDays([monday, saturday], [1, 2, 3, 4, 5])
    expect(filtered.length).toBe(1)
    expect(filtered[0].getDay()).toBe(1)
  })

  it('should handle busy all day → 0 available (Eastern 09-17 ET =13-21 UTC)', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    // 09-17 ET in July =13-21 UTC all day busy
    const busy = [{ start: '2026-07-20T13:00:00Z', end: '2026-07-20T21:00:00Z' }]
    const slots = computeSlotsForDay(date, { start: '09:00', end: '17:00', slotMinutes: 60 }, busy as any)
    expect(slots.filter((s) => s.available).length).toBe(0)
  })

  it('should handle empty busy list → full day (09-17 = 8 slots)', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const slots = computeSlotsForDay(date, { start: '09:00', end: '17:00', slotMinutes: 60 }, [])
    expect(slots.filter((s) => s.available).length).toBe(8)
  })

  it('should respect slot duration variable 60', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const slots60 = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 60 }, [])
    expect(slots60.length).toBe(1)
  })

  it('should compute slots for multiple days given weeks=2', () => {
    // 2026-07-20 is a Monday
    const start = new Date('2026-07-20T00:00:00Z')
    const busy: any[] = []

    // Use a fixed start date that is a Monday to guarantee 10 working days over 2 weeks
    // Setting minNoticeDays to -999 ensures no dates are filtered out due to the test runner's current date
    const slots = computeSlots({
      startDate: start,
      weeks: 2,
      workingHours: { start: '09:00', end: '10:00', days: [1,2,3,4,5], slotMinutes: 60 },
      busyBlocks: busy,
      minNoticeDays: -999
    })

    // With 2 weeks (10 working days) and 1 slot per day (9-10am), we expect 10 slots.
    expect(slots.length).toBe(10)
    // All should be future or today, not past, and available
    expect(slots.every((s: any) => s.available)).toBe(true)
    // No weekend
    slots.forEach((s: any) => {
      const d = new Date(s.date)
      expect([1,2,3,4,5]).toContain(d.getDay())
    })
  })

  it('should return stub slots when STUB=true or no creds', () => {
    // Pass 1 for minNoticeDays as default, which will exclude today
    const stub = getStubSlots(2, 1)
    expect(stub.length).toBeGreaterThan(0)
    expect(stub[0].available).toBeDefined()
    expect(stub[0].start).toBeDefined()
    // No event details (privacy)
    expect((stub[0] as any).title).toBeUndefined()
    expect((stub[0] as any).summary).toBeUndefined()
  })

  it('should return stub busy blocks for testing', () => {
    const busy = getStubBusyBlocks()
    expect(Array.isArray(busy)).toBe(true)
  })

  it('should normalize slot minutes to always be 60', () => {
    expect(normalizeSlotMinutes('30')).toBe(60)
    expect(normalizeSlotMinutes('15')).toBe(60)
    expect(normalizeSlotMinutes('45')).toBe(60)
    expect(normalizeSlotMinutes('60')).toBe(60)
    expect(normalizeSlotMinutes('20')).toBe(60)
    expect(normalizeSlotMinutes('50')).toBe(60)
    expect(normalizeSlotMinutes('')).toBe(60)
    expect(normalizeSlotMinutes(null as any)).toBe(60)
  })

  it('should generate 14 days from today (not full month) for calendar display', () => {
    const days = getNext14Days(0)
    expect(days.length).toBe(14)
    // getNext14Days uses local midnight; compare using local date parts to stay tz-independent
    const todayLocal = new Date()
    todayLocal.setHours(0, 0, 0, 0)
    const firstLocal = new Date(days[0])
    firstLocal.setHours(0, 0, 0, 0)
    expect(firstLocal.getTime()).toBe(todayLocal.getTime())
  })

  it('should exclude today when minNoticeDays is 1', () => {
    const days = getNext14Days(1)
    expect(days.length).toBe(14)
    const todayLocal = new Date()
    todayLocal.setHours(0, 0, 0, 0)
    const firstLocal = new Date(days[0])
    firstLocal.setHours(0, 0, 0, 0)
    expect(firstLocal.getTime()).not.toBe(todayLocal.getTime())
    // Should start from tomorrow (local)
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(firstLocal.getTime()).toBe(tomorrow.getTime())
  })

  it('should compute slots excluding today when minNoticeDays is 1', () => {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const wh = { start: '09:00', end: '10:00', days: [0,1,2,3,4,5,6], slotMinutes: 60 }

    // Using 1 week (7 days). 1h per day = 1 slot/day.
    // If we have 7 days including today (minNoticeDays=0): 7 * 1 = 7 slots.
    const slotsWithToday = computeSlots({ startDate: start, weeks: 1, workingHours: wh, busyBlocks: [], minNoticeDays: 0 })

    // If minNoticeDays is 1, we should get 6 days (start + 1 day to end) * 1 = 6 slots.

    const slotsWithoutToday = computeSlots({ startDate: start, weeks: 1, workingHours: wh, busyBlocks: [], minNoticeDays: 1 })

    // 7 total slots available in 7 days, excluding today (1st day) means 7 - 1 = 6 slots.
    expect(slotsWithToday.length).toBe(7)
    expect(slotsWithoutToday.length).toBe(6)
    expect(slotsWithoutToday.length).toBeLessThan(slotsWithToday.length)
  })
})

describe('google-calendar — getTimezoneOffsetHours (T4 general-purpose, drives every slot)', () => {
  // DST boundaries: Eastern EST UTC-5 vs EDT UTC-4, Pacific PST UTC-8 vs PDT UTC-7, UTC always 0
  it('Eastern: January (EST) offset 5, July (EDT) offset 4', () => {
    expect(getTimezoneOffsetHours('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(5)
    expect(getTimezoneOffsetHours('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(4)
  })
  it('Pacific: January (PST) offset 8, July (PDT) offset 7 — non-Eastern zone DST', () => {
    expect(getTimezoneOffsetHours('America/Los_Angeles', new Date('2026-01-15T12:00:00Z'))).toBe(8)
    expect(getTimezoneOffsetHours('America/Los_Angeles', new Date('2026-07-15T12:00:00Z'))).toBe(7)
  })
  it('Central and Mountain also cross DST', () => {
    expect(getTimezoneOffsetHours('America/Chicago', new Date('2026-01-15T12:00:00Z'))).toBe(6)
    expect(getTimezoneOffsetHours('America/Chicago', new Date('2026-07-15T12:00:00Z'))).toBe(5)
    expect(getTimezoneOffsetHours('America/Denver', new Date('2026-01-15T12:00:00Z'))).toBe(7)
    expect(getTimezoneOffsetHours('America/Denver', new Date('2026-07-15T12:00:00Z'))).toBe(6)
  })
  it('UTC always 0', () => {
    expect(getTimezoneOffsetHours('UTC', new Date('2026-01-15T12:00:00Z'))).toBe(0)
    expect(getTimezoneOffsetHours('UTC', new Date('2026-07-15T12:00:00Z'))).toBe(0)
  })
  it('wallTimeToUtcIso respects offset — 09:00 NY EST (offset 5) => 14:00 UTC, EDT (offset 4) => 13:00 UTC', () => {
    const janOff = getTimezoneOffsetHours('America/New_York', new Date('2026-01-15T12:00:00Z')) // 5
    const julOff = getTimezoneOffsetHours('America/New_York', new Date('2026-07-15T12:00:00Z')) // 4
    expect(wallTimeToUtcIso(2026, 0, 15, 9, 0, janOff)).toBe('2026-01-15T14:00:00.000Z')
    expect(wallTimeToUtcIso(2026, 6, 15, 9, 0, julOff)).toBe('2026-07-15T13:00:00.000Z')
  })
  it('Alaska and Hawaii offsets', () => {
    // Alaska: AKST UTC-9, AKDT UTC-8
    expect(getTimezoneOffsetHours('America/Anchorage', new Date('2026-01-15T12:00:00Z'))).toBe(9)
    expect(getTimezoneOffsetHours('America/Anchorage', new Date('2026-07-15T12:00:00Z'))).toBe(8)
    // Hawaii: HST UTC-10 no DST
    expect(getTimezoneOffsetHours('Pacific/Honolulu', new Date('2026-01-15T12:00:00Z'))).toBe(10)
    expect(getTimezoneOffsetHours('Pacific/Honolulu', new Date('2026-07-15T12:00:00Z'))).toBe(10)
  })
})

describe('google-calendar — computeSlotsForDay with configurable site timezone (T4)', () => {
  it('Pacific 09:00 PDT in July => 16:00 UTC (offset 7), Eastern same day => 13:00 UTC', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const ny = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 60, timeZone: 'America/New_York' } as any, [], 'America/New_York')
    const la = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 60, timeZone: 'America/Los_Angeles' } as any, [], 'America/Los_Angeles')
    expect(ny[0].start).toContain('13:00')
    expect(la[0].start).toContain('16:00')
  })
  it('January Eastern 09:00 EST => 14:00 UTC vs July EDT => 13:00 UTC (DST shift)', () => {
    const jan = new Date('2026-01-20T00:00:00Z')
    const jul = new Date('2026-07-20T00:00:00Z')
    const janSlots = computeSlotsForDay(jan, { start: '09:00', end: '10:00', slotMinutes: 60, timeZone: 'America/New_York' } as any, [], 'America/New_York')
    const julSlots = computeSlotsForDay(jul, { start: '09:00', end: '10:00', slotMinutes: 60, timeZone: 'America/New_York' } as any, [], 'America/New_York')
    expect(janSlots[0].start).toContain('14:00')
    expect(julSlots[0].start).toContain('13:00')
  })
  it('UTC zone 09:00 => 09:00 UTC same day', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const slots = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 60, timeZone: 'UTC' } as any, [], 'UTC')
    expect(slots[0].start).toBe('2026-07-20T09:00:00.000Z')
  })
  it('computeSlots propagates timezone via timeZone param (T4 precedence)', () => {
    const start = new Date('2026-07-20T00:00:00Z')
    const slots = computeSlots({
      startDate: start, weeks: 1,
      workingHours: { start: '09:00', end: '10:00', days: [1,2,3,4,5], slotMinutes: 60, timeZone: 'America/Los_Angeles' } as any,
      busyBlocks: [], minNoticeDays: -999, timeZone: 'America/Los_Angeles',
    } as any)
    // First slot should be LA 09:00 => 16:00 UTC
    expect(slots[0].start).toContain('16:00')
  })
  it('T5 empty-calendar guard: 09:30+09:45 collapsed window returns [] and logs', () => {
    // Simulates what happens if env had 09:30 and 09:45 — both snap to 09:00 in slots.ts, but lib itself sees 09:00-09:00 => []
    const date = new Date('2026-07-20T00:00:00Z')
    const slots = computeSlotsForDay(date, { start: '09:00', end: '09:00', slotMinutes: 60 } as any, [])
    expect(slots.length).toBe(0)
    // A 15-min raw window also produces no slots because slotMinutes=60 > window
    const tiny = computeSlotsForDay(date, { start: '09:30', end: '09:45', slotMinutes: 60 } as any, [])
    expect(tiny.length).toBe(0)
  })
})

