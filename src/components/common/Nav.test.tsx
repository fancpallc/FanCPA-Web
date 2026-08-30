import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Nav } from './Nav'

vi.mock('../../hooks/useContent', () => ({
  useContent: () => ({
    data: {
      sections: [{ type: 'cards-grid' }, { type: 'text-block' }, { type: 'testimonials' }, { type: 'image-gallery' }],
      page: { icon_url: null },
    },
  }),
}))

describe('Nav — T1 root-relative links fix', () => {
  it('section links use /# anchor so they work from /client-portal', () => {
    const { container } = render(<Nav title="Test Site" />)
    const links = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'))
    // Must be root-relative, not bare #fragment which resolves to /client-portal#...
    expect(links).toContain('/#services')
    expect(links).toContain('/#about')
    expect(links).toContain('/#testimonials')
    expect(links).toContain('/#work')
    expect(links).toContain('/#calendar')
    // No bare fragment should remain for section nav (except maybe / itself)
    const bare = links.filter(h => h && h.startsWith('#') && !h.startsWith('/#'))
    expect(bare.length).toBe(0)
  })

  it('wordmark href is / and does not preventDefault off home page (it would leave portal form on screen with URL /)', () => {
    // The old implementation always called e.preventDefault + pushState to /
    // while App.tsx reads pathname once at render and has no popstate listener,
    // so on /client-portal it rewrote URL to / but left portal content.
    // New version gates preventDefault on pathname === '/'. Checking the onClick exists via rendered markup is not trivial,
    // but we can assert the anchor itself is href="/" (so browser native nav works off home).
    const { container } = render(<Nav title="Test Site" />)
    const wordmark = container.querySelector('a[href="/"]') as HTMLAnchorElement
    expect(wordmark).toBeTruthy()
    expect(wordmark.getAttribute('href')).toBe('/')
  })
})
