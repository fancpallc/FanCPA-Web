import { verifyTurnstile } from "../../_lib/turnstile";
import { getTurnstileSecret } from "../../_lib/env";
import { sendClientPortalDriveEmail } from "../../_lib/email";

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Database not configured" }), { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { email, turnstileToken } = body as { email: string; turnstileToken: string };

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return new Response(JSON.stringify({ error: "Invalid email" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const result = await verifyTurnstile(turnstileToken, getTurnstileSecret(env) || env.TURNSTILE_SECRET_KEY || env.TURNSTILE_SECRET, env);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Turnstile failed" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const emailLower = email.trim().toLowerCase();
  console.log(`!!! CLIENT_PORTAL_LOOKUP_START email=${emailLower}`);

  const db = env.DB;
  const contact = await db
    .prepare("SELECT * FROM contacts WHERE email = ?")
    .bind(emailLower)
    .first();

  if (!contact) {
    console.log(`!!! CLIENT_PORTAL_NOT_FOUND email=${emailLower}`);
    return new Response(JSON.stringify({ success: true, message: "If your email exists, we sent a link" }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const driveLinks = await db
    .prepare("SELECT year, folder_url FROM client_drive_folders WHERE contact_id = ? ORDER BY year DESC")
    .bind(contact.id)
    .all();

  const links = (driveLinks.results || [])
    .map((r: any) => ({ year: r.year, url: r.folder_url }))
    .filter((l: any) => l.url);
  if (links.length) {
    console.log(`!!! CLIENT_PORTAL_FOUND_SENDING_EMAIL email=${emailLower} links=${links.length}`);
    await sendClientPortalDriveEmail({
      to: contact.email,
      firstName: contact.first_name,
      driveLinks: links,
      env,
    });
  } else {
    console.log(`!!! CLIENT_PORTAL_NO_FOLDERS email=${emailLower}`);
  }

  return new Response(JSON.stringify({ success: true, message: "If your email exists, we sent a link" }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};

