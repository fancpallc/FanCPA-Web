import { isAdminAuthenticated } from '../../../_lib/auth'
import type { Env } from '../auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')

  if (!q) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = env.DB as any
  const sanitizedQ = q.trim().replace(/[%_]/g, '\\$&')
  const searchQuery = `%${sanitizedQ.toLowerCase()}%`

  console.log(`!!! ADMIN_SEARCH_START q=${q}`)

  const sql = `
    SELECT DISTINCT
        c.id as contact_id, 
        c.first_name, 
        c.last_name, 
        c.email, 
        b.id as booking_id, 
        b.meet_link, 
        b.purpose, 
        b.slot_start, 
        b.time_zone, 
        cdf.year, 
        cdf.folder_url as year_folder_url
    FROM contacts c 
    LEFT JOIN bookings b ON b.contact_id = c.id AND b.status = 'confirmed'
    LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id
      AND (b.slot_start IS NULL OR cdf.year = CAST(strftime('%Y', b.slot_start) AS INTEGER))
    WHERE lower(c.email) LIKE ?1 ESCAPE '\\'
       OR lower(c.first_name) LIKE ?1 ESCAPE '\\'
       OR lower(c.last_name) LIKE ?1 ESCAPE '\\'
    ORDER BY b.slot_start DESC 
    LIMIT 100
  `

  try {
    const { results } = await db.prepare(sql).bind(searchQuery).all()
    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}

