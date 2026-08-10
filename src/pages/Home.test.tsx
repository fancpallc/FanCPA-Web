import { render, screen, fireEvent } from '@testing-library/react'
import { Home } from './Home'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../hooks/useContent', () => ({
  useContent: () => ({ data: { sections: [], page: { is_calendar_visible: true } } })
}))

vi.mock('../hooks/useCalendar', () => ({
  useCalendar: () => ({ grouped: {}, loading: false, error: null, refetch: vi.fn(), removeSlot: vi.fn() })
}))

describe('Home Page Calendar Section', () => {
  it('should render the show/hide calendar button', () => {
    render(<Home />)
    const button = screen.getByText(/Show Calendar/i)
    expect(button).toBeDefined()
    
    fireEvent.click(button)
    expect(screen.getByText(/Hide Calendar/i)).toBeDefined()

    // Check for up/down buttons
    expect(screen.getByText('▲')).toBeDefined()
    expect(screen.getByText('▼')).toBeDefined()
  })
})

