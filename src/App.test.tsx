import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          message: 'FanCPA API is running',
          timestamp: '2026-01-01T00:00:00.000Z',
          env: 'test',
        }),
      })
    )
  })

  it('renders hello world heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'FanCPA' })).toBeInTheDocument()
  })

  it('shows health check data', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('FanCPA API is running')).toBeInTheDocument()
    })
  })
})
