import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroSection } from './HeroSection'

describe('HeroSection', () => {
  it('should render title, body, CTA link, background image', () => {
    render(
      <HeroSection
        section={{
          id: 'sec1',
          type: 'hero',
          heading: 'Hi, I am Jane',
          subheading: 'Designer & Developer',
          config: { background: 'light' },
        } as any}
        items={[
          {
            id: 'i1',
            section_id: 'sec1',
            title: 'Welcome',
            body: 'I craft beautiful experiences',
            image_url: '/img/hero.jpg',
            link_url: '/#contact',
            link_text: 'Get Started',
            sort_order: 0,
            is_visible: 1,
          } as any,
        ]}
      />
    )
    expect(screen.getByText(/Hi, I am Jane/)).toBeInTheDocument()
    expect(screen.getByText(/Designer & Developer/)).toBeInTheDocument()
    expect(screen.getByText(/I craft beautiful experiences/)).toBeInTheDocument()
    expect(screen.getByText(/Get Started/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Get Started/ })).toHaveAttribute('href', '/#contact')
    expect(document.querySelector('img')?.src).toContain('hero.jpg')
  })

  it('should not crash when image missing', () => {
    render(
      <HeroSection
        section={{ id: 'sec1', type: 'hero', heading: 'Title' } as any}
        items={[{ id: 'i1', title: 'T', body: 'B', sort_order: 0, is_visible: 1 } as any]}
      />
    )
    expect(screen.getByText(/Title/)).toBeInTheDocument()
  })
})
