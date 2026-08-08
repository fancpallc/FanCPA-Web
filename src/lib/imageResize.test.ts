import { describe, expect, it } from 'vitest'
import { getResizeDimensions } from './imageResize'

describe('getResizeDimensions', () => {
  it('tries a small requested dimension for site icons', () => {
    expect(getResizeDimensions(128)).toEqual([128])
  })

  it('keeps the normal photo fallback dimensions', () => {
    expect(getResizeDimensions(1200)).toEqual([1200, 1000, 800, 600])
  })
})
