import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useCalendar } from './useCalendar'

vi.mock('../lib/api', async (importOriginal) => {
  const orig = await importOriginal() as any
  return {
    ...orig,
    fetchSlotsFull: vi.fn(),
    fetchCalendarSlots: vi.fn(),
  }
})

import { fetchSlotsFull } from '../lib/api'

function TestComponent({ weeks = 2 }: { weeks?: number }) {
  const { slots, grouped, loading, error, slotMinutes, excludeToday } = useCalendar(weeks)
  if (loading) return <div>Loading calendar…</div>
  if (error) return <div>Error: {error}</div>
  return (
    <div>
      <div>Slots: {slots.length}</div>
      <div>Groups: {Object.keys(grouped).length}</div>
      <div>Duration: {slotMinutes}</div>
      <div>ExcludeToday: {String(excludeToday)}</div>
    </div>
  )
}

describe('useCalendar hook', () => {
  beforeEach(() => vi.resetAllMocks())

  it('should handle loading → success with slots grouped by date', async () => {
    vi.mocked(fetchSlotsFull).mockResolvedValue({
      slots: [
        { date: '2026-07-20', start: '2026-07-20T09:00:00Z', end: '2026-07-20T09:30:00Z', available: true } as any,
        { date: '2026-07-20', start: '2026-07-20T10:00:00Z', end: '2026-07-20T10:30:00Z', available: true } as any,
        { date: '2026-07-21', start: '2026-07-21T09:00:00Z', end: '2026-07-21T09:30:00Z', available: true } as any,
      ],
      weeks: 2,
      source: 'stub',
      workingHours: { slotMinutes: 30, excludeToday: false },
    } as any)

    render(<TestComponent weeks={2} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await waitFor(() => screen.getByText(/Slots: 3/))
    expect(screen.getByText(/Groups: 2/)).toBeInTheDocument()
    expect(screen.getByText(/Duration: 30/)).toBeInTheDocument()
  })

  it('should handle empty slots', async () => {
    vi.mocked(fetchSlotsFull).mockResolvedValue({
      slots: [],
      weeks: 2,
      source: 'stub',
      workingHours: { slotMinutes: 30, excludeToday: false },
    } as any)

    render(<TestComponent weeks={2} />)
    await waitFor(() => screen.getByText(/Slots: 0/))
  })

  it('should refetch on weeks change', async () => {
    vi.mocked(fetchSlotsFull).mockResolvedValue({
      slots: [],
      weeks: 1,
      source: 'stub',
      workingHours: { slotMinutes: 30, excludeToday: false },
    } as any)
    const { rerender } = render(<TestComponent weeks={1} />)
    await waitFor(() => screen.getByText(/Slots: 0/))
    rerender(<TestComponent weeks={4} />)
    await waitFor(() => {
      const calls = (fetchSlotsFull as any).mock.calls as any[]
      expect(calls.some((c: any[]) => c[0] === 4)).toBe(true)
    })
  })
})
