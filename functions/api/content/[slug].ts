import { safeParseConfig, orderBySort, filterVisible, type Page, type Section, type SectionItem } from '../../_lib/content'
import { publicSeedFallback } from '../../_lib/seedFallback'

export interface Env {
  DB?: {
    prepare: (sql: string) => {
      bind: (...args: any[]) => { first: () => Promise<any>; all: () => Promise<{ results: any[] }> }
      first: () => Promise<any>
      all: () => Promise<{ results: any[] }>
    }
  }
  ENVIRONMENT?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const slug = (params?.slug as string) || ''
  const db = env?.DB

  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    // Fetch page
    const pageStmt = db.prepare('SELECT * FROM pages WHERE slug = ?1 AND is_published = 1 LIMIT 1')
    const page = (await pageStmt.bind(slug).first()) as Page | null

    if (!page) {
      return new Response(JSON.stringify({ error: 'Page not found', slug }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      })
    }

    // Fetch sections for this page
    const sectionsStmt = db.prepare('SELECT * FROM sections WHERE page_id = ?1 ORDER BY sort_order ASC')
    const sectionsResult = await sectionsStmt.bind(page.id).all()
    const rawSections = sectionsResult.results as any[]

    // Filter visible and order (SQL already orders, but apply lib logic for safety)
    const visibleSections = filterVisible(rawSections)
    const orderedSections = orderBySort(visibleSections)

    // For each section, fetch items
    const sectionsWithItems: Section[] = []
    for (const sec of orderedSections) {
      const itemsStmt = db.prepare('SELECT * FROM section_items WHERE section_id = ?1 ORDER BY sort_order ASC')
      const itemsResult = await itemsStmt.bind(sec.id).all()
      const rawItems = itemsResult.results as any[]
      const visibleItems = filterVisible(rawItems)
      const orderedItems = orderBySort(visibleItems)

      sectionsWithItems.push({
        id: sec.id,
        page_id: sec.page_id,
        type: sec.type,
        heading: sec.heading,
        subheading: sec.subheading,
        sort_order: sec.sort_order,
        config: safeParseConfig(sec.config),
        is_visible: sec.is_visible,
        items: orderedItems as SectionItem[],
      })
    }

    const responseBody = {
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        meta_description: page.meta_description,
        // Drives the header wordmark and the footer blurb. Hardcoded as "Portfolio"
        // in three components until the owner was given a field for it.
        site_name: (page as any).site_name ?? null,
        footer_tagline: (page as any).footer_tagline ?? null,
        sort_order: page.sort_order,
        is_published: page.is_published,
      },
      sections: sectionsWithItems,
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // 5-min cache per design doc 6.1 / 9.1 — 5-min TTL for content
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Source': 'd1',
      },
    })
  } catch (e: any) {
    const isLocalNoTable =
      e?.message?.includes('no such table') || e?.message?.includes('D1_ERROR')
    // Fallback for local dev when Miniflare D1 empty (pages dev persistence quirk) — return seed same as 0002_seed.sql
    // Remote will have real D1 via --remote migrations, so fallback only for local
    if (isLocalNoTable && slug === 'home') {
      // Kept in functions/_lib/seedFallback.ts so it can be diffed against the migrations
      // by a test — as an inline literal it silently drifted out of step with the seed.
      const fallback = publicSeedFallback()
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Source': 'fallback-local-no-table',
        },
      })
    }

    return new Response(JSON.stringify({ error: 'Failed to fetch content', message: e?.message || String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
