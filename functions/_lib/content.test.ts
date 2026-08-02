import { describe, it, expect } from 'vitest'
import { safeParseConfig, orderBySort, filterVisible } from './content'

describe('content lib helpers', () => {
  it('should order sections by sort_order ascending', () => {
    const input = [
      { id: '2', sort_order: 20, title: 'B' },
      { id: '1', sort_order: 5, title: 'A' },
      { id: '3', sort_order: 10, title: 'C' },
    ] as any[]
    const ordered = orderBySort(input)
    expect(ordered.map((s) => s.id)).toEqual(['1', '3', '2'])
  })

  it('should filter invisible sections/items where is_visible=0', () => {
    const items = [
      { id: '1', is_visible: 1 },
      { id: '2', is_visible: 0 },
      { id: '3', is_visible: 1 },
    ] as any[]
    const filtered = filterVisible(items)
    expect(filtered.map((i) => i.id)).toEqual(['1', '3'])
  })

  it('should safeParseConfig returns {} on invalid JSON', () => {
    expect(safeParseConfig('')).toEqual({})
    expect(safeParseConfig('not-json')).toEqual({})
    expect(safeParseConfig('{"valid":true}')).toEqual({ valid: true })
    expect(safeParseConfig(null as any)).toEqual({})
    expect(safeParseConfig(undefined as any)).toEqual({})
  })

  it('should handle null/undefined input for orderBySort and filterVisible', () => {
    expect(orderBySort(null as any)).toEqual([])
    expect(orderBySort(undefined as any)).toEqual([])
    expect(filterVisible(null as any)).toEqual([])
    expect(filterVisible(undefined as any)).toEqual([])
  })
})
