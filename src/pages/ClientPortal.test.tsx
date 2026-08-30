import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ClientPortal from './ClientPortal'
import * as api from '../lib/api'

vi.mock('../lib/api', () => ({
  lookupClientPortal: vi.fn(),
}))

describe('ClientPortal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset window.turnstile to undefined by default for disabled check
    delete (window as any).turnstile
    // Mock TURNSTILE_SITE_KEY to avoid local bypass dominating test assertions
    ;(window as any).TURNSTILE_SITE_KEY = 'test-site-key'
    // Mock location as non-localhost so fake-token bypass does not auto-enable button
    Object.defineProperty(window, 'location', {
      value: { hostname: 'example.com', pathname: '/client-portal', origin: 'https://example.com' } as any,
      writable: true,
    })
  })

  it('renders input and turnstile widget', () => {
    ;(window as any).turnstile = { render: vi.fn().mockReturnValue('widget-1'), reset: vi.fn() }
    render(<ClientPortal />)
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByText(/send access link/i)).toBeDefined()
    expect(document.getElementById('client-portal-turnstile-widget')).toBeDefined()
  })

  it('disables submit button without turnstile token', () => {
    // No turnstile mock, not localhost, so stays disabled
    render(<ClientPortal />)
    const button = screen.getByRole('button', { name: /send access link/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('enables submit after turnstile callback', async () => {
    let cb: (token: string) => void = () => {}
    ;(window as any).turnstile = {
      render: vi.fn().mockImplementation((_sel: string, opts: any) => {
        cb = opts.callback
        return 'widget-1'
      }),
      reset: vi.fn(),
    }
    render(<ClientPortal />)
    // Simulate Turnstile callback
    cb('test-token')
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /send access link/i }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    })
  })
})
