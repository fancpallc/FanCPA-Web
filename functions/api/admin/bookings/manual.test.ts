import { describe, it, expect, vi } from 'vitest'
import { onRequestPost } from './manual'

describe('Manual Booking API', () => {
  it('should be 401 without auth', async () => {
    // Mock the request and env
    const request = new Request('http://localhost/api/admin/bookings/manual', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' })
    })
    const env = { 
        DB: { prepare: () => ({ bind: () => ({ first: () => null }) }) },
    }
    // Need to mock auth import but it's hard with vitest in this env. 
    // Simplified testing or just trust the logic.
    const res = await onRequestPost({ request, env } as any)
    expect(res.status).toBe(401)
  })
})

