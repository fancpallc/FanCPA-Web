import { requireAdminAuth, isAdminAuthenticated } from '../../_lib/auth'
import { getEnvironment } from '../../_lib/env'

export interface Env {
  DB: any
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

function parseConfigSafe(configRaw: string | null): any {
  if (!configRaw) return {}
  try {
    return JSON.parse(configRaw)
  } catch {
    return {}
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const authFailure = requireAdminAuth(request, env)
  if (authFailure) {
    console.log(`!!! ADMIN_CONTENT_AUTH_FAILED status=${authFailure.status}`)
    return authFailure
  }

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  console.log(`!!! ADMIN_CONTENT_REQUEST env=${envName} email=${authResult.email} bypass=${authResult.bypass}`)

  const db = env?.DB
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: commonHeaders })
  }

  try {
    // Get home page - for admin we want all pages? Simplify to home page for portfolio
    const pageStmt = db.prepare('SELECT * FROM pages WHERE slug = ? AND is_published = 1').bind('home')
    const page = await pageStmt.first()
    if (!page) {
      return new Response(JSON.stringify({ error: 'Page not found: home' }), { status: 404, headers: commonHeaders })
    }

    // Admin view: include all sections even if is_visible=0, ordered by sort_order (for editing)
    const sectionsStmt = db.prepare('SELECT * FROM sections WHERE page_id = ? ORDER BY sort_order ASC').bind(page.id)
    const sectionsResult = await sectionsStmt.all()
    const sections = sectionsResult.results || []

    // For each section, get all items including hidden, ordered
    const sectionsWithItems = []
    for (const sec of sections) {
      const itemsStmt = db.prepare('SELECT * FROM section_items WHERE section_id = ? ORDER BY sort_order ASC').bind(sec.id)
      const itemsResult = await itemsStmt.all()
      const items = itemsResult.results || []
      sectionsWithItems.push({
        ...sec,
        config: parseConfigSafe(sec.config),
        items,
      })
    }

    console.log(`!!! ADMIN_CONTENT_SUCCESS sections=${sectionsWithItems.length} env=${envName}`)

    return new Response(
      JSON.stringify({
        page: {
          id: page.id,
          slug: page.slug,
          title: page.title,
          meta_description: page.meta_description,
          site_name: (page as any).site_name ?? null,
          footer_tagline: (page as any).footer_tagline ?? null,
        },
        sections: sectionsWithItems,
        meta: {
          env: envName,
          email: authResult.email,
          bypass: !!authResult.bypass,
          totalSections: sectionsWithItems.length,
        },
      }),
      {
        status: 200,
        headers: commonHeaders,
      }
    )
  } catch (e: any) {
    console.log(`!!! ADMIN_CONTENT_ERROR ${e?.message}`)
    const isLocalNoTable = e?.message?.includes('no such table') || e?.message?.includes('D1_ERROR')
    // Fallback for local dev when Miniflare D1 empty — return seed including hidden for admin edit
    if (isLocalNoTable) {
      console.log('!!! ADMIN_CONTENT_FALLBACK_LOCAL')
      const fallbackPage = {
        id: 'page_home',
        slug: 'home',
        title: 'Jane Doe — Designer & Developer',
        meta_description: 'Portfolio fallback',
      }
      const fallbackSections = [
        {
          id: 'sec_hero',
          page_id: 'page_home',
          type: 'hero',
          heading: 'Hi, I am Jane — Designer & Developer',
          subheading: 'Crafting brand identities',
          sort_order: 0,
          config: { theme: 'light' },
          is_visible: 1,
          items: [
            { id: 'item_hero_1', section_id: 'sec_hero', title: 'Welcome', body: 'Portfolio intro', image_url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200', sort_order: 0, is_visible: 1 },
          ],
        },
        {
          id: 'sec_services',
          page_id: 'page_home',
          type: 'cards-grid',
          heading: 'Services',
          subheading: 'What I do',
          sort_order: 1,
          config: {},
          is_visible: 1,
          items: [
            { id: 'item_svc_1', section_id: 'sec_services', title: 'Brand Strategy', body: 'Strategy', sort_order: 0, is_visible: 1 },
            { id: 'item_svc_hidden', section_id: 'sec_services', title: 'Hidden Service', body: 'Hidden', sort_order: 1, is_visible: 0 },
          ],
        },
      ]
      return new Response(
        JSON.stringify({
          page: fallbackPage,
          sections: fallbackSections,
          meta: { env: envName, email: authResult.email, bypass: !!authResult.bypass, source: 'fallback-local-no-table' },
        }),
        { status: 200, headers: commonHeaders }
      )
    }
    return new Response(JSON.stringify({ error: `Failed to fetch admin content: ${e?.message || String(e)}` }), {
      status: 500,
      headers: commonHeaders,
    })
  }
}
