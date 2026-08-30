import { ensureClientDriveFolder, extractFolderId, searchFolder, createFolder } from './google-drive'

describe('google-drive', () => {
  test('stub returns fake ids', async () => {
    const env = { ENVIRONMENT: 'local' }
    const result = await ensureClientDriveFolder(env, 'test@example.com', 2025)
    expect(result.source).toBe('stub')
    // L8 fix: email folder id stable across years so reuse can be detected
    expect(result.emailFolderId).toBe('fake-test-example-com')
    expect(result.yearFolderId).toBe('fake-test-example-com-2025')
  })

  test('extractFolderId parses drive URL', () => {
    const url = 'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0j'
    expect(extractFolderId(url)).toBe('1A2b3C4d5E6f7G8h9I0j')
  })

  test('year normalization', async () => {
    const env = { ENVIRONMENT: 'local' }
    const result = await ensureClientDriveFolder(env, 'test@example.com', '202')
    // Should default to current year; year only in yearFolderId per L8 fix
    expect(result.yearFolderId).toContain(new Date().getFullYear().toString())
    expect(result.emailFolderId).toBe('fake-test-example-com')
  })

  test('searchFolder returns null by default', async () => {
    // Pass an invalid token to simulate failure/null
    const result = await searchFolder('test', 'root', 'invalid-token')
    expect(result).toBeNull()
  })

  test('createFolder returns null by default', async () => {
    // Pass an invalid token to simulate failure/null
    const result = await createFolder('test', 'root', 'invalid-token')
    expect(result).toBeNull()
  })
})

