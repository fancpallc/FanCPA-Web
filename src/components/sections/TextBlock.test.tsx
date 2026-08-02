import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TextBlock } from './TextBlock'

describe('TextBlock / About', () => {
  it('should render photo + bio + credentials', () => {
    render(
      <TextBlock
        section={{ id: 'sec3', type: 'text-block', heading: 'About Me', subheading: 'My story' } as any}
        items={[
          {
            id: 'i1',
            body: 'I am a designer with 10 years experience',
            image_url: '/img/photo.jpg',
            title: 'Jane Doe',
            author: 'Jane — Senior Designer',
            sort_order: 0,
            is_visible: 1,
          } as any,
        ]}
      />
    )
    expect(screen.getByText(/About Me/)).toBeInTheDocument()
    expect(screen.getByText(/My story/)).toBeInTheDocument()
    expect(screen.getByText(/I am a designer/)).toBeInTheDocument()
    expect(document.querySelector('img')?.src).toContain('photo.jpg')
  })

  it('should handle no items', () => {
    render(<TextBlock section={{ id: 'sec3', type: 'text-block', heading: 'About' } as any} items={[]} />)
    expect(screen.getByRole('heading', { name: /about/i })).toBeInTheDocument()
  })
})
