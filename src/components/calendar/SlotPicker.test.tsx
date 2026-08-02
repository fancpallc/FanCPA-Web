import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlotPicker } from './SlotPicker'

describe('SlotPicker', () => {
  it('should show available slots for selected date with Eastern time interval 9:00 – 9:30 AM', () => {
    // For Eastern timezone, 09:00 ET in July =13:00 UTC, so use 13:00 UTC to display as 9:00 ET
    const slots = [
      { date: '2026-07-20', start: '2026-07-20T13:00:00Z', end: '2026-07-20T13:30:00Z', available: true },
      { date: '2026-07-20', start: '2026-07-20T14:00:00Z', end: '2026-07-20T14:30:00Z', available: true },
    ] as any

    render(<SlotPicker date="2026-07-20" slots={slots} onSlotSelect={vi.fn()} slotMinutes={30} />)
    // Interval keeps a meridiem: a bare "1:00 - 1:30" in a list starting at 9:00 reads as morning.
    expect(screen.getByText(/9:00 – 9:30 AM/) || screen.getByText(/10:00 – 10:30 AM/)).toBeTruthy()
  })

  it('shows the same calendar day the visitor clicked, not the day before', () => {
    // 2026-08-03 is a Monday. Parsing it as UTC midnight and rendering in Eastern
    // used to display "Sunday, August 2" — the heading disagreed with the clicked cell.
    const slots = [
      { date: '2026-08-03', start: '2026-08-03T13:00:00Z', end: '2026-08-03T13:30:00Z', available: true },
    ] as any

    render(<SlotPicker date="2026-08-03" slots={slots} onSlotSelect={vi.fn()} slotMinutes={30} />)
    expect(screen.getByText(/Monday, August 3/)).toBeInTheDocument()
  })

  it('should show busy slots as unavailable but no event details', () => {
    const slots = [
      { date: '2026-07-20', start: '2026-07-20T13:00:00Z', end: '2026-07-20T13:30:00Z', available: false },
    ] as any

    render(<SlotPicker date="2026-07-20" slots={slots} onSlotSelect={vi.fn()} slotMinutes={30} />)
    expect(document.body.innerHTML).not.toContain('Meeting with')
    expect(document.body.innerHTML).not.toContain('Private event')
  })

  it('should show empty state when no slots today', () => {
    render(<SlotPicker date="2026-07-20" slots={[]} onSlotSelect={vi.fn()} slotMinutes={30} />)
    expect(screen.getByText(/no slots/i)).toBeInTheDocument()
  })

  it('should call onSlotSelect when clicking available slot and have close button', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const slots = [
      { date: '2026-07-20', start: '2026-07-20T13:00:00Z', end: '2026-07-20T13:30:00Z', available: true },
    ] as any

    render(<SlotPicker date="2026-07-20" slots={slots} onSlotSelect={onSelect} onClose={onClose} slotMinutes={30} />)
    // Button shows interval 9:00 – 9:30 AM (Eastern)
    const btn = screen.getByRole('button', { name: /9:00 – 9:30 AM/ })
    btn.click()
    expect(onSelect).toHaveBeenCalled()
    // Close button exists (can close modal)
    expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument()
  })

  it('should keep slot buttons compact but still tappable (px-3 text-xs, min-h-11, no scale)', () => {
    const slots = [
      { date: '2026-07-20', start: '2026-07-20T13:00:00Z', end: '2026-07-20T13:30:00Z', available: true },
    ] as any
    render(<SlotPicker date="2026-07-20" slots={slots} onSlotSelect={vi.fn()} slotMinutes={30} />)
    const btn = screen.getByRole('button', { name: /9:00 – 9:30 AM/ })
    // Compact per the original request — small text, tight horizontal padding, no
    // scale transform that would let a label overlap the border.
    expect(btn.className).toContain('px-3')
    expect(btn.className).toContain('text-xs')
    expect(btn.className).not.toContain('scale-')
    // py-2.5 rendered these 34px tall. Height now comes from min-h-11 so the target
    // clears 44px on a phone; the compactness above is unchanged.
    expect(btn.className).toContain('min-h-11')
  })
})
