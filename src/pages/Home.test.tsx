import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Home } from './Home'

const mockUseContent = vi.fn()
const mockUseCalendar = vi.fn()

vi.mock('../hooks/useContent', () => ({ useContent: (...args: any[]) => mockUseContent(...args) }))
vi.mock('../hooks/useCalendar', () => ({ useCalendar: (...args: any[]) => mockUseCalendar(...args) }))
vi.mock('../components/calendar/ManageBookings', () => ({ ManageBookings: () => null }))

describe('Home booking visibility', () => {
  const page = { id: 'home', slug: 'home', title: 'Portfolio', sort_order: 0, is_published: 1 }

  beforeEach(() => {
    mockUseCalendar.mockReturnValue({ grouped: {}, loading: false, error: null, slotMinutes: 30, excludeToday: true, refetch: vi.fn(), removeSlot: vi.fn() })
  })

  it('does not render the booking calendar when the owner hides it', () => {
    mockUseContent.mockReturnValue({ data: { page: { ...page, calendar_visible: 0, booking_cta_visible: 0 }, sections: [] }, loading: false, error: null })
    render(<Home />)
    expect(document.getElementById('calendar')).toBeNull()
    expect(screen.queryByRole('heading', { name: /book a meeting/i })).not.toBeInTheDocument()
  })

  it('renders the booking calendar when the owner shows it', () => {
    mockUseContent.mockReturnValue({ data: { page: { ...page, calendar_visible: 1, booking_cta_visible: 1 }, sections: [] }, loading: false, error: null })
    render(<Home />)
    expect(document.getElementById('calendar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /book a meeting/i })).toBeInTheDocument()
  })
})
