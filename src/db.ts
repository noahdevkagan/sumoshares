import type { Security, Tx, Stakeholder, StockClass, Plan } from './logic';

export type Env = {
  DB: D1Database;
  DOCS: R2Bucket;
  APP_NAME: string;
  APP_URL: string;
  ADMIN_EMAILS: string;          // comma-separated
  SESSION_SECRET: string;        // wrangler secret
  MAIL_FROM: string;
  SENDFOX_API_KEY?: string;      // wrangler secret: SendFox transactional key (without a mail key, login links are logged)
  RESEND_API_KEY?: string;       // wrangler secret (optional alternative to SendFox)
  STRIPE_SECRET_KEY?: string;    // optional: enables "Pay online"
  STRIPE_WEBHOOK_SECRET?: string;
  DEV_SHOW_LINKS?: string;       // "1" in local dev: show magic link on screen
};

export async function all<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function one<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export async function loadLedger(db: D1Database) {
  const [holders, classes, plans, secs, txs] = await Promise.all([
    all<Stakeholder>(db, 'SELECT * FROM stakeholders ORDER BY name'),
    all<StockClass>(db, 'SELECT * FROM stock_classes ORDER BY is_preferred, id'),
    all<Plan>(db, 'SELECT * FROM plans ORDER BY id'),
    all<Security>(db, 'SELECT * FROM securities ORDER BY issue_date, id'),
    all<Tx>(db, 'SELECT * FROM transactions ORDER BY effective_date, id'),
  ]);
  return { holders, classes, plans, secs, txs };
}

export async function setting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const r = await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? fallback;
}

export async function currentValuation(db: D1Database, asOf: string) {
  return one<{ id: number; effective_date: string; fmv: number; provider: string | null; expires_on: string | null }>(
    db, 'SELECT * FROM valuations WHERE effective_date <= ? ORDER BY effective_date DESC LIMIT 1', asOf);
}

export async function audit(db: D1Database, actor: string, action: string, entity: string, entityId: number | null, before: unknown, after: unknown, ip = '') {
  await run(db, 'INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json, ip) VALUES (?,?,?,?,?,?,?)',
    actor, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), ip);
}

/** Next certificate label for a class, e.g. CS-52 */
export async function nextLabel(db: D1Database, prefix: string): Promise<string> {
  const rows = await all<{ label: string }>(db, "SELECT label FROM securities WHERE label LIKE ?", prefix + '-%');
  const max = rows.reduce((m, r) => Math.max(m, Number(r.label.split('-').pop()) || 0), 0);
  return `${prefix}-${max + 1}`;
}
