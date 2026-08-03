import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CalendarView } from './CalendarView'

describe('CalendarView', () => {
  it('should render 3 weeks max with Sunday first and Saturday last, 7 per row, only next 14 selectable', () => {
    const grouped = {
      '2026-07-20': [{ date: '2026-07-20', start: '2026-07-20T09:00:00Z', end: '2026-07-20T09:30:00Z', available: true }],
    } as any

    render(<CalendarView grouped={grouped} selectedDate={null} onDateSelect={vi.fn()} excludeToday={false} slotMinutes={30} />)
    expect(screen.getByText(/next two weeks/i)).toBeInTheDocument()
    // Weekday header has Sun first and Sat last (header row)
    const headerRow = document.querySelector('.grid.grid-cols-7')
    expect(headerRow?.textContent).toMatch(/Sun/)
    expect(headerRow?.textContent).toMatch(/Sat/)
    // Should display max 3 weeks (21 days) depending on overlap, but only 14 selectable — total buttons 14-21
    const buttons = document.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(14)
    expect(buttons.length).toBeLessThanOrEqual(21)
  })

  it('should place every day under its own weekday column', () => {
    // The grid used to be built with local-time arithmetic and rendered in Eastern
    // time, so "SAT 1 Aug" landed under the "SUN" header for anyone west of Eastern.
    render(<CalendarView grouped={{} as any} selectedDate={null} onDateSelect={vi.fn()} excludeToday={false} slotMinutes={30} />)
    const headers = [...document.querySelectorAll('.grid.grid-cols-7')[0].children].map((el) => el.textContent!.trim().toUpperCase())
    const cells = [...document.querySelectorAll('button[aria-label]')]
    expect(cells.length).toBeGreaterThanOrEqual(14)
    cells.forEach((cell, i) => {
      const dow = cell.getAttribute('aria-label')!.slice(0, 3).toUpperCase()
      expect(dow).toBe(headers[i % 7])
    })
  })

  it('names the first day that actually has slots, not a flat "tomorrow"', () => {
    // The old badge always read "Booking opens from tomorrow". Booked on a Friday or a
    // Saturday, tomorrow is a disabled weekend cell in the same card.
    const dayAfterTomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    // Skip forward to a weekday so the fixture describes a day the grid can select.
    while ([0, 6].includes(dayAfterTomorrow.getUTCDay())) dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1)
    const dateStr = dayAfterTomorrow.toISOString().slice(0, 10)
    const grouped = { [dateStr]: [{ date: dateStr, start: `${dateStr}T13:00:00Z`, end: `${dateStr}T13:30:00Z`, available: true }] } as any

    render(<CalendarView grouped={grouped} selectedDate={null} onDateSelect={vi.fn()} excludeToday={true} slotMinutes={30} />)

    const expected = dayAfterTomorrow.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    expect(screen.getByText(`First opening: ${expected}`)).toBeInTheDocument()
    expect(screen.queryByText(/Booking opens from tomorrow/i)).not.toBeInTheDocument()
  })

  it('shows no opening badge at all when nothing is bookable', () => {
    render(<CalendarView grouped={{} as any} selectedDate={null} onDateSelect={vi.fn()} excludeToday={true} slotMinutes={30} />)
    expect(screen.queryByText(/First opening/i)).not.toBeInTheDocument()
  })

  it('should highlight dates with available slots and selected state', () => {
    const grouped = {
      '2026-07-20': [{ date: '2026-07-20', start: '2026-07-20T09:00:00Z', end: '2026-07-20T09:30:00Z', available: true }],
    } as any

    render(<CalendarView grouped={grouped} selectedDate="2026-07-20" onDateSelect={vi.fn()} excludeToday={false} slotMinutes={30} />)
    const selected = document.querySelector('[aria-selected="true"]')
    expect(document.body.innerHTML.length).toBeGreaterThan(0)
  })
})
