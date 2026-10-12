import { html, raw } from './views';
import { newApp, page, requireLogin, ip, int, str, type C } from './app';
import { all, one, run, audit, loadLedger, currentValuation, setting } from './db';
import { optionBalance, optionDeadline, shareOutstanding, vestingCurve, buildCapTable, today, daysUntil, fmtInt, fmtUsd, fmtDate, fmtPct, type Security } from './logic';
import { sendMail, adminEmails } from './mail';
import { createCheckout } from './stripe';

export const holder = newApp();

async function holderData(c: C, stakeholderId: number) {
  const L = await loadLedger(c.env.DB);
  const me = L.holders.find((h) => h.id === stakeholderId)!;
  const mine = L.secs.filter((s) => s.stakeholder_id === stakeholderId);
  const cap = buildCapTable(L.holders, L.classes, L.plans, L.secs, L.txs);
  const row = cap.byHolder.find((r) => r.holder.id === stakeholderId);
  return { L, me, mine, cap, row };
}

/** Which stakeholder this page shows: the holder themself, or ?as=ID for admins previewing. */
function whichHolder(c: C): number | null {
  const s = c.get('session')!;
  const as = int(c.req.query('as'));
  if (s.isAdmin && Number.isFinite(as)) return as;
  return s.stakeholderId;
}

holder.get('/me', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const id = whichHolder(c);
  if (!id) return page(c, 'No equity', html`<h1>No equity on file</h1><p class="muted">We don't have a holder record for ${c.get('session')!.email}. If you hold equity under another email, contact the company.</p>`, '/me');
  const { L, me, mine, cap, row } = await holderData(c, id);
  const val = await currentValuation(c.env.DB, today());
  const valExpired = !val || (val.expires_on && val.expires_on < today());
  const docs = await all(c.env.DB, `SELECT * FROM documents WHERE (owner_type='stakeholder' AND owner_id=?) OR (owner_type='security' AND owner_id IN (SELECT id FROM securities WHERE stakeholder_id=?)) OR (owner_type='exercise' AND owner_id IN (SELECT id FROM exercise_requests WHERE stakeholder_id=?)) ORDER BY uploaded_at DESC`, id, id, id);
  const open = await all(c.env.DB, `SELECT * FROM exercise_requests WHERE stakeholder_id=? AND status IN ('requested','paid') ORDER BY id DESC`, id);
  const shares = mine.filter((s) => s.kind === 'share');
  const options = mine.filter((s) => s.kind === 'option');
  const asParam = c.get('session')!.isAdmin && c.req.query('as') ? `?as=${id}` : '';
  const paid = c.req.query('paid');

  const optCards = options.map((s) => {
    const b = optionBalance(s, L.txs, today(), me.termination_date);
    const dl = optionDeadline(s);
    const expired = dl && dl < today();
    if (b.outstanding === 0 && b.exercised === 0) return '';
    const pctV = b.granted ? (b.vested / b.granted) * 100 : 0;
    const canExercise = b.exercisable > 0 && !expired && !valExpired;
    const curve = vestingCurve(s, me.termination_date);
    const vestEnd = curve.length ? curve[curve.length - 1].date : null;
    return html`<div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between">
        <div><strong>${s.option_type || 'Option'} grant ${s.label}</strong> <span class="muted">· granted ${fmtDate(s.issue_date)}</span></div>
        ${canExercise
          ? html`<a class="btn primary" href="/me/exercise/${s.id}${asParam}">Exercise options</a>`
          : html`<button class="btn" disabled title="${expired ? 'Expired' : valExpired ? 'Exercises paused until a new 409A is recorded' : 'Nothing vested to exercise'}">Exercise options</button>`}
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="stat"><div class="label">Granted</div><div class="value">${fmtInt(b.granted)}</div></div>
        <div class="stat"><div class="label">Vested</div><div class="value">${fmtInt(b.vested)}</div></div>
        <div class="stat"><div class="label">Exercised</div><div class="value">${fmtInt(b.exercised)}</div></div>
        <div class="stat"><div class="label">Available to exercise</div><div class="value">${fmtInt(b.exercisable)}</div></div>
        <div class="stat"><div class="label">Exercise price</div><div class="value">${fmtUsd(s.exercise_price)}</div></div>
      </div>
      <div class="bar" style="margin:12px 0 6px"><i style="width:${pctV.toFixed(1)}%"></i></div>
      <div class="small muted">${fmtInt(b.vested)} of ${fmtInt(b.granted)} vested${vestEnd ? html` · fully vested ${fmtDate(vestEnd)}` : ''}${b.forfeited + b.expired + b.canceled ? html` · ${fmtInt(b.forfeited + b.expired + b.canceled)} forfeited or expired` : ''}
      · ${expired ? html`<span class="pill bad">Expired ${fmtDate(dl)}</span>` : dl ? html`Exercise deadline <strong>${fmtDate(dl)}</strong> (${fmtInt(daysUntil(dl))} days)` : ''}</div>
    </div>`;
  });

  const body = html`
    ${paid ? html`<div class="banner info">Thanks. Your payment for ${paid} is processing. You'll get an email when your shares are issued.</div>` : ''}
    ${valExpired && options.length ? html`<div class="banner warn">Option exercises are paused until the company records its new 409A valuation.</div>` : ''}
    <h1>${me.name}</h1>
    <div class="grid">
      <div class="card stat"><div class="label">Shares owned</div><div class="value">${fmtInt(row?.shares ?? 0)}</div></div>
      <div class="card stat"><div class="label">Options outstanding</div><div class="value">${fmtInt(row?.optionsOutstanding ?? 0)}</div></div>
      <div class="card stat"><div class="label">Options you can exercise</div><div class="value">${fmtInt(row?.optionsVested ?? 0)}</div></div>
      <div class="card stat"><div class="label">Current FMV (409A${val ? ', ' + fmtDate(val.effective_date) : ''})</div><div class="value">${val ? fmtUsd(val.fmv) : 'n/a'}</div></div>
      <div class="card stat"><div class="label">Ownership, fully diluted</div><div class="value">${fmtPct(row?.pct ?? 0)}</div></div>
    </div>
    ${open.length ? html`<h2>Open exercise requests</h2>${open.map((e: any) => html`<div class="card row" style="justify-content:space-between;margin-bottom:8px"><span>${e.reference} · ${fmtInt(e.quantity)} options · ${fmtUsd(e.cost)}</span><span><span class="pill ${e.status === 'paid' ? 'good' : 'warn'}">${e.status === 'paid' ? 'Paid, awaiting approval' : 'Awaiting payment'}</span> <a href="/me/requests/${e.reference}">Details</a></span></div>`)}` : ''}
    ${options.length ? html`<h2>Stock options</h2>${optCards}` : ''}
    ${shares.length ? html`<h2>Share certificates</h2><div class="scroll"><table><thead><tr><th>Certificate</th><th class="num">Shares</th><th>Class</th><th>Issued</th><th class="num">Price paid</th><th>Status</th><th></th></tr></thead><tbody>
      ${shares.map((s) => { const out = shareOutstanding(s, L.txs) > 0; const cls = L.classes.find((k) => k.id === s.class_id); return html`<tr><td>${s.label}</td><td class="num">${fmtInt(s.quantity)}</td><td>${cls?.name}</td><td>${fmtDate(s.issue_date)}</td><td class="num">${fmtUsd(s.price)}</td><td>${out ? html`<span class="pill good">Outstanding</span>` : html`<span class="pill">${s.status}</span>`}</td><td><a href="/certificate/${s.id}">View</a></td></tr>`; })}
    </tbody></table></div>` : ''}
    <h2>Documents</h2>
    ${docs.length ? html`<div class="card">${docs.map((d: any) => html`<div class="row" style="justify-content:space-between;padding:4px 0"><span>${d.kind || 'Document'} · ${d.filename}</span><a href="/doc/${d.id}">Download</a></div>`)}</div>` : html`<p class="muted">No documents yet.</p>`}
    <h2>Profile</h2>
    <form class="stack card" method="post" action="/me/profile${asParam}"><label>Email<input name="email" type="email" value="${me.email || ''}" required></label><label>Mailing address<textarea name="address" rows="2">${me.address || ''}</textarea></label><div><button class="btn">Save</button></div></form>`;
  return page(c, 'My equity', body, '/me', false);
});

holder.post('/me/profile', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const id = whichHolder(c); if (!id) return c.redirect('/me');
  const f = await c.req.parseBody();
  const before = await one(c.env.DB, 'SELECT email, address FROM stakeholders WHERE id=?', id);
  const after = { email: str(f.email).toLowerCase(), address: str(f.address) };
  await run(c.env.DB, 'UPDATE stakeholders SET email=?, address=? WHERE id=?', after.email, after.address, id);
  await audit(c.env.DB, c.get('session')!.email, 'update_profile', 'stakeholder', id, before, after, ip(c));
  await sendMail(c.env, adminEmails(c.env), `Holder profile updated: ${after.email}`, `Stakeholder #${id} changed their profile.\nBefore: ${JSON.stringify(before)}\nAfter: ${JSON.stringify(after)}`);
  return c.redirect('/me' + (c.req.query('as') ? `?as=${id}` : ''));
});

async function loadOption(c: C, secId: number) {
  const id = whichHolder(c);
  const s = await one<Security>(c.env.DB, 'SELECT * FROM securities WHERE id=? AND kind=\'option\'', secId);
  if (!s || s.stakeholder_id !== id) return null;
  const txs = await all(c.env.DB, 'SELECT * FROM transactions WHERE security_id=?', secId);
  const me = await one<any>(c.env.DB, 'SELECT * FROM stakeholders WHERE id=?', id);
  const pending = await one<{ q: number }>(c.env.DB, `SELECT COALESCE(SUM(quantity),0) q FROM exercise_requests WHERE security_id=? AND status IN ('requested','paid')`, secId);
  const b = optionBalance(s, txs as any, today(), me.termination_date);
  return { s, me, b, available: Math.max(0, b.exercisable - (pending?.q ?? 0)), pending: pending?.q ?? 0 };
}

holder.get('/me/exercise/:id', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const x = await loadOption(c, int(c.req.param('id')));
  if (!x) return c.notFound();
  const val = await currentValuation(c.env.DB, today());
  const dl = optionDeadline(x.s);
  const blocked = !val || (val.expires_on && val.expires_on < today()) ? 'Exercises are paused until the company records its new 409A valuation.' : dl && dl < today() ? 'This grant has expired.' : x.available <= 0 ? 'Nothing available to exercise right now.' : '';
  const agreement = await setting(c.env.DB, 'exercise_agreement', 'I elect to exercise the options above under the company equity incentive plan and my grant agreement, and I agree to pay the full exercise price.');
  const asParam = c.req.query('as') ? `?as=${c.req.query('as')}` : '';
  const body = html`<p><a href="/me${asParam}">← My equity</a></p><h1>Exercise options · ${x.s.option_type} grant ${x.s.label}</h1>
  ${blocked ? html`<div class="banner warn">${blocked}</div>` : html`
  <form class="card" method="post" action="/me/exercise/${x.s.id}${asParam}" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div style="display:grid;gap:12px;align-content:start">
      <label>Options to exercise<input id="qty" name="quantity" type="number" min="1" max="${x.available}" value="${x.available}" required></label>
      <div class="small muted">of ${fmtInt(x.available)} available${x.pending ? html` (${fmtInt(x.pending)} already in an open request)` : ''}</div>
      <dl class="kv"><dt>Exercise price</dt><dd>${fmtUsd(x.s.exercise_price)} per option</dd><dt>Current FMV</dt><dd>${fmtUsd(val!.fmv)} (409A, ${fmtDate(val!.effective_date)})</dd>
      ${x.s.option_type === 'NSO' ? html`<dt>Taxable spread</dt><dd id="spread"></dd>` : ''}<dt><strong>Total due</strong></dt><dd><strong id="total"></strong></dd></dl>
    </div>
    <div style="display:grid;gap:12px;align-content:start">
      <div class="small" style="border:1px solid var(--line);border-radius:8px;padding:10px;max-height:140px;overflow:auto">${agreement}</div>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="agree" value="1" required> I agree to the exercise agreement</label>
      <label>Type your full name to sign<input name="signed_name" required placeholder="${x.me.name}"></label>
      <button class="btn primary">Submit exercise request</button>
      <div class="small muted">Next you'll get wire instructions with a reference code${c.env.STRIPE_SECRET_KEY ? ', or you can pay online' : ''}. Shares are issued after payment arrives.</div>
    </div>
  </form>
  <script>${raw(`const p=${Number(x.s.exercise_price)},f=${Number(val!.fmv)},q=document.getElementById('qty'),t=document.getElementById('total'),sp=document.getElementById('spread');
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function u(){const n=Math.max(0,parseInt(q.value||0));t.textContent=fmt(n*p);if(sp){const s=Math.max(0,(f-p)*n);sp.textContent=fmt(s)+(s>0?' (payroll withholding applies)':' (none at current FMV)')}}q.addEventListener('input',u);u();`)}</script>`}`;
  return page(c, 'Exercise', body, '/me', false);
});

async function nextReference(c: C) {
  const y = today().slice(0, 4);
  const r = await one<{ n: number }>(c.env.DB, 'SELECT COUNT(*) n FROM exercise_requests WHERE reference LIKE ?', `EX-${y}-%`);
  return `EX-${y}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

holder.post('/me/exercise/:id', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const x = await loadOption(c, int(c.req.param('id')));
  if (!x) return c.notFound();
  const f = await c.req.parseBody();
  const qty = int(f.quantity);
  const val = await currentValuation(c.env.DB, today());
  const dl = optionDeadline(x.s);
  if (!val || (val.expires_on && val.expires_on < today())) return c.text('Exercises are paused until the new 409A is recorded.', 400);
  if (dl && dl < today()) return c.text('This grant has expired.', 400);
  if (!(qty >= 1 && qty <= x.available)) return c.text(`Quantity must be between 1 and ${x.available}.`, 400);
  if (f.agree !== '1' || !str(f.signed_name)) return c.text('Please accept the agreement and sign.', 400);
  const ref = await nextReference(c);
  const cost = Math.round(qty * Number(x.s.exercise_price) * 100) / 100;
  await run(c.env.DB, `INSERT INTO exercise_requests (reference, security_id, stakeholder_id, quantity, exercise_price, fmv, cost, method, status, signed_name, signed_at) VALUES (?,?,?,?,?,?,?,?, 'requested', ?, datetime('now'))`,
    ref, x.s.id, x.me.id, qty, x.s.exercise_price, val.fmv, cost, 'wire', str(f.signed_name));
  const req = await one<any>(c.env.DB, 'SELECT * FROM exercise_requests WHERE reference=?', ref);
  await audit(c.env.DB, c.get('session')!.email, 'exercise_requested', 'exercise_request', req.id, null, req, ip(c));
  const wire = await setting(c.env.DB, 'wire_instructions', '(wire instructions not set)');
  if (x.me.email) await sendMail(c.env, x.me.email, `Your exercise request ${ref}`, `You requested to exercise ${fmtInt(qty)} ${x.s.option_type} options (grant ${x.s.label}) at ${fmtUsd(x.s.exercise_price)}.\nTotal due: ${fmtUsd(cost)}\n\nWire instructions (include reference ${ref}):\n${wire}\n\nTrack it: ${c.env.APP_URL}/me/requests/${ref}`);
  await sendMail(c.env, adminEmails(c.env), `New exercise request ${ref}: ${x.me.name}, ${fmtUsd(cost)}`, `${x.me.name} requested ${fmtInt(qty)} ${x.s.option_type} options from ${x.s.label}. Total ${fmtUsd(cost)}. FMV ${fmtUsd(val.fmv)}.\n${c.env.APP_URL}/admin/exercises`);
  return c.redirect(`/me/requests/${ref}`);
});

holder.get('/me/requests', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const id = whichHolder(c);
  const rows = id ? await all<any>(c.env.DB, `SELECT e.*, s.label, s.option_type FROM exercise_requests e JOIN securities s ON s.id=e.security_id WHERE e.stakeholder_id=? ORDER BY e.id DESC`, id) : [];
  return page(c, 'Exercise requests', html`<h1>Exercise requests</h1>${rows.length ? html`<div class="scroll"><table><thead><tr><th>Reference</th><th>Grant</th><th class="num">Options</th><th class="num">Total</th><th>Status</th><th>Requested</th></tr></thead><tbody>
    ${rows.map((e) => html`<tr><td><a href="/me/requests/${e.reference}">${e.reference}</a></td><td>${e.option_type} ${e.label}</td><td class="num">${fmtInt(e.quantity)}</td><td class="num">${fmtUsd(e.cost)}</td><td>${statusPill(e.status)}</td><td>${fmtDate(e.created_at)}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}`, '/me/requests', false);
});

export function statusPill(s: string) {
  const m: Record<string, [string, string]> = { requested: ['warn', 'Awaiting payment'], paid: ['good', 'Paid, awaiting approval'], approved: ['good', 'Shares issued'], canceled: ['bad', 'Canceled'] };
  const [k, l] = m[s] || ['', s];
  return html`<span class="pill ${k}">${l}</span>`;
}

holder.get('/me/requests/:ref', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const s = c.get('session')!;
  const e = await one<any>(c.env.DB, `SELECT e.*, s.label, s.option_type FROM exercise_requests e JOIN securities s ON s.id=e.security_id WHERE e.reference=?`, c.req.param('ref'));
  if (!e || (!s.isAdmin && e.stakeholder_id !== s.stakeholderId)) return c.notFound();
  const wire = await setting(c.env.DB, 'wire_instructions', '(wire instructions not set)');
  const steps = ['requested', 'paid', 'approved'];
  const at = steps.indexOf(e.status);
  const body = html`<p><a href="/me/requests">← Exercise requests</a></p><h1>${e.reference}</h1>
  ${e.status === 'canceled' ? html`<div class="banner bad">This request was canceled.</div>` : html`<div class="steps">${['Requested', 'Paid', 'Shares issued'].map((l, i) => html`<span class="${i <= at ? 'on' : ''}">${l}</span>`)}</div>`}
  <div class="card"><dl class="kv"><dt>Grant</dt><dd>${e.option_type} ${e.label}</dd><dt>Options</dt><dd>${fmtInt(e.quantity)} at ${fmtUsd(e.exercise_price)}</dd><dt>Total due</dt><dd><strong>${fmtUsd(e.cost)}</strong></dd><dt>FMV at request</dt><dd>${fmtUsd(e.fmv)}</dd><dt>Signed</dt><dd>${e.signed_name}, ${fmtDate(e.signed_at)}</dd><dt>Status</dt><dd>${statusPill(e.status)}</dd>
  ${e.certificate_security_id ? html`<dt>Certificate</dt><dd><a href="/certificate/${e.certificate_security_id}">View certificate</a></dd>` : ''}</dl></div>
  ${e.status === 'requested' ? html`<h2>Pay by wire</h2><p>Include reference <strong>${e.reference}</strong> in the wire memo so we can match it.</p><pre class="wire">${wire}</pre>
    ${c.env.STRIPE_SECRET_KEY ? html`<form method="post" action="/me/requests/${e.reference}/pay" class="noprint"><button class="btn">Pay online instead (optional)</button> <span class="small muted">Bank account (ACH) or card through Stripe</span></form>` : ''}` : ''}`;
  return page(c, e.reference, body, '/me/requests', false);
});

holder.post('/me/requests/:ref/pay', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const s = c.get('session')!;
  const e = await one<any>(c.env.DB, `SELECT e.*, s.label, st.email FROM exercise_requests e JOIN securities s ON s.id=e.security_id JOIN stakeholders st ON st.id=e.stakeholder_id WHERE e.reference=?`, c.req.param('ref'));
  if (!e || (!s.isAdmin && e.stakeholder_id !== s.stakeholderId) || e.status !== 'requested' || !c.env.STRIPE_SECRET_KEY) return c.notFound();
  const co = await createCheckout(c.env, { reference: e.reference, amountCents: Math.round(e.cost * 100), email: e.email, description: `Option exercise ${e.reference} (${fmtInt(e.quantity)} options, grant ${e.label})` });
  await run(c.env.DB, `UPDATE exercise_requests SET stripe_session_id=? WHERE id=?`, co.id, e.id);
  await audit(c.env.DB, s.email, 'checkout_started', 'exercise_request', e.id, null, { session: co.id }, ip(c));
  return c.redirect(co.url, 303);
});

holder.get('/doc/:id', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const s = c.get('session')!;
  const d = await one<any>(c.env.DB, 'SELECT * FROM documents WHERE id=?', int(c.req.param('id')));
  if (!d) return c.notFound();
  if (!s.isAdmin) {
    const owner = d.owner_type === 'stakeholder' ? d.owner_id
      : d.owner_type === 'security' ? (await one<any>(c.env.DB, 'SELECT stakeholder_id FROM securities WHERE id=?', d.owner_id))?.stakeholder_id
      : d.owner_type === 'exercise' ? (await one<any>(c.env.DB, 'SELECT stakeholder_id FROM exercise_requests WHERE id=?', d.owner_id))?.stakeholder_id : null;
    if (owner !== s.stakeholderId) return c.notFound();
  }
  const obj = await c.env.DOCS.get(d.r2_key);
  if (!obj) return c.text('File missing from storage', 404);
  return new Response(obj.body, { headers: { 'Content-Type': d.content_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${d.filename.replace(/"/g, '')}"` } });
});

holder.get('/certificate/:id', async (c) => {
  const r = requireLogin(c); if (r) return r;
  const s = c.get('session')!;
  const sec = await one<any>(c.env.DB, `SELECT s.*, st.name holder, k.name cls FROM securities s JOIN stakeholders st ON st.id=s.stakeholder_id LEFT JOIN stock_classes k ON k.id=s.class_id WHERE s.id=? AND s.kind='share'`, int(c.req.param('id')));
  if (!sec || (!s.isAdmin && sec.stakeholder_id !== s.stakeholderId)) return c.notFound();
  const company = await setting(c.env.DB, 'company_legal_name', c.env.APP_NAME);
  const body = html`<div class="noprint row" style="justify-content:space-between"><a href="javascript:history.back()">← Back</a><button class="btn" onclick="window.print()">Print / save PDF</button></div>
  <div class="card" style="margin-top:16px;padding:48px;text-align:center;border-width:3px">
    <div class="muted small">Certificate No.</div><div style="font-size:22px;font-weight:700">${sec.label}</div>
    <h1 style="margin:24px 0 8px">${company}</h1><div class="muted">${sec.cls}</div>
    <p style="font-size:18px;margin:32px auto;max-width:620px">This certifies that <strong>${sec.holder}</strong> is the registered holder of <strong>${fmtInt(sec.quantity)}</strong> shares of ${sec.cls} of ${company}, issued ${fmtDate(sec.issue_date)}${sec.price != null ? html` at ${fmtUsd(sec.price)} per share` : ''}.</p>
    <div class="small muted">Uncertificated shares recorded in the company's stock ledger. Status: ${sec.status}.</div>
  </div>`;
  return page(c, sec.label, body, undefined, false);
});
