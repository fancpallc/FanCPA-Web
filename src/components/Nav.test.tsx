import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Nav } from '../components/common/Nav'

describe('Nav', () => {
  beforeEach(() => {
    // Mock window.scrollTo
    window.scrollTo = vi.fn()
  })

  it('scrolls to top when site name is clicked', () => {
    render(<Nav title="FanCPA" />)
    
    const siteNameLink = screen.getByText('FanCPA')
    fireEvent.click(siteNameLink)
    
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    })
  })
})
