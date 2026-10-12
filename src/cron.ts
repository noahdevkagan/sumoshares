import type { Env } from './db';
import { one, run, all, loadLedger, currentValuation } from './db';
import { optionBalance, optionDeadline, today, daysUntil, addMonths, fmtDate, fmtInt, fmtUsd } from './logic';
import { sendMail, adminEmails } from './mail';

const VAL_STEPS = [90, 60, 30, 7, 0];
const OPT_STEPS = [90, 30, 7];

async function once(env: Env, key: string, fn: () => Promise<unknown>) {
  if (await one(env.DB, 'SELECT 1 FROM reminders_sent WHERE key=?', key)) return false;
  await fn();
  await run(env.DB, 'INSERT INTO reminders_sent (key) VALUES (?)', key);
  return true;
}

/** Daily job: 409A reminders, option deadline reminders, auto-expire options past their deadline, nightly backup to R2. */
export async function daily(env: Env) {
  const d = today();
  const log: string[] = [];

  // 1) 409A expiry reminders to admins
  const v = await currentValuation(env.DB, d);
  if (v) {
    const exp = v.expires_on || addMonths(v.effective_date, 12);
    const left = daysUntil(exp, d);
    for (const step of VAL_STEPS) {
      if (left <= step) {
        const sent = await once(env, `409a:${v.id}:${step}`, () => sendMail(env, adminEmails(env),
          left < 0 ? `409A expired ${fmtDate(exp)}: option exercises are paused` : `409A expires in ${left} days (${fmtDate(exp)})`,
          `The current 409A (${fmtUsd(v.fmv)}/share, effective ${fmtDate(v.effective_date)}) ${left < 0 ? 'has expired' : `expires ${fmtDate(exp)}`}.\nHolders can't exercise without a current valuation. Order the new 409A and record it at ${env.APP_URL}/admin/valuations`));
        if (sent) log.push(`409a reminder ${step}`);
        break;
      }
    }
  } else {
    await once(env, `409a:none:${d.slice(0, 7)}`, () => sendMail(env, adminEmails(env), 'No 409A on file', `Record one at ${env.APP_URL}/admin/valuations`));
  }

  // 2) Option deadline reminders to holders, and expire options past their deadline
  const L = await loadLedger(env.DB);
  for (const s of L.secs.filter((x) => x.kind === 'option')) {
    const h = L.holders.find((x) => x.id === s.stakeholder_id);
    const b = optionBalance(s, L.txs, d, h?.termination_date);
    const dl = optionDeadline(s);
    if (!dl || b.outstanding <= 0) continue;
    const left = daysUntil(dl, d);
    if (left < 0) {
      await run(env.DB, `INSERT INTO transactions (security_id, type, quantity, effective_date, note, actor) VALUES (?, 'expire', ?, ?, 'deadline passed', 'system')`, s.id, b.outstanding, dl);
      await run(env.DB, `INSERT INTO audit_log (actor, action, entity, entity_id, after_json) VALUES ('system','option_expire','security',?,?)`, s.id, JSON.stringify({ quantity: b.outstanding, deadline: dl }));
      log.push(`expired ${s.label} ${b.outstanding}`);
      continue;
    }
    if (b.exercisable <= 0 || !h?.email) continue;
    for (const step of OPT_STEPS) {
      if (left <= step) {
        const sent = await once(env, `opt:${s.id}:${dl}:${step}`, () => sendMail(env, h.email!, `Your stock options expire in ${left} days`,
          `Hi ${h.name},\n\nYou have ${fmtInt(b.exercisable)} vested ${s.option_type} options (grant ${s.label}, ${fmtUsd(s.exercise_price)} each) that expire ${fmtDate(dl)}.\nAfter that date they're gone.\n\nExercise here: ${env.APP_URL}/me`));
        if (sent) log.push(`opt reminder ${s.label} ${step}`);
        break;
      }
    }
  }

  // 3) Nightly backup to R2 (kept; set an R2 lifecycle rule for retention)
  const tables = ['settings', 'stakeholders', 'stock_classes', 'plans', 'securities', 'transactions', 'exercise_requests', 'valuations', 'documents', 'audit_log'];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t] = await all(env.DB, `SELECT * FROM ${t}`);
  await env.DOCS.put(`backups/${d}.json`, JSON.stringify(dump), { httpMetadata: { contentType: 'application/json' } });
  log.push('backup');

  // 4) Weekly digest of open requests for admins (Mondays)
  if (new Date(d + 'T00:00:00Z').getUTCDay() === 1) {
    const open = await all<any>(env.DB, `SELECT reference, status, cost FROM exercise_requests WHERE status IN ('requested','paid')`);
    if (open.length) await sendMail(env, adminEmails(env), `${open.length} open exercise request(s)`, open.map((o) => `${o.reference} ${o.status} ${fmtUsd(o.cost)}`).join('\n') + `\n\n${env.APP_URL}/admin/exercises`);
  }
  return log;
}
