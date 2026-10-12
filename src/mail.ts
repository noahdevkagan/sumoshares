import type { Env } from './db';

/**
 * Sends one email. Order: SendFox transactional if SENDFOX_API_KEY is set; else Resend if
 * RESEND_API_KEY is set; else log it (local dev).
 */
export async function sendMail(env: Env, to: string | string[], subject: string, text: string) {
  const recipients = Array.isArray(to) ? to : [to];
  if (env.SENDFOX_API_KEY) {
    // SendFox takes up to 5 recipients per message; admin lists are small but chunk anyway
    let ok = true;
    for (let i = 0; i < recipients.length; i += 5) {
      const r = await fetch('https://api.sendfox.com/transactional/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SENDFOX_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: recipients.slice(i, i + 5), subject, text, tag: 'sumoshares' }),
      });
      if (!r.ok) { ok = false; console.error('[mail] sendfox failed', r.status, await r.text()); }
      else console.log('[mail] sent via sendfox', await r.text());
    }
    return { ok, logged: false };
  }
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: recipients, subject, text }),
    });
    if (!r.ok) console.log('[mail] resend failed', r.status, await r.text());
    return { ok: r.ok, logged: false };
  }
  if (env.DEV_SHOW_LINKS !== '1') console.error('[mail] NO EMAIL PROVIDER CONFIGURED: message not sent', subject);
  console.log(`[mail] to=${recipients.join(',')} subject=${subject}\n${text}`);
  return { ok: true, logged: true };
}

export const adminEmails = (env: Env) => env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
