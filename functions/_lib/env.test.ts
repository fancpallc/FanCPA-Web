import { describe, it, expect } from 'vitest'
import { getEnvironment, isPreview, isAlpha, isProduction, isLocal, getDriveRootFolderId, getEffectiveDriveRootFolderId, getDriveServiceKey } from './env'

describe('env helpers', () => {
  it('should return production when ENVIRONMENT=production', () => {
    expect(getEnvironment({ ENVIRONMENT: 'production' })).toBe('production')
  })

  it('should return alpha when ENVIRONMENT=alpha', () => {
    expect(getEnvironment({ ENVIRONMENT: 'alpha' })).toBe('alpha')
  })

  it('should return preview when ENVIRONMENT=preview', () => {
    expect(getEnvironment({ ENVIRONMENT: 'preview' })).toBe('preview')
  })

  it('should return local when ENVIRONMENT=local', () => {
    expect(getEnvironment({ ENVIRONMENT: 'local' })).toBe('local')
  })

  it('should return test when ENVIRONMENT=test', () => {
    expect(getEnvironment({ ENVIRONMENT: 'test' })).toBe('test')
  })

  it('should default to production when ENVIRONMENT missing', () => {
    expect(getEnvironment({})).toBe('production')
    expect(getEnvironment(undefined as any)).toBe('production')
  })

  it('isPreview should be true only for preview', () => {
    expect(isPreview('preview')).toBe(true)
    expect(isPreview('production')).toBe(false)
    expect(isPreview('alpha')).toBe(false)
  })

  it('isAlpha should be true only for alpha', () => {
    expect(isAlpha('alpha')).toBe(true)
    expect(isAlpha('production')).toBe(false)
    expect(isAlpha('preview')).toBe(false)
  })

  it('isProduction should be true only for production', () => {
    expect(isProduction('production')).toBe(true)
    expect(isProduction('alpha')).toBe(false)
    expect(isProduction('preview')).toBe(false)
  })

  it('isLocal should be true for local and test', () => {
    expect(isLocal('local')).toBe(true)
    expect(isLocal('test')).toBe(true)
    expect(isLocal('production')).toBe(false)
  })

  describe('drive root alias', () => {
    it('should resolve drive root folder from aliases', () => {
        expect(getDriveRootFolderId({ GOOGLE_DRIVE_ROOT_FOLDER_ID: '123' })).toBe('123')
        expect(getDriveRootFolderId({ DRIVE_ROOT_FOLDER_ID: '456' })).toBe('456')
    })
    it('should resolve from db fallback if present', async () => {
      const mockDb = { prepare: () => ({ first: () => ({ value: 'db-val' }) }) }
        expect(await getEffectiveDriveRootFolderId({}, mockDb)).toBe('db-val')
    })
    it('should resolve drive service key from aliases', () => {
      expect(getDriveServiceKey({ GCAL_SERVICE_ACCOUNT_KEY: 'k' })).toBe('k')
      expect(getDriveServiceKey({ DRIVE_SERVICE_ACCOUNT_KEY: 'k2' })).toBe('k2')
    })
  })
})

