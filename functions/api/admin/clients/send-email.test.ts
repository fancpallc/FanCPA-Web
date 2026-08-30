import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from './send-email'

vi.mock('../../../_lib/auth', () => ({ isAdminAuthenticated: () => ({ authed: true }) }))
vi.mock('../../../_lib/email', () => ({ sendAdminDriveEmail: vi.fn() }))

describe('send-email.ts', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null)
      })
    })
  }

  it('404 if contact not found', async () => {
    const request = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'non-existent' })
    })
    const response = await onRequestPost({ request, env: { DB: mockDb } } as any)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Contact not found')
  })
})

