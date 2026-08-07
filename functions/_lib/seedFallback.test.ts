import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FALLBACK_SECTIONS, publicSeedFallback, fallbackAnchors } from './seedFallback'

const seedSql = readFileSync(resolve(__dirname, '../../migrations/0002_seed.sql'), 'utf8')
const hideSql = readFileSync(resolve(__dirname, '../../migrations/0004_hide_extra_sections.sql'), 'utf8')

/**
 * The fallback is a hand-maintained copy of the seed, and it drifted: it kept serving a
 * hero button labelled "Explore Services" pointing at `/#services` after the seed had
 * changed it and 0004 had hidden the services section. These are the invariants that
 * would have caught that.
 */
describe('seed fallback', () => {
  it('does not offer a link to a section it does not render', () => {
    const anchors = fallbackAnchors()
    const dead: string[] = []
    for (const section of publicSeedFallback().sections) {
      for (const item of section.items) {
        const url = item.link_url
        if (!url || !url.includes('#')) continue
        const anchor = url.slice(url.indexOf('#') + 1)
        if (!anchors.has(anchor)) dead.push(`${item.id} -> ${url}`)
      }
    }
    expect(dead).toEqual([])
  })

  it('hides exactly the section types migration 0004 hides', () => {
    // 0004: UPDATE sections SET is_visible = 0 WHERE type IN ('cards-grid', ...)
    const typesInSql = [...hideSql.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    const hiddenByMigration = new Set(typesInSql.filter((t) => FALLBACK_SECTIONS.some((s) => s.type === t)))
    expect(hiddenByMigration.size).toBeGreaterThan(0)

    for (const section of FALLBACK_SECTIONS) {
      expect(section.is_visible, `${section.type} visibility`).toBe(hiddenByMigration.has(section.type) ? 0 : 1)
    }
  })

  it('uses the same hero button label and target as the seed', () => {
    const heroInsert = seedSql.slice(seedSql.indexOf("VALUES ('item_hero_1'"))
    const heroRow = heroInsert.slice(0, heroInsert.indexOf('\n'))
    const heroItem = FALLBACK_SECTIONS.find((s) => s.type === 'hero')!.items[0]

    expect(heroRow).toContain(`'${heroItem.link_text}'`)
    expect(heroRow).toContain(`'${heroItem.link_url}'`)
  })

  it('keeps every section heading in step with the seed', () => {
    for (const section of FALLBACK_SECTIONS) {
      if (!section.heading) continue
      expect(seedSql, `heading for ${section.id}`).toContain(section.heading)
    }
  })

  it('publishes only visible sections and their visible items', () => {
    const published = publicSeedFallback()
    expect(published.sections.every((s) => s.is_visible === 1)).toBe(true)
    expect(published.sections.flatMap((s) => s.items).every((i) => i.is_visible === 1)).toBe(true)
    expect(published.sections.map((s) => s.type)).toEqual(['hero', 'text-block'])
  })

  it('gives every seeded testimonial a rating, as migration 0005 does', () => {
    const testimonials = FALLBACK_SECTIONS.find((s) => s.type === 'testimonials')!
    for (const item of testimonials.items) {
      expect(item.rating, `${item.id} rating`).toBe(5)
    }
  })
})
