import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useContent } from './useContent'

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal() as any
  return {
    ...original,
    fetchContent: vi.fn(),
  }
})

import { fetchContent } from '../lib/api'

function TestComponent({ slug }: { slug: string }) {
  const { data, loading, error } = useContent(slug)
  if (loading) return <div>Loading content…</div>
  if (error) return <div>Error: {error}</div>
  if (!data) return <div>No data</div>
  return <div>Loaded: {data.page.title} with {data.sections.length} sections</div>
}

describe('useContent hook', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('should handle loading → success', async () => {
    vi.mocked(fetchContent).mockResolvedValue({
      page: { id: '1', slug: 'home', title: 'Portfolio', sort_order: 0, is_published: 1 },
      sections: [
        { id: 'sec1', page_id: '1', type: 'hero', heading: 'Hi', sort_order: 0, is_visible: 1, items: [] } as any,
      ],
    } as any)

    render(<TestComponent slug="home" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await waitFor(() => screen.getByText(/loaded:/i))
    expect(screen.getByText(/portfolio/i)).toBeInTheDocument()
    expect(screen.getByText(/1 sections/i)).toBeInTheDocument()
  })

  it('should handle error', async () => {
    vi.mocked(fetchContent).mockRejectedValue(new Error('Network failed'))

    render(<TestComponent slug="home" />)
    await waitFor(() => screen.getByText(/error/i))
    expect(screen.getByText(/network failed/i)).toBeInTheDocument()
  })

  it('should handle empty sections', async () => {
    vi.mocked(fetchContent).mockResolvedValue({
      page: { id: '1', slug: 'home', title: 'Empty', sort_order: 0, is_published: 1 },
      sections: [],
    } as any)

    render(<TestComponent slug="home" />)
    await waitFor(() => screen.getByText(/loaded:/i))
    expect(screen.getByText(/0 sections/i)).toBeInTheDocument()
  })

  it('should refetch on slug change', async () => {
    const mock1 = {
      page: { id: '1', slug: 'home', title: 'Home', sort_order: 0, is_published: 1 },
      sections: [],
    }
    const mock2 = {
      page: { id: '2', slug: 'about', title: 'About', sort_order: 0, is_published: 1 },
      sections: [],
    }
    vi.mocked(fetchContent)
      .mockResolvedValueOnce(mock1 as any)
      .mockResolvedValueOnce(mock2 as any)

    const { rerender } = render(<TestComponent slug="home" />)
    await waitFor(() => screen.getByText(/home/i))
    rerender(<TestComponent slug="about" />)
    await waitFor(() => screen.getByText(/about/i))
    // fetchContent called with (slug, options?) — second arg may be undefined
    const calls = (fetchContent as any).mock.calls as any[]
    expect(calls.some((c: any[]) => c[0] === 'about')).toBe(true)
  })
})
