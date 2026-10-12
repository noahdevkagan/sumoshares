import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './db';
import type { Session } from './auth';
import { layout } from './views';
import type { HtmlEscapedString } from 'hono/utils/html';

export type AppEnv = { Bindings: Env; Variables: { session: Session | null } };
export type C = Context<AppEnv>;
export const newApp = () => new Hono<AppEnv>();

export function page(c: C, title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>, active?: string, adminNav?: boolean) {
  const s = c.get('session');
  return c.html(layout({ title, appName: c.env.APP_NAME, who: s?.email, admin: adminNav ?? !!s?.isAdmin, active, body }));
}

export const ip = (c: C) => c.req.header('cf-connecting-ip') || '';
export const actor = (c: C) => c.get('session')?.email || 'system';

export function requireLogin(c: C) {
  const s = c.get('session');
  return s ? null : c.redirect('/login');
}
export function requireAdmin(c: C) {
  const s = c.get('session');
  if (!s) return c.redirect('/login');
  if (!s.isAdmin) return c.text('Admins only', 403);
  return null;
}

export const int = (v: unknown) => { const n = parseInt(String(v ?? '').replace(/,/g, ''), 10); return Number.isFinite(n) ? n : NaN; };
export const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : NaN; };
export const str = (v: unknown) => String(v ?? '').trim();
export const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
