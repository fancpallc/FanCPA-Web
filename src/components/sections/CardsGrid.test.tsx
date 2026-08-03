import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardsGrid } from './CardsGrid'

describe('CardsGrid', () => {
  it('should render 6 cards in responsive grid', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `item${i}`,
      section_id: 'sec2',
      title: `Service ${i + 1}`,
      body: `Description ${i + 1}`,
      icon: i % 2 === 0 ? 'star' : 'heart',
      sort_order: i,
      is_visible: 1,
    })) as any[]

    render(
      <CardsGrid
        section={{ id: 'sec2', type: 'cards-grid', heading: 'Services', subheading: 'What I do' } as any}
        items={items}
      />
    )

    expect(screen.getByRole('heading', { name: /Services/ })).toBeInTheDocument()
    expect(screen.getByText(/What I do/)).toBeInTheDocument()
    items.forEach((it) => {
      expect(screen.getByText(it.title)).toBeInTheDocument()
      expect(screen.getByText(it.body)).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Service \d/).length).toBe(6)
  })

  it('should handle empty items', () => {
    render(<CardsGrid section={{ id: 'sec2', type: 'cards-grid', heading: 'Services' } as any} items={[]} />)
    expect(screen.getByRole('heading', { name: /services/i })).toBeInTheDocument()
    expect(screen.getByText(/Services coming soon/i)).toBeInTheDocument()
  })
})
