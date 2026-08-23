import { isAdminAuthenticated } from '../../../_lib/auth'
import { sendAdminDriveEmail } from '../../../_lib/email'
import type { Env } from '../auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { authed } = isAdminAuthenticated(request, env)
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { contact_id } = await request.json() as any
  if (!contact_id) return new Response('Missing contact_id', { status: 400 })

  const db = env.DB as any
  
  // Get future meetings
  const meetings = await db.prepare(`
    SELECT * FROM bookings 
    WHERE contact_id = ? 
    AND status = 'confirmed' 
    AND slot_start >= datetime('now')
    ORDER BY slot_start ASC
  `).bind(contact_id).all()

  // Get contact details
  const contact = await db.prepare('SELECT email, first_name FROM contacts WHERE id = ?').bind(contact_id).first()
  if (!contact) return new Response('Contact not found', { status: 404 })

  // Get latest folder
  const folder = await db.prepare(`
    SELECT * FROM client_drive_folders 
    WHERE contact_id = ? 
    ORDER BY year DESC LIMIT 1
  `).bind(contact_id).first()

  try {
    await sendAdminDriveEmail({
      to: contact.email,
      firstName: contact.first_name,
      driveLink: folder?.folder_url || 'No folder found',
      meetings: meetings.results.map((m: any) => m.slot_start),
      env
    })
    
    return new Response(JSON.stringify({ success: true }))
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}

