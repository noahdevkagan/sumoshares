import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './db';
import { one, run } from './db';

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export async function sha256(s: string) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a);
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type Session = { email: string; isAdmin: boolean; stakeholderId: number | null };

const COOKIE = 'ss_session';
const SESSION_DAYS = 14;

export const isAdminEmail = (env: Env, email: string) =>
  env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

export async function createLoginToken(env: Env, email: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await run(env.DB, 'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?,?,?)', await sha256(token), email.toLowerCase(), expires);
  return token;
}

export async function consumeLoginToken(env: Env, token: string): Promise<string | null> {
  const h = await sha256(token);
  const row = await one<{ email: string; expires_at: string; used: number }>(env.DB, 'SELECT * FROM login_tokens WHERE token_hash = ?', h);
  if (!row || row.used || row.expires_at < new Date().toISOString()) return null;
  await run(env.DB, 'UPDATE login_tokens SET used = 1 WHERE token_hash = ?', h);
  return row.email;
}

export async function startSession(c: Context<any>, email: string) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = `${email.toLowerCase()}|${exp}`;
  const sig = await hmac(c.env.SESSION_SECRET, payload);
  setCookie(c, COOKIE, `${btoa(payload)}.${sig}`, {
    httpOnly: true, secure: c.req.url.startsWith('https'), sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(c: Context) { deleteCookie(c, COOKIE, { path: '/' }); }

export async function readSession(c: Context<any>): Promise<Session | null> {
  const raw = getCookie(c, COOKIE);
  if (!raw || !raw.includes('.')) return null;
  const [p, sig] = raw.split('.');
  let payload = '';
  try { payload = atob(p); } catch { return null; }
  if (!safeEq(await hmac(c.env.SESSION_SECRET, payload), sig)) return null;
  const [email, exp] = payload.split('|');
  if (Number(exp) < Date.now()) return null;
  const sh = await one<{ id: number }>(c.env.DB, 'SELECT id FROM stakeholders WHERE lower(email) = ? ORDER BY id LIMIT 1', email);
  return { email, isAdmin: isAdminEmail(c.env, email), stakeholderId: sh?.id ?? null };
}

/** Rejects cross-site POSTs (cheap CSRF guard on top of SameSite=Lax). */
export async function sameOrigin(c: Context, next: Next) {
  if (c.req.method === 'POST' && !c.req.path.startsWith('/stripe/')) {
    const origin = c.req.header('origin');
    const host = new URL(c.req.url).host;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === host; } catch { ok = false; }
      if (!ok) return c.text('Bad origin', 403);
    }
  }
  await next();
}

export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = parts['t'];
  const v1s = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!t || !v1s.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return v1s.some((v) => safeEq(v, hex));
}
