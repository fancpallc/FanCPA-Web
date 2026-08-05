import { describe, it, expect } from 'vitest'
import { computeSlotsForDay, computeSlots, parseTime, filterWorkingDays, getStubBusyBlocks, getStubSlots, normalizeSlotMinutes, parseExcludeToday, getNext14Days } from './google-calendar'

describe('google-calendar lib — slot math', () => {
  it('should parse working hours vars START/END 09:00/17:00', () => {
    expect(parseTime('09:00')).toBe(9 * 60)
    expect(parseTime('17:00')).toBe(17 * 60)
    expect(parseTime('09:30')).toBe(570)
    expect(parseTime('')).toBe(0)
  })

  it('should compute slots for day with no busy → full working hours 09-17 30min in Eastern (converted to UTC)', () => {
    const date = new Date('2026-07-20T00:00:00Z') // Monday in July — EDT UTC-4, so 09:00 ET =13:00 UTC
    const slots = computeSlotsForDay(date, { start: '09:00', end: '17:00', slotMinutes: 30 }, [])
    expect(slots.length).toBe(16)
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
    const slots = computeSlotsForDay(date, { start: '09:00', end: '12:00', slotMinutes: 30 }, busy as any)
    const available = slots.filter((s) => s.available)
    expect(available.length).toBe(4)
    // Slots are ET 09,09:30,10,10:30,11,11:30 → UTC 13,13:30,14,14:30,15,15:30 — busy 14-15 UTC removes 10:00 and 10:30 ET
    expect(slots.find((s) => s.start.includes('14:00'))?.available).toBe(false)
    expect(slots.find((s) => s.start.includes('14:30'))?.available).toBe(false)
    expect(slots.find((s) => s.start.includes('13:00'))?.available).toBe(true)
  })

  it('should handle partial overlap busy 09:15-09:45 ET (13:15-13:45 UTC) removes 09:00 and 09:30 ET slots', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const busy = [{ start: '2026-07-20T13:15:00Z', end: '2026-07-20T13:45:00Z' }]
    const slots = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 30 }, busy as any)
    expect(slots.length).toBe(2)
    expect(slots[0].available).toBe(false)
    expect(slots[1].available).toBe(false)
  })

  it('should respect working days 1-5 filter (Mon-Fri) — weekend no slots', () => {
    const monday = new Date('2026-07-20T00:00:00Z') // Monday
    const saturday = new Date('2026-07-25T00:00:00Z') // Saturday
    expect(filterWorkingDays([monday, saturday], [1,2,3,4,5]).length).toBe(1)
    expect(filterWorkingDays([monday, saturday], [1,2,3,4,5])[0].getDay()).toBe(1)
  })

  it('should handle busy all day → 0 available (Eastern 09-17 ET =13-21 UTC)', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    // 09-17 ET in July =13-21 UTC all day busy
    const busy = [{ start: '2026-07-20T13:00:00Z', end: '2026-07-20T21:00:00Z' }]
    const slots = computeSlotsForDay(date, { start: '09:00', end: '17:00', slotMinutes: 30 }, busy as any)
    expect(slots.filter((s) => s.available).length).toBe(0)
  })

  it('should handle empty busy list → full day', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const slots = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 30 }, [])
    expect(slots.filter((s) => s.available).length).toBe(2)
  })

  it('should respect slot duration variable 30 vs 60', () => {
    const date = new Date('2026-07-20T00:00:00Z')
    const slots30 = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 30 }, [])
    const slots60 = computeSlotsForDay(date, { start: '09:00', end: '10:00', slotMinutes: 60 }, [])
    expect(slots30.length).toBe(2)
    expect(slots60.length).toBe(1)
  })

  it('should compute slots for multiple days given weeks=2', () => {
    const start = new Date('2026-07-20T00:00:00Z') // Monday
    const busy: any[] = []
    const slots = computeSlots({ startDate: start, weeks: 2, workingHours: { start: '09:00', end: '10:00', days: [1,2,3,4,5], slotMinutes: 30 }, busyBlocks: busy })
    // 2 weeks Mon-Fri, 1 hour per day 2 slots per day, 10 weekdays per 2 weeks → 20 slots, but start Monday includes 2 weeks = 10 days
    expect(slots.length).toBeGreaterThanOrEqual(10)
    // All should be future or today, not past, and available
    expect(slots.every((s: any) => s.available)).toBe(true)
    // No weekend
    slots.forEach((s: any) => {
      const d = new Date(s.date)
      expect([1,2,3,4,5]).toContain(d.getDay())
    })
  })

  it('should return stub slots when STUB=true or no creds', () => {
    const stub = getStubSlots(2)
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

  it('should normalize slot minutes to multiple of 15 (configurable)', () => {
    expect(normalizeSlotMinutes('30')).toBe(30)
    expect(normalizeSlotMinutes('15')).toBe(15)
    expect(normalizeSlotMinutes('45')).toBe(45)
    expect(normalizeSlotMinutes('60')).toBe(60)
    // Non-multiple of 15 should round down to nearest multiple: 20 → 15, 50 → 45
    expect(normalizeSlotMinutes('20')).toBe(15)
    expect(normalizeSlotMinutes('50')).toBe(45)
    // Invalid defaults to 30
    expect(normalizeSlotMinutes('')).toBe(30)
    expect(normalizeSlotMinutes(null as any)).toBe(30)
  })

  it('should parse excludeToday flag (option not taking schedule today)', () => {
    expect(parseExcludeToday('true')).toBe(true)
    expect(parseExcludeToday('false')).toBe(false)
    expect(parseExcludeToday(true)).toBe(true)
    expect(parseExcludeToday(false)).toBe(false)
    expect(parseExcludeToday('1')).toBe(true)
    expect(parseExcludeToday('0')).toBe(false)
    expect(parseExcludeToday(undefined)).toBe(false)
  })

  it('should generate 14 days from today (not full month) for calendar display', () => {
    const days = getNext14Days(false)
    expect(days.length).toBe(14)
    // First day should be today (midnight)
    const todayStr = new Date().toISOString().split('T')[0]
    expect(days[0].toISOString().split('T')[0]).toBe(todayStr)
  })

  it('should exclude today when excludeToday true', () => {
    const days = getNext14Days(true)
    expect(days.length).toBe(14)
    const todayStr = new Date().toISOString().split('T')[0]
    expect(days[0].toISOString().split('T')[0]).not.toBe(todayStr)
    // Should start from tomorrow
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(days[0].toISOString().split('T')[0]).toBe(tomorrow.toISOString().split('T')[0])
  })

  it('should compute slots excluding today when excludeToday true', () => {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const wh = { start: '09:00', end: '10:00', days: [0,1,2,3,4,5,6], slotMinutes: 30 }
    const slotsWithToday = computeSlots({ startDate: start, weeks: 1, workingHours: wh, busyBlocks: [], excludeToday: false })
    const slotsWithoutToday = computeSlots({ startDate: start, weeks: 1, workingHours: wh, busyBlocks: [], excludeToday: true })
    // Without today should have fewer slots (excludes today's slots)
    // For 1 week = 7 days, with today 7*2=14 slots (1h per day 2 slots), without today 6*2=12
    expect(slotsWithoutToday.length).toBeLessThan(slotsWithToday.length)
  })
})
