import { html } from './views';
import { newApp, page, requireAdmin, ip, actor, int, num, str, dateOk, type C } from './app';
import { all, one, run, audit, loadLedger, currentValuation, setting, nextLabel } from './db';
import { buildCapTable, optionBalance, optionDeadline, shareOutstanding, vestedAsOf, today, addDays, addMonths, daysUntil, fmtInt, fmtUsd, fmtDate, fmtPct, type Security } from './logic';
import { sendMail } from './mail';
import { createLoginToken } from './auth';
import { statusPill } from './holder';

export const admin = newApp();
admin.use('/admin/*', async (c, next) => { const r = requireAdmin(c as C); if (r) return r; await next(); });
admin.use('/admin', async (c, next) => { const r = requireAdmin(c as C); if (r) return r; await next(); });

// ---------- 409A banner shown on every admin page ----------
async function valuationBanner(c: C) {
  const v = await currentValuation(c.env.DB, today());
  if (!v) return html`<div class="banner warn"><strong>No 409A on file.</strong> Holders can't exercise until one is recorded. <a href="/admin/valuations">Add 409A</a></div>`;
  const exp = v.expires_on || addMonths(v.effective_date, 12);
  const d = daysUntil(exp);
  if (d < 0) return html`<div class="banner warn"><strong>409A expired ${fmtDate(exp)}.</strong> Exercises are paused until a new valuation is recorded. <a href="/admin/valuations">Add 409A</a></div>`;
  if (d <= 90) return html`<div class="banner warn">409A (${fmtUsd(v.fmv)}) expires <strong>${fmtDate(exp)}</strong> (${d} days). Reminders go out at 90, 60, 30 and 7 days. <a href="/admin/valuations">Record the new one</a></div>`;
  return '';
}

// ---------- Cap table ----------
admin.get('/admin', async (c) => {
  const asOf = dateOk(c.req.query('asof') || '') ? c.req.query('asof')! : today();
  const L = await loadLedger(c.env.DB);
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs, asOf);
  const v = await currentValuation(c.env.DB, asOf);
  const pending = await one<{ n: number; amt: number }>(c.env.DB, `SELECT COUNT(*) n, COALESCE(SUM(cost),0) amt FROM exercise_requests WHERE status IN ('requested','paid')`);
  const soon = cap.byHolder.filter((r) => r.deadline && r.optionsVested > 0 && daysUntil(r.deadline) <= 90 && daysUntil(r.deadline) >= 0);
  const body = html`${await valuationBanner(c)}
  <div class="row" style="justify-content:space-between"><h1>Cap table</h1>
  <form class="row" method="get"><label class="row" style="display:flex">As of <input type="date" name="asof" value="${asOf}"></label><button class="btn sm">View</button> <a class="btn sm" href="/admin/reports/captable.csv?asof=${asOf}">Export CSV</a></form></div>
  <div class="grid">
    <div class="card stat"><div class="label">Fully diluted shares</div><div class="value">${fmtInt(cap.fullyDiluted)}</div></div>
    ${cap.classes.map((r) => html`<div class="card stat"><div class="label">${r.cls.name} outstanding</div><div class="value">${fmtInt(r.outstanding)}</div></div>`)}
    ${cap.plans.map((p) => html`<div class="card stat"><div class="label">Options outstanding</div><div class="value">${fmtInt(p.outstanding)}</div></div><div class="card stat"><div class="label">Available in plan</div><div class="value">${fmtInt(p.available)}</div></div>`)}
    <div class="card stat"><div class="label">Current FMV</div><div class="value">${v ? fmtUsd(v.fmv) : 'n/a'}</div></div>
    <div class="card stat"><div class="label">Open exercise requests</div><div class="value"><a href="/admin/exercises">${pending?.n ?? 0}</a></div><div class="small muted">${fmtUsd(pending?.amt ?? 0)}</div></div>
  </div>
  <h2>By class</h2>
  <div class="scroll"><table><thead><tr><th>Class</th><th class="num">Authorized</th><th class="num">Outstanding</th><th class="num">Fully diluted</th><th class="num">% fully diluted</th></tr></thead><tbody>
  ${cap.classes.map((r) => { const fd = Math.round(r.outstanding * (r.cls.conversion_ratio ?? 1)); return html`<tr><td>${r.cls.name}</td><td class="num">${r.cls.authorized ? fmtInt(r.cls.authorized) : ''}</td><td class="num">${fmtInt(r.outstanding)}</td><td class="num">${fmtInt(fd)}</td><td class="num">${fmtPct(cap.fullyDiluted ? fd / cap.fullyDiluted : 0)}</td></tr>`; })}
  ${cap.plans.map((p) => html`<tr><td>${p.plan.name}: options outstanding</td><td class="num">${fmtInt(p.plan.reserved)}</td><td class="num"></td><td class="num">${fmtInt(p.outstanding)}</td><td class="num">${fmtPct(p.outstanding / (cap.fullyDiluted || 1))}</td></tr>
    <tr><td>${p.plan.name}: available for grant</td><td></td><td></td><td class="num">${fmtInt(p.available)}</td><td class="num">${fmtPct(p.available / (cap.fullyDiluted || 1))}</td></tr>`)}
  <tr><td><strong>Total</strong></td><td></td><td></td><td class="num"><strong>${fmtInt(cap.fullyDiluted)}</strong></td><td class="num"><strong>100.00%</strong></td></tr></tbody></table></div>
  ${soon.length ? html`<h2>Option deadlines in the next 90 days</h2><div class="scroll"><table><thead><tr><th>Holder</th><th class="num">Exercisable</th><th>Deadline</th></tr></thead><tbody>${soon.map((r) => html`<tr><td><a href="/admin/holders/${r.holder.id}">${r.holder.name}</a></td><td class="num">${fmtInt(r.optionsVested)}</td><td>${fmtDate(r.deadline)} (${daysUntil(r.deadline!)} days)</td></tr>`)}</tbody></table></div>` : ''}
  <h2>Top holders</h2>${holdersTable(cap.byHolder.slice(0, 10))}<p><a href="/admin/holders">All holders →</a></p>`;
  return page(c, 'Cap table', body, '/admin');
});

function holdersTable(rows: ReturnType<typeof buildCapTable>['byHolder'], all?: { id: number; name: string; email: string | null; relationship: string | null }[]) {
  const withEq = new Set(rows.map((r) => r.holder.id));
  const extra = (all || []).filter((h) => !withEq.has(h.id));
  return html`<div class="scroll"><table class="sortable searchable"><thead><tr><th data-sort>Holder</th><th data-sort>Relationship</th><th data-sort class="num">Shares</th><th data-sort class="num">Options outstanding</th><th data-sort class="num">Options vested</th><th data-sort class="num">% fully diluted</th><th data-sort>Option deadline</th><th data-sort>Email</th></tr></thead><tbody>
  ${rows.map((r) => html`<tr><td><a href="/admin/holders/${r.holder.id}">${r.holder.name}</a></td><td>${r.holder.relationship || ''}</td><td class="num">${fmtInt(r.shares)}</td><td class="num">${fmtInt(r.optionsOutstanding)}</td><td class="num">${fmtInt(r.optionsVested)}</td><td class="num" data-v="${r.pct}">${fmtPct(r.pct)}</td><td data-v="${r.deadline || '9999'}">${fmtDate(r.deadline)}</td><td class="small">${r.holder.email || ''}</td></tr>`)}
  ${extra.map((h) => html`<tr><td><a href="/admin/holders/${h.id}">${h.name}</a></td><td>${h.relationship || ''}</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num" data-v="0">0.00%</td><td data-v="9999"></td><td class="small">${h.email || ''}</td></tr>`)}
  </tbody></table></div>`;
}

// ---------- Holders ----------
admin.get('/admin/holders', async (c) => {
  const f = c.req.query('f') || 'equity';
  const L = await loadLedger(c.env.DB);
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs);
  let rows = cap.byHolder;
  if (f === 'employees') rows = rows.filter((r) => /^employee|founder/i.test(r.holder.relationship || ''));
  if (f === 'ex') rows = rows.filter((r) => /^ex-/i.test(r.holder.relationship || ''));
  if (f === 'investors') rows = rows.filter((r) => /investor/i.test(r.holder.relationship || ''));
  if (f === 'deadline') rows = rows.filter((r) => r.deadline && daysUntil(r.deadline) >= 0 && daysUntil(r.deadline) <= 90);
  const chip = (k: string, l: string) => html`<a class="chip ${f === k ? 'on' : ''}" href="/admin/holders?f=${k}">${l}</a>`;
  const body = html`<div class="row" style="justify-content:space-between"><h1>Holders</h1><div class="row"><a class="btn sm" href="/admin/reports/holders.csv">Export CSV</a><a class="btn sm primary" href="/admin/holders/new">Add holder</a></div></div>
  <div class="chips">${chip('equity', `With equity (${cap.byHolder.length})`)}${chip('employees', 'Employees')}${chip('ex', 'Ex-employees')}${chip('investors', 'Investors')}${chip('deadline', 'Deadline in 90 days')}${chip('all', `Everyone (${L.holders.length})`)}
  <input id="q" placeholder="Search" style="margin-left:auto;min-width:220px"></div>
  ${holdersTable(rows, f === 'all' ? L.holders : undefined)}<p class="small muted">Click any column to sort.</p>`;
  return page(c, 'Holders', body, '/admin/holders');
});

admin.get('/admin/holders/new', (c) => page(c, 'Add holder', html`<h1>Add holder</h1>${holderForm('/admin/holders/new', {})}`, '/admin/holders'));
admin.post('/admin/holders/new', async (c) => {
  const f = await c.req.parseBody();
  if (!str(f.name)) return c.text('Name required', 400);
  const r = await run(c.env.DB, 'INSERT INTO stakeholders (name, email, relationship, address) VALUES (?,?,?,?)', str(f.name), str(f.email).toLowerCase() || null, str(f.relationship), str(f.address));
  const id = r.meta.last_row_id;
  await audit(c.env.DB, actor(c), 'create_holder', 'stakeholder', id, null, f, ip(c));
  return c.redirect(`/admin/holders/${id}`);
});

function holderForm(action: string, h: any) {
  const rels = ['Employee', 'Ex-Employee', 'Consultant', 'Ex-Consultant', 'Investor', 'Advisor', 'Founder'];
  return html`<form class="stack card" method="post" action="${action}"><label>Name<input name="name" value="${h.name || ''}" required></label><label>Email<input name="email" type="email" value="${h.email || ''}"></label>
  <label>Relationship<select name="relationship">${rels.map((r) => html`<option ${h.relationship === r ? 'selected' : ''}>${r}</option>`)}</select></label><label>Mailing address<textarea name="address" rows="2">${h.address || ''}</textarea></label><div><button class="btn primary">Save</button></div></form>`;
}

admin.get('/admin/holders/:id', async (c) => {
  const id = int(c.req.param('id'));
  const L = await loadLedger(c.env.DB);
  const h = L.holders.find((x) => x.id === id);
  if (!h) return c.notFound();
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs);
  const row = cap.byHolder.find((r) => r.holder.id === id);
  const secs = L.secs.filter((s) => s.stakeholder_id === id);
  const reqs = await all<any>(c.env.DB, 'SELECT * FROM exercise_requests WHERE stakeholder_id=? ORDER BY id DESC', id);
  const unvested = secs.filter((s) => s.kind === 'option').reduce((a, s) => a + optionBalance(s, L.txs, today(), h.termination_date).unvested, 0);
  const sent = c.req.query('invited');
  const body = html`<p><a href="/admin/holders">← Holders</a></p>
  ${sent ? html`<div class="banner info">Login link sent to ${h.email}.${sent !== '1' ? html` <span class="small">Dev link: <a href="${sent}">${sent}</a></span>` : ''}</div>` : ''}
  <div class="row" style="justify-content:space-between"><h1>${h.name}</h1><div class="row"><a class="btn sm" href="/me?as=${id}">View as holder</a>
  ${h.email ? html`<form method="post" action="/admin/holders/${id}/invite"><button class="btn sm">Email login link</button></form>` : ''}</div></div>
  <div class="grid"><div class="card stat"><div class="label">Shares</div><div class="value">${fmtInt(row?.shares ?? 0)}</div></div><div class="card stat"><div class="label">Options outstanding</div><div class="value">${fmtInt(row?.optionsOutstanding ?? 0)}</div></div><div class="card stat"><div class="label">Options vested</div><div class="value">${fmtInt(row?.optionsVested ?? 0)}</div></div><div class="card stat"><div class="label">% fully diluted</div><div class="value">${fmtPct(row?.pct ?? 0)}</div></div></div>
  <h2>Securities</h2>${securitiesTable(secs, L)}
  <p class="row"><a class="btn sm" href="/admin/securities/new?kind=share&holder=${id}">Issue shares</a><a class="btn sm" href="/admin/securities/new?kind=option&holder=${id}">Grant options</a></p>
  ${reqs.length ? html`<h2>Exercise requests</h2><div class="scroll"><table><thead><tr><th>Reference</th><th class="num">Options</th><th class="num">Total</th><th>Status</th><th>Date</th></tr></thead><tbody>${reqs.map((e) => html`<tr><td><a href="/me/requests/${e.reference}">${e.reference}</a></td><td class="num">${fmtInt(e.quantity)}</td><td class="num">${fmtUsd(e.cost)}</td><td>${statusPill(e.status)}</td><td>${fmtDate(e.created_at)}</td></tr>`)}</tbody></table></div>` : ''}
  <div class="grid" style="margin-top:24px;align-items:start">
    <div><h2>Details</h2>${holderForm(`/admin/holders/${id}`, h)}</div>
    <div><h2>Termination</h2><form class="stack card" method="post" action="/admin/holders/${id}/terminate">
      ${h.termination_date ? html`<p>Terminated ${fmtDate(h.termination_date)}.</p>` : html`<p class="small muted">Stops vesting, forfeits unvested options (${fmtInt(unvested)} today), and sets the exercise deadline for vested options.</p>`}
      <label>Termination date<input type="date" name="date" value="${h.termination_date || today()}" required></label>
      <label>Post-termination exercise window (days)<input type="number" name="days" value="90" min="0"></label>
      <div><button class="btn danger">${h.termination_date ? 'Update termination' : 'Record termination'}</button></div></form></div>
  </div>`;
  return page(c, h.name, body, '/admin/holders');
});

admin.post('/admin/holders/:id', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const before = await one(c.env.DB, 'SELECT * FROM stakeholders WHERE id=?', id);
  await run(c.env.DB, 'UPDATE stakeholders SET name=?, email=?, relationship=?, address=? WHERE id=?', str(f.name), str(f.email).toLowerCase() || null, str(f.relationship), str(f.address), id);
  await audit(c.env.DB, actor(c), 'update_holder', 'stakeholder', id, before, f, ip(c));
  return c.redirect(`/admin/holders/${id}`);
});

admin.post('/admin/holders/:id/invite', async (c) => {
  const id = int(c.req.param('id'));
  const h = await one<any>(c.env.DB, 'SELECT * FROM stakeholders WHERE id=?', id);
  if (!h?.email) return c.text('No email', 400);
  const token = await createLoginToken(c.env, h.email);
  const link = `${c.env.APP_URL}/auth?token=${token}`;
  await sendMail(c.env, h.email, `Your ${c.env.APP_NAME} login`, `Hi ${h.name},\n\nView your equity and exercise options here (link works for 30 minutes):\n${link}\n\nAfter it expires, request a new one at ${c.env.APP_URL}/login`);
  await audit(c.env.DB, actor(c), 'invite', 'stakeholder', id, null, { email: h.email }, ip(c));
  return c.redirect(`/admin/holders/${id}?invited=${c.env.DEV_SHOW_LINKS === '1' ? encodeURIComponent(link) : '1'}`);
});

admin.post('/admin/holders/:id/terminate', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const date = str(f.date); const days = int(f.days);
  if (!dateOk(date) || !(days >= 0)) return c.text('Bad date or window', 400);
  const L = await loadLedger(c.env.DB);
  const h = L.holders.find((x) => x.id === id)!;
  const before = { termination_date: h.termination_date };
  await run(c.env.DB, 'UPDATE stakeholders SET termination_date=?, relationship=CASE WHEN relationship LIKE \'Ex-%\' THEN relationship WHEN relationship IN (\'Employee\',\'Consultant\') THEN \'Ex-\' || relationship ELSE relationship END WHERE id=?', date, id);
  const deadline = addDays(date, days);
  const done: any[] = [];
  for (const s of L.secs.filter((s) => s.stakeholder_id === id && s.kind === 'option')) {
    const already = L.txs.filter((t) => t.security_id === s.id && t.type === 'forfeit' && t.note === 'termination').reduce((a, t) => a + t.quantity, 0);
    const b = optionBalance(s, L.txs.filter((t) => !(t.type === 'forfeit' && t.note === 'termination')), date, date);
    const toForfeit = b.unvested - already;
    if (toForfeit > 0) {
      await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, effective_date, note, actor) VALUES (?, 'forfeit', ?, ?, 'termination', ?)`, s.id, toForfeit, date, actor(c));
      done.push({ label: s.label, forfeited: toForfeit });
    }
    if (b.exercisable > 0) await run(c.env.DB, 'UPDATE securities SET exercise_deadline=? WHERE id=?', deadline, s.id);
  }
  await audit(c.env.DB, actor(c), 'terminate', 'stakeholder', id, before, { termination_date: date, deadline, forfeits: done }, ip(c));
  return c.redirect(`/admin/holders/${id}`);
});

// ---------- Securities ----------
function securitiesTable(secs: Security[], L: Awaited<ReturnType<typeof loadLedger>>, showHolder = false) {
  return html`<div class="scroll"><table class="sortable searchable"><thead><tr><th data-sort>Security</th>${showHolder ? html`<th data-sort>Holder</th>` : ''}<th data-sort>Type</th><th data-sort class="num">Quantity</th><th data-sort class="num">Outstanding</th><th data-sort class="num">Price</th><th data-sort>Issued</th><th data-sort>Status</th><th data-sort>Deadline</th></tr></thead><tbody>
  ${secs.map((s) => {
    const h = L.holders.find((x) => x.id === s.stakeholder_id);
    let out = 0, status = s.status, dl = '';
    if (s.kind === 'share') { out = shareOutstanding(s, L.txs); status = out ? 'Outstanding' : s.status; }
    else { const b = optionBalance(s, L.txs, today(), h?.termination_date); out = b.outstanding; status = b.outstanding ? 'Outstanding' : b.exercised === b.granted ? 'Fully exercised' : b.exercised ? 'Partly exercised, rest closed' : 'Closed'; dl = out ? (optionDeadline(s) || '') : ''; }
    const cls = L.classes.find((k) => k.id === s.class_id);
    return html`<tr><td><a href="/admin/securities/${s.id}">${s.label}</a></td>${showHolder ? html`<td>${h ? html`<a href="/admin/holders/${h.id}">${h.name}</a>` : ''}</td>` : ''}<td>${s.kind === 'share' ? cls?.name : s.option_type}</td><td class="num">${fmtInt(s.quantity)}</td><td class="num">${fmtInt(out)}</td><td class="num">${fmtUsd(s.kind === 'share' ? s.price : s.exercise_price)}</td><td data-v="${s.issue_date}">${fmtDate(s.issue_date)}</td><td>${out ? html`<span class="pill good">${status}</span>` : html`<span class="pill">${status}</span>`}</td><td data-v="${dl || '9999'}">${fmtDate(dl)}</td></tr>`;
  })}</tbody></table></div>`;
}

admin.get('/admin/securities', async (c) => {
  const k = c.req.query('k') || 'all';
  const L = await loadLedger(c.env.DB);
  let secs = [...L.secs].reverse();
  if (k === 'shares') secs = secs.filter((s) => s.kind === 'share');
  if (k === 'options') secs = secs.filter((s) => s.kind === 'option');
  if (k === 'open') secs = secs.filter((s) => s.kind === 'share' ? shareOutstanding(s, L.txs) > 0 : optionBalance(s, L.txs).outstanding > 0);
  const chip = (x: string, l: string) => html`<a class="chip ${k === x ? 'on' : ''}" href="/admin/securities?k=${x}">${l}</a>`;
  const body = html`<div class="row" style="justify-content:space-between"><h1>Securities</h1><div class="row"><a class="btn sm" href="/admin/reports/securities.csv">Export CSV</a><a class="btn sm" href="/admin/securities/new?kind=share">Issue shares</a><a class="btn sm" href="/admin/securities/new?kind=option">Grant options</a></div></div>
  <div class="chips">${chip('all', `All (${L.secs.length})`)}${chip('open', 'Outstanding')}${chip('shares', 'Share certificates')}${chip('options', 'Option grants')}<input id="q" placeholder="Search" style="margin-left:auto;min-width:220px"></div>${securitiesTable(secs, L, true)}`;
  return page(c, 'Securities', body, '/admin/securities');
});

admin.get('/admin/securities/new', async (c) => {
  const kind = c.req.query('kind') === 'option' ? 'option' : 'share';
  const holders = await all<any>(c.env.DB, 'SELECT id, name FROM stakeholders ORDER BY name');
  const classes = await all<any>(c.env.DB, 'SELECT * FROM stock_classes');
  const plans = await all<any>(c.env.DB, 'SELECT * FROM plans');
  const v = await currentValuation(c.env.DB, today());
  const hsel = int(c.req.query('holder'));
  const body = html`<h1>${kind === 'share' ? 'Issue shares' : 'Grant options'}</h1>
  <form class="stack card" method="post" action="/admin/securities/new"><input type="hidden" name="kind" value="${kind}">
  <label>Holder<select name="stakeholder_id" required>${holders.map((h) => html`<option value="${h.id}" ${h.id === hsel ? 'selected' : ''}>${h.name}</option>`)}</select></label>
  ${kind === 'share' ? html`<label>Class<select name="class_id">${classes.map((k) => html`<option value="${k.id}">${k.name}</option>`)}</select></label>
    <label>Shares<input name="quantity" type="number" min="1" required></label><label>Price per share ($)<input name="price" type="number" step="0.0001" min="0" required></label>`
  : html`<label>Plan<select name="plan_id">${plans.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>
    <label>Type<select name="option_type"><option>ISO</option><option>NSO</option></select></label><label>Options<input name="quantity" type="number" min="1" required></label>
    <label>Exercise price ($)<input name="exercise_price" type="number" step="0.0001" min="${v?.fmv ?? 0}" value="${v?.fmv ?? ''}" required></label><div class="small muted">Must be at or above current FMV ${v ? fmtUsd(v.fmv) : ''}.</div>
    <div class="row"><label>Vesting months<input name="vest_months" type="number" value="48"></label><label>Cliff months<input name="cliff_months" type="number" value="12"></label><label>Vesting start<input name="vest_start" type="date" value="${today()}"></label></div>
    <label>Board approval date<input name="board_date" type="date"></label>`}
  <label>Issue / grant date<input name="issue_date" type="date" value="${today()}" required></label><label>Notes<input name="notes"></label>
  <div><button class="btn primary">Create</button></div><p class="small muted">Upload the signed agreement on the next screen.</p></form>`;
  return page(c, 'New security', body, '/admin/securities');
});

admin.post('/admin/securities/new', async (c) => {
  const f = await c.req.parseBody();
  const kind = f.kind === 'option' ? 'option' : 'share';
  const qty = int(f.quantity); const date = str(f.issue_date);
  if (!(qty > 0) || !dateOk(date)) return c.text('Quantity and date required', 400);
  let label: string; let r;
  if (kind === 'share') {
    const cls = await one<any>(c.env.DB, 'SELECT * FROM stock_classes WHERE id=?', int(f.class_id));
    label = await nextLabel(c.env.DB, cls?.prefix || 'CS');
    r = await run(c.env.DB, `INSERT INTO securities (label, kind, stakeholder_id, class_id, quantity, price, issue_date, notes) VALUES (?, 'share', ?,?,?,?,?,?)`, label, int(f.stakeholder_id), cls.id, qty, num(f.price), date, str(f.notes));
  } else {
    const v = await currentValuation(c.env.DB, date);
    const ep = num(f.exercise_price);
    if (v && ep < v.fmv) return c.text(`Exercise price must be at or above FMV ${v.fmv}`, 400);
    const plan = await one<any>(c.env.DB, 'SELECT * FROM plans WHERE id=?', int(f.plan_id));
    const L = await loadLedger(c.env.DB);
    const pool = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs).plans.find((p) => p.plan.id === plan.id)!;
    if (qty > pool.available) return c.text(`Only ${pool.available} options available in ${plan.name}`, 400);
    label = await nextLabel(c.env.DB, 'ES');
    r = await run(c.env.DB, `INSERT INTO securities (label, kind, stakeholder_id, plan_id, quantity, issue_date, option_type, exercise_price, expiration_date, vest_months, cliff_months, vest_start, notes) VALUES (?, 'option', ?,?,?,?,?,?,?,?,?,?,?)`,
      label, int(f.stakeholder_id), plan.id, qty, date, str(f.option_type), ep, addMonths(date, 120), int(f.vest_months) || null, int(f.cliff_months) || 0, str(f.vest_start) || date, [str(f.notes), f.board_date ? `Board approved ${f.board_date}` : ''].filter(Boolean).join('; '));
  }
  const id = r.meta.last_row_id;
  await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, price, effective_date, actor) VALUES (?, 'issue', ?, ?, ?, ?)`, id, qty, kind === 'share' ? num(f.price) : num(f.exercise_price), date, actor(c));
  await audit(c.env.DB, actor(c), `create_${kind}`, 'security', id, null, { ...f, label }, ip(c));
  return c.redirect(`/admin/securities/${id}`);
});

admin.get('/admin/securities/:id', async (c) => {
  const id = int(c.req.param('id'));
  const L = await loadLedger(c.env.DB);
  const s = L.secs.find((x) => x.id === id);
  if (!s) return c.notFound();
  const h = L.holders.find((x) => x.id === s.stakeholder_id)!;
  const txs = L.txs.filter((t) => t.security_id === id || t.resulting_security_id === id);
  const docs = await all<any>(c.env.DB, `SELECT * FROM documents WHERE owner_type='security' AND owner_id=? ORDER BY uploaded_at DESC`, id);
  const cls = L.classes.find((k) => k.id === s.class_id);
  const b = s.kind === 'option' ? optionBalance(s, L.txs, today(), h.termination_date) : null;
  const out = s.kind === 'share' ? shareOutstanding(s, L.txs) : b!.outstanding;
  const holders = L.holders;
  const body = html`<p><a href="/admin/holders/${h.id}">← ${h.name}</a></p><h1>${s.label} · ${s.kind === 'share' ? cls?.name : `${s.option_type} option grant`}</h1>
  <div class="grid">
    <div class="card"><dl class="kv"><dt>Holder</dt><dd><a href="/admin/holders/${h.id}">${h.name}</a></dd><dt>${s.kind === 'share' ? 'Shares' : 'Granted'}</dt><dd>${fmtInt(s.quantity)}</dd><dt>Outstanding</dt><dd>${fmtInt(out)}</dd>
    ${s.kind === 'share' ? html`<dt>Price paid</dt><dd>${fmtUsd(s.price)}</dd><dt>Issued</dt><dd>${fmtDate(s.issue_date)}</dd><dt>Status</dt><dd>${out ? 'Outstanding' : s.status}</dd>`
    : html`<dt>Exercise price</dt><dd>${fmtUsd(s.exercise_price)}</dd><dt>Granted</dt><dd>${fmtDate(s.issue_date)}</dd><dt>Vesting</dt><dd>${s.vest_months ? `${s.vest_months} months, ${s.cliff_months || 0}-month cliff, from ${fmtDate(s.vest_start)}` : 'Fully vested / custom'}</dd>
      <dt>Vested</dt><dd>${fmtInt(b!.vested)}</dd><dt>Exercised</dt><dd>${fmtInt(b!.exercised)}</dd><dt>Forfeited/expired/canceled</dt><dd>${fmtInt(b!.forfeited + b!.expired + b!.canceled)}</dd><dt>Expiration</dt><dd>${fmtDate(s.expiration_date)}</dd><dt>Exercise deadline</dt><dd>${fmtDate(optionDeadline(s))}</dd>`}
    ${s.notes ? html`<dt>Notes</dt><dd>${s.notes}</dd>` : ''}</dl>
    ${s.kind === 'share' ? html`<p><a href="/certificate/${s.id}">View certificate</a></p>` : ''}</div>
    <div class="card"><h2 style="margin-top:0">Actions</h2>
    ${out <= 0 ? html`<p class="muted">Nothing outstanding.</p>` : s.kind === 'share' ? html`
      <form class="stack" method="post" action="/admin/securities/${id}/action"><label>Action<select name="type"><option value="repurchase">Repurchase</option><option value="cancel">Cancel</option><option value="transfer">Transfer to another holder</option></select></label>
      <label>Effective date<input type="date" name="date" value="${today()}" required></label><label>Price per share (repurchase/transfer)<input name="price" type="number" step="0.0001"></label>
      <label>Transfer to (transfer only)<select name="to"><option value="">-</option>${holders.filter((x) => x.id !== h.id).map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>
      <label>Shares (transfer: partial allowed)<input name="quantity" type="number" value="${s.quantity}" max="${s.quantity}" min="1"></label>
      <label>Note<input name="note"></label><div><button class="btn danger">Record</button></div></form>`
    : html`<form class="stack" method="post" action="/admin/securities/${id}/action"><label>Action<select name="type"><option value="forfeit">Forfeit</option><option value="expire">Expire</option><option value="cancel">Cancel</option></select></label>
      <label>Options<input name="quantity" type="number" min="1" max="${out}" value="${out}"></label><label>Effective date<input type="date" name="date" value="${today()}" required></label><label>Note<input name="note"></label><div><button class="btn danger">Record</button></div></form>`}
    </div></div>
  <h2>History</h2><div class="scroll"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">FMV</th><th>Result</th><th>Note</th><th>By</th></tr></thead><tbody>
  ${txs.length ? txs.map((t) => { const res = L.secs.find((x) => x.id === t.resulting_security_id); return html`<tr><td>${fmtDate(t.effective_date)}</td><td>${t.security_id === id ? t.type : `${t.type} (source)`}</td><td class="num">${fmtInt(t.quantity)}</td><td class="num">${fmtUsd(t.price)}</td><td class="num">${fmtUsd(t.fmv)}</td><td>${res && res.id !== id ? html`<a href="/admin/securities/${res.id}">${res.label}</a>` : ''}</td><td>${t.note || ''}</td><td class="small">${t.actor || ''}</td></tr>`; }) : html`<tr><td colspan="8" class="muted">No transactions (imported as-is).</td></tr>`}</tbody></table></div>
  <h2>Documents</h2>${docs.map((d) => html`<div class="row" style="justify-content:space-between"><span>${d.kind} · ${d.filename}</span><a href="/doc/${d.id}">Download</a></div>`)}
  <form class="row card" method="post" enctype="multipart/form-data" action="/admin/upload?owner_type=security&owner_id=${id}&back=/admin/securities/${id}" style="margin-top:8px"><select name="kind"><option>Grant agreement</option><option>Stock purchase agreement</option><option>Certificate</option><option>Board consent</option><option>83(b) election</option><option>Other</option></select><input type="file" name="file" required><button class="btn sm">Upload</button></form>`;
  return page(c, s.label, body, '/admin/securities');
});

admin.post('/admin/securities/:id/action', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const type = str(f.type); const date = str(f.date); const note = str(f.note);
  if (!dateOk(date)) return c.text('Date required', 400);
  const L = await loadLedger(c.env.DB);
  const s = L.secs.find((x) => x.id === id)!;
  const h = L.holders.find((x) => x.id === s.stakeholder_id)!;
  if (s.kind === 'option') {
    if (!['forfeit', 'expire', 'cancel'].includes(type)) return c.text('Bad action', 400);
    const b = optionBalance(s, L.txs, today(), h.termination_date);
    const q = int(f.quantity);
    if (!(q > 0 && q <= b.outstanding)) return c.text(`Quantity must be 1 to ${b.outstanding}`, 400);
    await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, effective_date, note, actor) VALUES (?,?,?,?,?,?)`, id, type, q, date, note, actor(c));
    await audit(c.env.DB, actor(c), `option_${type}`, 'security', id, b, { quantity: q, date, note }, ip(c));
  } else {
    if (!['repurchase', 'cancel', 'transfer'].includes(type)) return c.text('Bad action', 400);
    if (shareOutstanding(s, L.txs) <= 0) return c.text('Not outstanding', 400);
    const price = num(f.price);
    if (type === 'transfer') {
      const to = int(f.to); const q = int(f.quantity);
      if (!to || !(q > 0 && q <= s.quantity)) return c.text('Pick a holder and quantity', 400);
      const cls = L.classes.find((k) => k.id === s.class_id)!;
      const l1 = await nextLabel(c.env.DB, cls.prefix || 'CS');
      const n1 = await run(c.env.DB, `INSERT INTO securities (label, kind, stakeholder_id, class_id, quantity, price, issue_date, source_security_id, notes) VALUES (?, 'share', ?,?,?,?,?,?,?)`, l1, to, cls.id, q, Number.isFinite(price) ? price : s.price, date, id, `Transfer from ${s.label}`);
      await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, price, effective_date, resulting_security_id, note, actor) VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?)`, id, s.quantity, Number.isFinite(price) ? price : null, date, n1.meta.last_row_id, note, actor(c));
      if (q < s.quantity) {
        const l2 = await nextLabel(c.env.DB, cls.prefix || 'CS');
        await run(c.env.DB, `INSERT INTO securities (label, kind, stakeholder_id, class_id, quantity, price, issue_date, source_security_id, notes) VALUES (?, 'share', ?,?,?,?,?,?,?)`, l2, s.stakeholder_id, cls.id, s.quantity - q, s.price, date, id, `Balance certificate from ${s.label}`);
      }
      await run(c.env.DB, `UPDATE securities SET status='transferred' WHERE id=?`, id);
    } else {
      await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, price, effective_date, note, actor) VALUES (?,?,?,?,?,?,?)`, id, type, s.quantity, Number.isFinite(price) ? price : null, date, note, actor(c));
      await run(c.env.DB, `UPDATE securities SET status=? WHERE id=?`, type === 'repurchase' ? 'repurchased' : 'canceled', id);
    }
    await audit(c.env.DB, actor(c), `share_${type}`, 'security', id, { status: s.status }, f, ip(c));
  }
  return c.redirect(`/admin/securities/${id}`);
});

admin.post('/admin/upload', async (c) => {
  const ownerType = c.req.query('owner_type')!; const ownerId = int(c.req.query('owner_id'));
  const back = c.req.query('back') || '/admin';
  const f = await c.req.parseBody();
  const file = f.file as File;
  if (!file || typeof file === 'string') return c.text('No file', 400);
  if (file.size > 25 * 1024 * 1024) return c.text('Max 25 MB', 400);
  const key = `${ownerType}/${ownerId}/${Date.now()}-${file.name.replace(/[^\w.\- ]/g, '_')}`;
  await c.env.DOCS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const r = await run(c.env.DB, 'INSERT INTO documents (owner_type, owner_id, kind, filename, r2_key, content_type, uploaded_by) VALUES (?,?,?,?,?,?,?)', ownerType, ownerId, str(f.kind), file.name, key, file.type, actor(c));
  await audit(c.env.DB, actor(c), 'upload', 'document', r.meta.last_row_id, null, { ownerType, ownerId, name: file.name }, ip(c));
  return c.redirect(back.startsWith('/admin') ? back : '/admin');
});

// ---------- Exercises ----------
admin.get('/admin/exercises', async (c) => {
  const rows = await all<any>(c.env.DB, `SELECT e.*, st.name, s.label, s.option_type FROM exercise_requests e JOIN stakeholders st ON st.id=e.stakeholder_id JOIN securities s ON s.id=e.security_id ORDER BY CASE e.status WHEN 'paid' THEN 0 WHEN 'requested' THEN 1 ELSE 2 END, e.id DESC`);
  const hist = await all<any>(c.env.DB, `SELECT t.*, s.label, s.option_type, st.name, r.label res FROM transactions t JOIN securities s ON s.id=t.security_id JOIN stakeholders st ON st.id=s.stakeholder_id LEFT JOIN securities r ON r.id=t.resulting_security_id WHERE t.type='exercise' ORDER BY t.effective_date DESC LIMIT 200`);
  const open = rows.filter((r) => ['requested', 'paid'].includes(r.status));
  const body = html`${await valuationBanner(c)}<div class="row" style="justify-content:space-between"><h1>Exercise queue</h1><a class="btn sm" href="/admin/reports/exercises.csv">Export CSV (Form 3921 inputs)</a></div>
  ${open.length ? html`<div class="scroll"><table><thead><tr><th>Reference</th><th>Holder</th><th>Grant</th><th class="num">Options</th><th class="num">Amount</th><th>Method</th><th>Status</th><th>Requested</th><th></th></tr></thead><tbody>
  ${open.map((e) => html`<tr><td><a href="/me/requests/${e.reference}">${e.reference}</a></td><td><a href="/admin/holders/${e.stakeholder_id}">${e.name}</a></td><td>${e.option_type} ${e.label}</td><td class="num">${fmtInt(e.quantity)}</td><td class="num">${fmtUsd(e.cost)}</td><td>${e.method}</td><td>${statusPill(e.status)}</td><td>${fmtDate(e.created_at)}</td>
  <td class="row" style="flex-wrap:nowrap">${e.status === 'requested' ? html`<form method="post" action="/admin/exercises/${e.id}/paid" class="row" style="flex-wrap:nowrap"><select name="method"><option>wire</option><option>check</option><option>online</option></select><button class="btn sm">Mark paid</button></form>` : html`<form method="post" action="/admin/exercises/${e.id}/approve"><button class="btn sm primary">Approve &amp; issue shares</button></form>`}
  <form method="post" action="/admin/exercises/${e.id}/cancel"><button class="btn sm danger">Cancel</button></form></td></tr>`)}</tbody></table></div>` : html`<p class="muted">No open requests.</p>`}
  <h2>Exercise history (${hist.length})</h2><div class="scroll"><table class="sortable"><thead><tr><th data-sort>Date</th><th data-sort>Holder</th><th data-sort>Grant</th><th data-sort class="num">Options</th><th data-sort class="num">Price</th><th data-sort class="num">FMV</th><th data-sort class="num">Paid</th><th>Certificate</th></tr></thead><tbody>
  ${hist.map((t) => html`<tr><td data-v="${t.effective_date}">${fmtDate(t.effective_date)}</td><td>${t.name}</td><td>${t.option_type} ${t.label}</td><td class="num">${fmtInt(t.quantity)}</td><td class="num">${fmtUsd(t.price)}</td><td class="num">${fmtUsd(t.fmv)}</td><td class="num">${fmtUsd((t.price || 0) * t.quantity)}</td><td>${t.res ? html`<a href="/admin/securities/${t.resulting_security_id}">${t.res}</a>` : ''}</td></tr>`)}</tbody></table></div>`;
  return page(c, 'Exercises', body, '/admin/exercises');
});

admin.post('/admin/exercises/:id/paid', async (c) => {
  const id = int(c.req.param('id'));
  const f = await c.req.parseBody();
  const before = await one<any>(c.env.DB, 'SELECT * FROM exercise_requests WHERE id=?', id);
  if (before?.status !== 'requested') return c.text('Not awaiting payment', 400);
  await run(c.env.DB, `UPDATE exercise_requests SET status='paid', method=?, paid_at=datetime('now') WHERE id=?`, str(f.method) || 'wire', id);
  await audit(c.env.DB, actor(c), 'exercise_paid', 'exercise_request', id, before, { method: f.method }, ip(c));
  return c.redirect('/admin/exercises');
});

admin.post('/admin/exercises/:id/cancel', async (c) => {
  const id = int(c.req.param('id'));
  const before = await one<any>(c.env.DB, 'SELECT e.*, st.email FROM exercise_requests e JOIN stakeholders st ON st.id=e.stakeholder_id WHERE e.id=?', id);
  if (!before || !['requested', 'paid'].includes(before.status)) return c.text('Not open', 400);
  await run(c.env.DB, `UPDATE exercise_requests SET status='canceled' WHERE id=?`, id);
  await audit(c.env.DB, actor(c), 'exercise_canceled', 'exercise_request', id, before, null, ip(c));
  if (before.email) await sendMail(c.env, before.email, `Exercise request ${before.reference} canceled`, `Your exercise request ${before.reference} was canceled. ${before.status === 'paid' ? 'Any payment received will be refunded.' : ''} Questions? Reply to this email.`);
  return c.redirect('/admin/exercises');
});

admin.post('/admin/exercises/:id/approve', async (c) => {
  const id = int(c.req.param('id'));
  const res = await approveExercise(c, id);
  if (typeof res === 'string') return c.text(res, 400);
  return c.redirect('/admin/exercises');
});

export async function approveExercise(c: C, id: number): Promise<string | { label: string }> {
  const e = await one<any>(c.env.DB, `SELECT e.*, st.email, st.name, st.termination_date FROM exercise_requests e JOIN stakeholders st ON st.id=e.stakeholder_id WHERE e.id=?`, id);
  if (!e || e.status !== 'paid') return 'Request must be marked paid first';
  const s = await one<Security>(c.env.DB, 'SELECT * FROM securities WHERE id=?', e.security_id);
  const txs = await all<any>(c.env.DB, 'SELECT * FROM transactions WHERE security_id=?', e.security_id);
  const b = optionBalance(s!, txs, today(), e.termination_date);
  if (e.quantity > b.exercisable) return `Only ${b.exercisable} options are exercisable now`;
  const plan = await one<any>(c.env.DB, 'SELECT * FROM plans WHERE id=?', s!.plan_id);
  const cls = await one<any>(c.env.DB, 'SELECT * FROM stock_classes WHERE id=?', plan?.class_id ?? 1);
  const label = await nextLabel(c.env.DB, cls?.prefix || 'CS');
  const d = today();
  const fmv = (await currentValuation(c.env.DB, d))?.fmv ?? e.fmv;
  const ins = await run(c.env.DB, `INSERT INTO securities (label, kind, stakeholder_id, class_id, quantity, price, issue_date, source_security_id, notes) VALUES (?, 'share', ?,?,?,?,?,?,?)`,
    label, e.stakeholder_id, cls.id, e.quantity, e.exercise_price, d, s!.id, `Exercise ${e.reference} of ${s!.label}`);
  const newId = ins.meta.last_row_id;
  await run(c.env.DB, `INSERT INTO transactions (security_id, type, quantity, price, fmv, effective_date, resulting_security_id, note, actor) VALUES (?, 'exercise', ?, ?, ?, ?, ?, ?, ?)`,
    s!.id, e.quantity, e.exercise_price, fmv, d, newId, e.reference, actor(c));
  await run(c.env.DB, `UPDATE exercise_requests SET status='approved', approved_at=datetime('now'), approved_by=?, certificate_security_id=?, fmv=? WHERE id=?`, actor(c), newId, fmv, id);
  await audit(c.env.DB, actor(c), 'exercise_approved', 'exercise_request', id, { status: 'paid' }, { certificate: label, fmv }, ip(c));
  const summary = `Exercise ${e.reference}\nHolder: ${e.name}\nGrant: ${s!.option_type} ${s!.label}\nOptions exercised: ${fmtInt(e.quantity)} at ${fmtUsd(e.exercise_price)}\nAmount paid: ${fmtUsd(e.cost)}\nFMV on exercise date (${d}): ${fmtUsd(fmv)}\nSpread: ${fmtUsd(Math.max(0, (fmv - e.exercise_price) * e.quantity))}\nNew certificate: ${label}`;
  if (e.email) await sendMail(c.env, e.email, `Your shares are issued (${label})`, `${summary}\n\nView your certificate: ${c.env.APP_URL}/certificate/${newId}`);
  const controller = await setting(c.env.DB, 'controller_email', '');
  if (controller) await sendMail(c.env, controller, `Exercise approved ${e.reference} (${s!.option_type})`, `${summary}\n\n${s!.option_type === 'NSO' ? 'NSO: run payroll withholding on the spread.' : 'ISO: include in Form 3921 for this tax year.'}`);
  return { label };
}

// ---------- 409A ----------
admin.get('/admin/valuations', async (c) => {
  const rows = await all<any>(c.env.DB, 'SELECT v.*, d.filename FROM valuations v LEFT JOIN documents d ON d.id=v.document_id ORDER BY effective_date DESC');
  const body = html`${await valuationBanner(c)}<h1>409A valuations</h1>
  <div class="scroll"><table><thead><tr><th>Effective</th><th class="num">FMV per share</th><th>Provider</th><th>Expires</th><th>Report</th></tr></thead><tbody>
  ${rows.map((v) => html`<tr><td>${fmtDate(v.effective_date)}</td><td class="num">${fmtUsd(v.fmv)}</td><td>${v.provider || ''}</td><td>${fmtDate(v.expires_on)}</td><td>${v.document_id ? html`<a href="/doc/${v.document_id}">${v.filename}</a>` : ''}</td></tr>`)}</tbody></table></div>
  <h2>Record a new 409A</h2><form class="stack card" method="post" enctype="multipart/form-data" action="/admin/valuations"><label>Effective date<input type="date" name="effective_date" required></label><label>FMV per common share ($)<input name="fmv" type="number" step="0.0001" min="0" required></label><label>Provider<input name="provider"></label><label>Report (PDF)<input type="file" name="file"></label><div><button class="btn primary">Save</button></div><p class="small muted">Expires 12 months after the effective date. Admins get reminders at 90, 60, 30 and 7 days.</p></form>`;
  return page(c, '409A', body, '/admin/valuations');
});

admin.post('/admin/valuations', async (c) => {
  const f = await c.req.parseBody();
  const d = str(f.effective_date); const fmv = num(f.fmv);
  if (!dateOk(d) || !(fmv > 0)) return c.text('Date and FMV required', 400);
  let docId: number | null = null;
  const file = f.file as File;
  if (file && typeof file !== 'string' && file.size) {
    const key = `valuation/${d}-${file.name.replace(/[^\w.\- ]/g, '_')}`;
    await c.env.DOCS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    docId = (await run(c.env.DB, `INSERT INTO documents (owner_type, kind, filename, r2_key, content_type, uploaded_by) VALUES ('company','409A',?,?,?,?)`, file.name, key, file.type, actor(c))).meta.last_row_id;
  }
  const r = await run(c.env.DB, 'INSERT INTO valuations (effective_date, fmv, provider, expires_on, document_id) VALUES (?,?,?,?,?)', d, fmv, str(f.provider), addMonths(d, 12), docId);
  await audit(c.env.DB, actor(c), 'valuation_added', 'valuation', r.meta.last_row_id, null, { d, fmv, provider: f.provider }, ip(c));
  return c.redirect('/admin/valuations');
});

// ---------- Audit + settings ----------
admin.get('/admin/audit', async (c) => {
  const rows = await all<any>(c.env.DB, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 500');
  return page(c, 'Audit log', html`<div class="row" style="justify-content:space-between"><h1>Audit log</h1><a class="btn sm" href="/admin/reports/audit.csv">Export CSV</a></div><p class="small muted">Every change, newest first. Entries can't be edited or deleted.</p>
  <div class="scroll"><table><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Record</th><th>Change</th></tr></thead><tbody>${rows.map((r) => html`<tr><td class="small">${r.at}</td><td class="small">${r.actor}</td><td>${r.action}</td><td class="small">${r.entity} #${r.entity_id ?? ''}</td><td class="small" style="max-width:420px;word-break:break-word">${(r.after_json || '').slice(0, 300)}</td></tr>`)}</tbody></table></div>`, '/admin/audit');
});

const SETTINGS: [string, string, string][] = [
  ['company_legal_name', 'Company legal name (on certificates)', 'input'],
  ['wire_instructions', 'Wire instructions shown to holders', 'textarea'],
  ['exercise_agreement', 'Exercise agreement text holders accept', 'textarea'],
  ['controller_email', 'Controller email (gets exercise summaries for payroll and Form 3921)', 'input'],
];
admin.get('/admin/settings', async (c) => {
  const vals = Object.fromEntries((await all<any>(c.env.DB, 'SELECT * FROM settings')).map((r) => [r.key, r.value]));
  return page(c, 'Settings', html`<h1>Settings</h1><form class="stack card" method="post" action="/admin/settings" style="max-width:720px">
  ${SETTINGS.map(([k, l, t]) => t === 'textarea' ? html`<label>${l}<textarea name="${k}" rows="5">${vals[k] || ''}</textarea></label>` : html`<label>${l}<input name="${k}" value="${vals[k] || ''}"></label>`)}
  <div><button class="btn primary">Save</button></div></form>
  <h2>Integrations</h2><div class="card small"><p>Email: ${c.env.RESEND_API_KEY ? 'Resend connected' : 'not connected (emails are logged only)'} · Pay online: ${c.env.STRIPE_SECRET_KEY ? 'Stripe connected' : 'off (wire only)'} · Admins: ${c.env.ADMIN_EMAILS}</p></div>`, '/admin/settings');
});
admin.post('/admin/settings', async (c) => {
  const f = await c.req.parseBody();
  for (const [k] of SETTINGS) {
    const before = await setting(c.env.DB, k);
    const v = str(f[k]);
    if (v !== before) {
      await run(c.env.DB, 'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
      await audit(c.env.DB, actor(c), 'setting', 'settings', null, { [k]: before }, { [k]: v }, ip(c));
    }
  }
  return c.redirect('/admin/settings');
});
