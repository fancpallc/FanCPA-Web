import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAdminAuth } from './useAdminAuth'

const mockFetchAdminAuth = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<any>('../lib/api')
  return {
    ...actual,
    fetchAdminAuth: (...args: any[]) => mockFetchAdminAuth(...args),
  }
})

describe('useAdminAuth hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns authed true when API returns bypass', async () => {
    mockFetchAdminAuth.mockResolvedValue({
      authed: true,
      email: 'bypass@local',
      bypass: true,
      env: 'local',
    })

    const { result } = renderHook(() => useAdminAuth())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isAuthed).toBe(true)
    expect(result.current.isBypass).toBe(true)
    expect(result.current.email).toBe('bypass@local')
  })

  it('returns authed true with email when valid JWT', async () => {
    mockFetchAdminAuth.mockResolvedValue({
      authed: true,
      email: 'admin@example.com',
      bypass: false,
      env: 'production',
    })

    const { result } = renderHook(() => useAdminAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isAuthed).toBe(true)
    expect(result.current.email).toBe('admin@example.com')
    expect(result.current.isBypass).toBe(false)
  })

  it('returns not authed when API returns 401 body (ApiError simulation)', async () => {
    const err = new Error('Unauthorized') as any
    err.body = { authed: false, error: 'Missing Cloudflare Access JWT' }
    err.status = 401
    mockFetchAdminAuth.mockRejectedValue(err)

    const { result } = renderHook(() => useAdminAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isAuthed).toBe(false)
    expect(result.current.data?.authed).toBe(false)
  })

  it('handles network error', async () => {
    mockFetchAdminAuth.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useAdminAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isAuthed).toBe(false)
    expect(result.current.error).toMatch(/Network/)
  })
})
