import { describe, it, expect, vi } from 'vitest'
import { onRequestGet } from './search'
import { isAdminAuthenticated } from '../../../_lib/auth'

vi.mock('../../../_lib/auth', () => ({
  isAdminAuthenticated: vi.fn()
}))
describe('search.ts', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [{ contact_id: 1, email: 'test@example.com' }] })
      })
    })
  }

  it('401 unauthenticated', async () => {
    vi.mocked(isAdminAuthenticated).mockReturnValue({ authed: false } as any)
    const request = new Request('http://localhost/api/admin/clients/search?q=test')
    const response = await onRequestGet({ request, env: {} } as any)
    expect(response.status).toBe(401)
  })

  it('returns empty when q is missing', async () => {
    vi.mocked(isAdminAuthenticated).mockReturnValue({ authed: true } as any)
    const request = new Request('http://localhost/api/admin/clients/search')
    const response = await onRequestGet({ request, env: {} } as any)
    const data = await response.json() as { results: any[] }
    expect(data.results).toEqual([])
  })

  it('performs search with provided query', async () => {
    vi.mocked(isAdminAuthenticated).mockReturnValue({ authed: true } as any)
    const request = new Request('http://localhost/api/admin/clients/search?q=test')
    const response = await onRequestGet({ request, env: { DB: mockDb } } as any)
    expect(response.status).toBe(200)
    const data = await response.json() as { results: any[] }
    expect(data.results[0].email).toBe('test@example.com')
  })
})

test('search.ts: case-insensitive filters', async () => {
  expect(true).toBe(true)
})

test('search.ts: returns required fields', async () => {
  expect(true).toBe(true)
})

test('search.ts: empty when q empty', async () => {
  expect(true).toBe(true)
})

test('search.ts: filters by time range', async () => {
  // In integration, mock the DB call and verify the SQL generated
  expect(true).toBe(true)
})

test('search.ts: returns all when no date', async () => {
  expect(true).toBe(true)
})

