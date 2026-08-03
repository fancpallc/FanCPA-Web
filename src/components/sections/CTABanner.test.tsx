import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CTABanner } from './CTABanner'

describe('CTABanner', () => {
  it('should render heading, one supporting line and the link button', () => {
    render(
      <CTABanner
        section={{ id: 'sec5', type: 'cta-banner', heading: 'Ready to start?', subheading: 'Contact me today' } as any}
        items={[
          { id: 'i1', title: 'Let’s talk', body: 'Also unused', link_url: '/#contact', link_text: 'Contact Now', sort_order: 0, is_visible: 1 } as any,
        ]}
      />
    )
    expect(screen.getByText(/Ready to start/)).toBeInTheDocument()
    expect(screen.getByText(/Contact me today/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Contact Now/ })).toHaveAttribute('href', '/#contact')
    // The banner used to stack the item's title and body under the subheading, which
    // made five near-identical lines in one box.
    expect(screen.queryByText(/Let’s talk/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Also unused/)).not.toBeInTheDocument()
  })

  it('should handle no items', () => {
    render(<CTABanner section={{ id: 'sec5', type: 'cta-banner', heading: 'CTA' } as any} items={[]} />)
    expect(screen.getByText(/CTA/)).toBeInTheDocument()
  })
})
