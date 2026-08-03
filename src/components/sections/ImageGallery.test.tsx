import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImageGallery } from './ImageGallery'

describe('ImageGallery', () => {
  it('should render image grid with alt text', () => {
    render(
      <ImageGallery
        section={{ id: 'sec6', type: 'image-gallery', heading: 'My Work' } as any}
        items={[
          { id: 'i1', image_url: '/img/work1.jpg', title: 'Work 1', body: 'Caption 1', sort_order: 0, is_visible: 1 } as any,
          { id: 'i2', image_url: '/img/work2.jpg', title: 'Work 2', body: 'Caption 2', sort_order: 1, is_visible: 1 } as any,
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: /My Work/ })).toBeInTheDocument()
    expect(screen.getByText(/Work 1/)).toBeInTheDocument()
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBe(2)
  })

  it('should handle empty gallery', () => {
    render(<ImageGallery section={{ id: 'sec6', type: 'image-gallery', heading: 'Gallery' } as any} items={[]} />)
    expect(screen.getByRole('heading', { name: /Gallery/ })).toBeInTheDocument()
    expect(screen.getByText(/Selected work coming soon/i)).toBeInTheDocument()
  })
})
