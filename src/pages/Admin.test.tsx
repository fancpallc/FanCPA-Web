import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Admin } from './Admin'

const mockUseAdminAuth = vi.fn()
vi.mock('../hooks/useAdminAuth', () => ({
  useAdminAuth: (...args: any[]) => mockUseAdminAuth(...args),
}))

const mockUseAdminContent = vi.fn()
vi.mock('../hooks/useAdminContent', () => ({
  useAdminContent: (...args: any[]) => mockUseAdminContent(...args),
}))

describe('Admin page — inline edit identical to landing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAdminContent.mockReturnValue({
      sections: [
        { id: 'sec1', type: 'hero', heading: 'Welcome', subheading: 'Sub', sort_order: 0, is_visible: 1, config: {}, items: [{ id: 'item1', section_id: 'sec1', title: 'Hero Title', body: 'Hero Body', image_url: '/api/images/portfolio/hero.png', sort_order: 0, is_visible: 1 }] },
      ],
      loading: false,
      error: null,
      updateSection: vi.fn(),
      updateItem: vi.fn(),
      reorderSections: vi.fn(),
      reorderItems: vi.fn(),
      refetch: vi.fn(),
    })
  })

  it('shows loading', () => {
    mockUseAdminAuth.mockReturnValue({ data: null, loading: true, error: null, isAuthed: false, isBypass: false, email: null, refetch: vi.fn() })
    render(<Admin />)
    expect(screen.getByText(/Checking admin access/i)).toBeInTheDocument()
  })

  it('shows passwordless login when not authed', () => {
    mockUseAdminAuth.mockReturnValue({ data: { authed: false, error: 'Missing JWT' }, loading: false, error: 'Missing JWT', isAuthed: false, isBypass: false, email: null, refetch: vi.fn() })
    render(<Admin />)
    expect(screen.getByText(/Sign in to edit your site/i)).toBeInTheDocument()
  })

  it('shows minimal Admin top bar when authed, no big passwordless card', () => {
    mockUseAdminAuth.mockReturnValue({ data: { authed: true, email: 'bypass@local', bypass: true, env: 'local' }, loading: false, error: null, isAuthed: true, isBypass: true, email: 'bypass@local', refetch: vi.fn() })
    render(<Admin />)
    expect(screen.getByText(/^Admin$/)).toBeInTheDocument()
    expect(screen.queryByText(/Sign in to edit your site/i)).not.toBeInTheDocument()
    expect(screen.getByText(/View site/i)).toBeInTheDocument()
  })

  it('renders almost identical to landing with current text and current image editable in-place', () => {
    mockUseAdminAuth.mockReturnValue({ data: { authed: true, email: 'admin@example.com', bypass: false, env: 'alpha' }, loading: false, error: null, isAuthed: true, isBypass: false, email: 'admin@example.com', refetch: vi.fn() })
    render(<Admin />)
    // Current text from hero heading Welcome should be visible as EditableText button
    expect(screen.getAllByText(/Welcome/).length).toBeGreaterThan(0)
    // Current body from hero item
    expect(screen.getAllByText(/Hero Body/).length).toBeGreaterThan(0)
    // In-place edit: the hero heading itself is EditableText, not separate edit card below
    // Check for hero section type badge
    expect(screen.getAllByText(/hero/i).length).toBeGreaterThan(0)
    // Hero has exactly one upload control — the large image itself, no duplicate uploader below
    expect(screen.getByRole('button', { name: /replace hero image/i })).toBeInTheDocument()
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
  })

  it('edit card not complicated — well aligned, no separate big Edit hero card', () => {
    mockUseAdminAuth.mockReturnValue({ data: { authed: true, email: 'admin@example.com', bypass: false, env: 'alpha' }, loading: false, error: null, isAuthed: true, isBypass: false, email: 'admin@example.com', refetch: vi.fn() })
    render(<Admin />)
    // Old design had big edit card with text "Edit hero — \"Hi, I am Jane — Designer & Developer\" (current)" + Heading text input — should NOT exist in new in-place design
    // New design has section itself editable, not separate card with that exact verbose header
    expect(screen.queryByText(/Edit hero — "Hi, I am Jane/)).not.toBeInTheDocument()
    // Instead, new design has minimal top bar Admin and sections themselves editable
    expect(screen.getByText(/^Admin$/)).toBeInTheDocument()
  })
})
