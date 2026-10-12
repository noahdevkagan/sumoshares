import { html } from './views';
import { newApp, page, requireAdmin, dateOk, type C } from './app';
import { all, loadLedger, currentValuation } from './db';
import { buildCapTable, optionBalance, optionDeadline, shareOutstanding, today, fmtDate } from './logic';

export const reports = newApp();
reports.use('/admin/reports*', async (c, next) => { const r = requireAdmin(c as C); if (r) return r; await next(); });

function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
const send = (c: C, name: string, body: string, type = 'text/csv') =>
  new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${name}"` } });

reports.get('/admin/reports', (c) => page(c, 'Reports', html`<h1>Reports and exports</h1><div class="card">
  ${[
    ['captable.csv', 'Cap table by holder (add ?asof=YYYY-MM-DD for any date)'],
    ['holders.csv', 'Holders with contact info'],
    ['securities.csv', 'Securities ledger (every certificate and grant)'],
    ['options.csv', 'Options outstanding with vesting and deadlines'],
    ['exercises.csv', 'Exercises by date with FMV (inputs for Form 3921 and NSO payroll)'],
    ['transactions.csv', 'All ledger transactions'],
    ['audit.csv', 'Audit log'],
    ['ocf.json', 'Open Cap Table Format export (portable to Carta, Cake, Pulley, lawyers)'],
    ['backup.json', 'Full database backup'],
  ].map(([f, l]) => html`<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${l}</span><a class="btn sm" href="/admin/reports/${f}">${f}</a></div>`)}</div>`, '/admin/reports'));

reports.get('/admin/reports/captable.csv', async (c) => {
  const asOf = dateOk(c.req.query('asof') || '') ? c.req.query('asof')! : today();
  const L = await loadLedger(c.env.DB);
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs, asOf);
  const rows: any[][] = [[`Cap table as of ${asOf}`], ['Holder', 'Relationship', 'Shares (as converted)', 'Options outstanding', 'Options vested', 'Fully diluted', '% fully diluted']];
  cap.byHolder.forEach((r) => rows.push([r.holder.name, r.holder.relationship, r.shares, r.optionsOutstanding, r.optionsVested, r.fd, (r.pct * 100).toFixed(4)]));
  cap.plans.forEach((p) => rows.push([`${p.plan.name}: available for grant`, '', '', '', '', p.available, ((p.available / cap.fullyDiluted) * 100).toFixed(4)]));
  rows.push(['Total', '', '', '', '', cap.fullyDiluted, '100']);
  rows.push([]); rows.push(['Class', 'Outstanding']);
  cap.classes.forEach((r) => rows.push([r.cls.name, r.outstanding]));
  cap.plans.forEach((p) => rows.push([`${p.plan.name} options outstanding`, p.outstanding], [`${p.plan.name} exercised to date`, p.exercised], [`${p.plan.name} available`, p.available]));
  return send(c, `captable-${asOf}.csv`, csv(rows));
});

reports.get('/admin/reports/holders.csv', async (c) => {
  const L = await loadLedger(c.env.DB);
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs);
  const by = new Map(cap.byHolder.map((r) => [r.holder.id, r]));
  const rows: any[][] = [['ID', 'Name', 'Email', 'Relationship', 'Termination date', 'Address', 'Shares', 'Options outstanding', 'Options vested', '% fully diluted', 'Next option deadline']];
  L.holders.forEach((h) => { const r = by.get(h.id); rows.push([h.id, h.name, h.email, h.relationship, h.termination_date, h.address, r?.shares ?? 0, r?.optionsOutstanding ?? 0, r?.optionsVested ?? 0, r ? (r.pct * 100).toFixed(4) : '0', r?.deadline]); });
  return send(c, 'holders.csv', csv(rows));
});

reports.get('/admin/reports/securities.csv', async (c) => {
  const L = await loadLedger(c.env.DB);
  const rows: any[][] = [['Label', 'Kind', 'Holder', 'Class / Type', 'Quantity', 'Outstanding', 'Price paid', 'Exercise price', 'Issue date', 'Status', 'Expiration', 'Exercise deadline', 'Notes']];
  L.secs.forEach((s) => {
    const h = L.holders.find((x) => x.id === s.stakeholder_id);
    const cls = L.classes.find((k) => k.id === s.class_id);
    const out = s.kind === 'share' ? shareOutstanding(s, L.txs) : optionBalance(s, L.txs, today(), h?.termination_date).outstanding;
    rows.push([s.label, s.kind, h?.name, s.kind === 'share' ? cls?.name : s.option_type, s.quantity, out, s.price, s.exercise_price, s.issue_date, s.kind === 'share' ? (out ? 'outstanding' : s.status) : (out ? 'outstanding' : 'closed'), s.expiration_date, s.exercise_deadline, s.notes]);
  });
  return send(c, 'securities.csv', csv(rows));
});

reports.get('/admin/reports/options.csv', async (c) => {
  const L = await loadLedger(c.env.DB);
  const rows: any[][] = [['Grant', 'Holder', 'Email', 'Type', 'Grant date', 'Exercise price', 'Granted', 'Vested', 'Exercised', 'Forfeited/expired/canceled', 'Outstanding', 'Exercisable', 'Vesting', 'Deadline']];
  L.secs.filter((s) => s.kind === 'option').forEach((s) => {
    const h = L.holders.find((x) => x.id === s.stakeholder_id);
    const b = optionBalance(s, L.txs, today(), h?.termination_date);
    rows.push([s.label, h?.name, h?.email, s.option_type, s.issue_date, s.exercise_price, b.granted, b.vested, b.exercised, b.forfeited + b.expired + b.canceled, b.outstanding, b.exercisable, s.vest_months ? `${s.vest_months}m / ${s.cliff_months || 0}m cliff from ${s.vest_start}` : 'custom/imported', optionDeadline(s)]);
  });
  return send(c, 'options.csv', csv(rows));
});

reports.get('/admin/reports/exercises.csv', async (c) => {
  const rows = await all<any>(c.env.DB, `SELECT t.effective_date, st.name, st.email, st.address, s.label grant_label, s.option_type, s.issue_date grant_date, t.quantity, t.price, t.fmv, r.label certificate FROM transactions t JOIN securities s ON s.id=t.security_id JOIN stakeholders st ON st.id=s.stakeholder_id LEFT JOIN securities r ON r.id=t.resulting_security_id WHERE t.type='exercise' ORDER BY t.effective_date`);
  const out: any[][] = [['Exercise date', 'Holder', 'Email', 'Address', 'Grant', 'Type', 'Grant date', 'Shares', 'Exercise price per share', 'FMV per share on exercise date', 'Total paid', 'Spread', 'Certificate', 'Tax year']];
  rows.forEach((r) => out.push([r.effective_date, r.name, r.email, r.address, r.grant_label, r.option_type, r.grant_date, r.quantity, r.price, r.fmv, ((r.price || 0) * r.quantity).toFixed(2), r.fmv != null ? Math.max(0, (r.fmv - (r.price || 0)) * r.quantity).toFixed(2) : '', r.certificate, String(r.effective_date).slice(0, 4)]));
  return send(c, 'exercises.csv', csv(out));
});

reports.get('/admin/reports/transactions.csv', async (c) => {
  const rows = await all<any>(c.env.DB, `SELECT t.*, s.label FROM transactions t JOIN securities s ON s.id=t.security_id ORDER BY t.effective_date, t.id`);
  const out: any[][] = [['ID', 'Security', 'Type', 'Quantity', 'Price', 'FMV', 'Effective date', 'Resulting security ID', 'Note', 'By', 'Recorded']];
  rows.forEach((r) => out.push([r.id, r.label, r.type, r.quantity, r.price, r.fmv, r.effective_date, r.resulting_security_id, r.note, r.actor, r.created_at]));
  return send(c, 'transactions.csv', csv(out));
});

reports.get('/admin/reports/audit.csv', async (c) => {
  const rows = await all<any>(c.env.DB, 'SELECT * FROM audit_log ORDER BY id');
  const out: any[][] = [['ID', 'When (UTC)', 'Who', 'Action', 'Entity', 'Entity ID', 'Before', 'After', 'IP']];
  rows.forEach((r) => out.push([r.id, r.at, r.actor, r.action, r.entity, r.entity_id, r.before_json, r.after_json, r.ip]));
  return send(c, 'audit.csv', csv(out));
});

/** Simplified Open Cap Table Format (OCF) export: manifest + objects. */
reports.get('/admin/reports/ocf.json', async (c) => {
  const L = await loadLedger(c.env.DB);
  const v = await all<any>(c.env.DB, 'SELECT * FROM valuations ORDER BY effective_date');
  const company = (await all<any>(c.env.DB, `SELECT value FROM settings WHERE key='company_legal_name'`))[0]?.value || c.env.APP_NAME;
  const objs: any[] = [];
  L.holders.forEach((h) => objs.push({ object_type: 'STAKEHOLDER', id: `sh-${h.id}`, name: { legal_name: h.name }, stakeholder_type: /investor/i.test(h.relationship || '') ? 'INSTITUTION' : 'INDIVIDUAL', current_relationship: (h.relationship || 'OTHER').toUpperCase().replace(/-/g, '_'), contact_info: { emails: h.email ? [{ email_address: h.email, email_type: 'PERSONAL' }] : [] } }));
  L.classes.forEach((k) => objs.push({ object_type: 'STOCK_CLASS', id: `sc-${k.id}`, name: k.name, class_type: k.is_preferred ? 'PREFERRED' : 'COMMON', default_id_prefix: k.prefix, initial_shares_authorized: String(k.authorized ?? ''), votes_per_share: '1', seniority: k.is_preferred ? 2 : 1, conversion_rights: k.is_preferred ? [{ conversion_mechanism: { type: 'RATIO_CONVERSION', ratio: { numerator: String(k.conversion_ratio), denominator: '1' } } }] : [] }));
  L.plans.forEach((p) => objs.push({ object_type: 'STOCK_PLAN', id: `sp-${p.id}`, plan_name: p.name, initial_shares_reserved: String(p.reserved), board_approval_date: p.board_approval_date, stock_class_ids: p.class_id ? [`sc-${p.class_id}`] : [] }));
  v.forEach((x) => objs.push({ object_type: 'VALUATION', id: `val-${x.id}`, provider: x.provider, price_per_share: { amount: String(x.fmv), currency: 'USD' }, effective_date: x.effective_date, valuation_type: '409A', stock_class_id: `sc-${L.classes.find((k) => !k.is_preferred)?.id}` }));
  L.secs.forEach((s) => {
    if (s.kind === 'share') objs.push({ object_type: 'TX_STOCK_ISSUANCE', id: `iss-${s.id}`, security_id: s.label, custom_id: s.label, date: s.issue_date, stakeholder_id: `sh-${s.stakeholder_id}`, stock_class_id: `sc-${s.class_id}`, quantity: String(s.quantity), share_price: { amount: String(s.price ?? 0), currency: 'USD' }, security_law_exemptions: [] });
    else objs.push({ object_type: 'TX_EQUITY_COMPENSATION_ISSUANCE', id: `iss-${s.id}`, security_id: s.label, custom_id: s.label, date: s.issue_date, stakeholder_id: `sh-${s.stakeholder_id}`, stock_plan_id: `sp-${s.plan_id}`, compensation_type: s.option_type === 'ISO' ? 'OPTION_ISO' : 'OPTION_NSO', quantity: String(s.quantity), exercise_price: { amount: String(s.exercise_price), currency: 'USD' }, expiration_date: s.expiration_date, termination_exercise_windows: [], vestings: s.vest_months ? [{ date: s.vest_start, amount: '0' }] : [], security_law_exemptions: [] });
  });
  const typeMap: Record<string, string> = { exercise: 'TX_EQUITY_COMPENSATION_EXERCISE', forfeit: 'TX_EQUITY_COMPENSATION_CANCELLATION', cancel: 'TX_EQUITY_COMPENSATION_CANCELLATION', expire: 'TX_EQUITY_COMPENSATION_CANCELLATION', repurchase: 'TX_STOCK_REPURCHASE', transfer: 'TX_STOCK_TRANSFER' };
  L.txs.filter((t) => t.type !== 'issue').forEach((t) => {
    const s = L.secs.find((x) => x.id === t.security_id)!;
    const res = L.secs.find((x) => x.id === t.resulting_security_id);
    const type = s.kind === 'share' && t.type === 'cancel' ? 'TX_STOCK_CANCELLATION' : typeMap[t.type];
    objs.push({ object_type: type, id: `tx-${t.id}`, security_id: s.label, date: t.effective_date, quantity: String(t.quantity), reason_text: t.note || t.type, resulting_security_ids: res ? [res.label] : [], ...(t.price != null ? { price: { amount: String(t.price), currency: 'USD' } } : {}) });
  });
  const doc = { file_type: 'OCF_MANIFEST_FILE', ocf_version: '1.2.0', issuer: { object_type: 'ISSUER', id: 'issuer', legal_name: company, formation_date: null, country_of_formation: 'US' }, as_of: today(), generated_at: new Date().toISOString(), objects: objs };
  return send(c, `ocf-${today()}.json`, JSON.stringify(doc, null, 2), 'application/json');
});

reports.get('/admin/reports/backup.json', async (c) => {
  const tables = ['settings', 'stakeholders', 'stock_classes', 'plans', 'securities', 'transactions', 'exercise_requests', 'valuations', 'documents', 'audit_log'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await all(c.env.DB, `SELECT * FROM ${t}`);
  return send(c, `backup-${today()}.json`, JSON.stringify(out, null, 2), 'application/json');
});
