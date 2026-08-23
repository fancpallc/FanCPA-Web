import { verifyTurnstile } from "../../_lib/turnstile";
import { sendClientPortalDriveEmail } from "../../_lib/email";
export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const { email, turnstileToken } = (await request.json()) as { email: string; turnstileToken: string };

  const isTurnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET);
  if (!isTurnstileValid) {
    return new Response(JSON.stringify({ error: "Invalid Turnstile token" }), { status: 400 });
  }

  const db = env.DB;
  const emailLower = email.toLowerCase();

  const contact = await db
    .prepare("SELECT * FROM contacts WHERE email = ?")
    .bind(emailLower)
    .first();

  if (!contact) {
    return new Response(JSON.stringify({ success: true, message: "If your email exists, we sent a link" }));
  }

  const driveLinks = await db
    .prepare("SELECT year, folder_url FROM client_drive_folders WHERE contact_id = ? ORDER BY year DESC")
    .bind(contact.id)
    .all();

  if (driveLinks.results.length) {
    await sendClientPortalDriveEmail({
      to: contact.email,
      firstName: contact.first_name,
      driveLinks: driveLinks.results,
      env
    });
  }

  return new Response(JSON.stringify({ success: true, message: "If your email exists, we sent a link" }));
};

