import { isAdminAuthenticated } from '../../../_lib/auth'
import type { Env } from '../auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  const startDate = url.searchParams.get('start_date')
  const endDate = url.searchParams.get('end_date')

  if (!q && !startDate && !endDate) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = env.DB as any
  const binds: any[] = []
  let idx = 1
  let query = `
    SELECT 
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
    WHERE 1=1
  `

  if (q) {
    const searchQuery = `%${q.toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
    query += ` AND (lower(c.email) LIKE ?${idx} ESCAPE '\\'
       OR lower(c.first_name) LIKE ?${idx} ESCAPE '\\'
       OR lower(c.last_name) LIKE ?${idx} ESCAPE '\\')`
    binds.push(searchQuery)
    idx++
  }
  if (startDate) {
    query += ` AND datetime(b.slot_start) >= datetime(?${idx}) `
    binds.push(startDate)
    idx++
  }
  if (endDate) {
    query += ` AND datetime(b.slot_start) <= datetime(?${idx}) `
    binds.push(endDate)
    idx++
  }
  query += ` ORDER BY b.slot_start DESC LIMIT 100`

  try {
    const { results } = await db.prepare(query).bind(...binds).all()
    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}

