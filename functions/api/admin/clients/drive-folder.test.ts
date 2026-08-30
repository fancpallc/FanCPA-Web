import { describe, it, expect, vi } from 'vitest'
import { onRequestPatch } from './drive-folder'

// We need to mock the auth module because it uses global objects
vi.mock('../../../_lib/auth', () => ({
  isAdminAuthenticated: () => ({ authed: true }),
}))

const mockDb = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      first: vi.fn(),
      run: vi.fn(),
    }),
  }),
}

describe('functions/api/admin/clients/drive-folder.ts', () => {
  it('validates invalid URL', async () => {
    const request = new Request('http://localhost/api/admin/clients/drive-folder', {
      method: 'PATCH',
      body: JSON.stringify({ contact_id: '1', year: '2026', folder_url: 'invalid-url' }),
    })

    // We mock authentication internally by the function being called
    // Since we can't easily mock auth import, let's accept this limitation for now
    // and rely on manual/integration tests as suggested.

    const response = await onRequestPatch({ request, env: { DB: mockDb }, params: {} } as any)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid Drive URL')
  })
})

