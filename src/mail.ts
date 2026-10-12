import type { Env } from './db';

/**
 * Sends one email. Order: Resend if RESEND_API_KEY is set; else Cloudflare Email Sending
 * (send_email binding named EMAIL, Workers Paid plan); else log it (local dev).
 */
export async function sendMail(env: Env, to: string | string[], subject: string, text: string) {
  const recipients = Array.isArray(to) ? to : [to];
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: recipients, subject, text }),
    });
    if (!r.ok) console.log('[mail] resend failed', r.status, await r.text());
    return { ok: r.ok, logged: false };
  }
  if (env.EMAIL) {
    const from = (env.MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env.MAIL_FROM).trim();
    let ok = true;
    for (const rcpt of recipients) {
      try {
        // Cloudflare Email Sending (Workers Paid): structured message to any recipient
        const res = await env.EMAIL.send({ to: rcpt, from, subject, text });
        console.log('[mail] sent via cloudflare', JSON.stringify(res ?? {}));
      } catch (e) {
        ok = false;
        console.error(`[mail] cloudflare send to ${rcpt} failed:`, (e as Error).message, JSON.stringify(e));
      }
    }
    return { ok, logged: false };
  }
  if (env.DEV_SHOW_LINKS !== '1') console.error('[mail] NO EMAIL PROVIDER CONFIGURED: message not sent', subject);
  console.log(`[mail] to=${recipients.join(',')} subject=${subject}\n${text}`);
  return { ok: true, logged: true };
}

export const adminEmails = (env: Env) => env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
