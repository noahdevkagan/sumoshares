#!/usr/bin/env node
// Import Carta's standard report exports into SumoShares.
// Usage: node scripts/import-carta.mjs <folder> > seed-carta.sql   (summary + checks print to stderr)
// Needs (from Carta > Run reports): Securities Ledger, Stakeholder Details, Exercised and Settled, OCX.
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const dir = process.argv[2];
const flag = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
// Optional: --fmv 4.25 --fmv-date 2026-01-01 --company 'Acme, Inc.'
if (!dir) { console.error('usage: import-carta.mjs <folder>'); process.exit(1); }
const log = (...a) => console.error(...a);
const today = new Date().toISOString().slice(0, 10);

function fileLike(re) {
  const f = fs.readdirSync(dir).find((x) => re.test(x) && /\.xlsx$/i.test(x));
  if (!f) return null;
  return XLSX.readFile(path.join(dir, f), { raw: false });
}
function rowsOf(wb, sheetRe, headerCell) {
  const name = wb.SheetNames.find((n) => sheetRe.test(n));
  if (!name) return [];
  const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
  const h = r.findIndex((x) => x.includes(headerCell));
  if (h < 0) return [];
  const hdr = r[h].map((x) => String(x).trim());
  return r.slice(h + 1).filter((x) => x.some((v) => String(v).trim())).map((x) => Object.fromEntries(hdr.map((k, i) => [k, String(x[i] ?? '').trim()])));
}
const n = (v) => { if (v === '' || v == null) return null; const x = parseFloat(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : null; };
const i0 = (v) => Math.round(n(v) ?? 0);
const d = (v) => {
  if (!v) return null; const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s + ' UTC'); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
const q = (v) => v == null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

// ---------- load ----------
const ledgerWb = fileLike(/securities.?ledger/i);
const shWb = fileLike(/stakeholder.?details/i);
const exWb = fileLike(/exercised/i);
const ocxWb = fileLike(/ocx/i);
if (!ledgerWb || !shWb) { log('Need Securities Ledger and Stakeholder Details exports.'); process.exit(2); }
const ledger = rowsOf(ledgerWb, /securities ledger/i, 'Security ID');
const people = rowsOf(shWb, /stakeholder details/i, 'Stakeholder Name');
const exRows = exWb ? rowsOf(exWb, /options exercised/i, 'Security ID') : [];
const sales = exWb ? rowsOf(exWb, /^sales/i, 'Security ID') : [];
const ocxCtx = ocxWb ? rowsOf(ocxWb, /context/i, 'Plan Name') : [];
const ocxSum = ocxWb ? XLSX.utils.sheet_to_json(ocxWb.Sheets[ocxWb.SheetNames.find((s) => /summary/i.test(s))], { header: 1, raw: false, defval: '' }) : [];

// ---------- stakeholders ----------
const out = [];
out.push(`-- Generated from Carta exports on ${new Date().toISOString()}`);
out.push('PRAGMA defer_foreign_keys = ON;');
const sid = new Map(); // carta id -> our id
const byName = new Map();
let k = 0;
for (const p of people) {
  const id = ++k; sid.set(p['ID'], id); byName.set(p['Stakeholder Name'].toLowerCase(), id);
  const addr = [p['Address Line 1'], p['Address Line 2'], p['City'], p['State'], p['Zip Code'], p['Country']].filter(Boolean).join(', ');
  out.push(`INSERT INTO stakeholders (id, name, email, relationship, address, external_id) VALUES (${id},${q(p['Stakeholder Name'])},${q((p['Contact Email'] || '').toLowerCase() || null)},${q(p['Relationship'] || p['Stakeholder Type'])},${q(addr || null)},${q('carta:' + p['ID'])});`);
}
const holderOf = (r) => sid.get(r['Stakeholder ID']) ?? byName.get(String(r['Stakeholder Name']).toLowerCase());

// ---------- classes, plan ----------
const authorized = (cls) => { const row = ocxSum.find((r) => String(r[0]).trim().startsWith(cls)); return row ? i0(row[1]) : null; };
out.push(`INSERT INTO stock_classes (id, name, prefix, authorized, is_preferred, conversion_ratio) VALUES (1,'Common','CS',${q(authorized('Common'))},0,1),(2,'Series A Preferred','PA',${q(authorized('Series A Preferred'))},1,1);`);
const planName = ledger.find((r) => r['Plan Name'])?.['Plan Name'] || 'Equity Incentive Plan';
const reserved = ocxCtx.filter((r) => r['Plan Name'] === planName && n(r['Total Shares Reserved'])).map((r) => i0(r['Total Shares Reserved'])).pop();
const planApproval = d(ocxCtx.find((r) => r['Plan Name'] === planName && /initial/i.test(r['Action']))?.['Date']);
out.push(`INSERT INTO plans (id, name, reserved, class_id, board_approval_date) VALUES (1,${q(planName)},${reserved ?? 0},1,${q(planApproval)});`);

// ---------- vesting schedule ----------
function sched(s) {
  const m = String(s || '').match(/1\/(\d+)(?:th)?\s+monthly/i); if (!m) return null;
  let cliff = 0; const c = String(s).match(/(\d+)\s*(year|month)s?\s*cliff/i); if (c) cliff = +c[1] * (/year/i.test(c[2]) ? 12 : 1);
  return { months: +m[1], cliff };
}
function monthsBetween(a, b) { const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number); let m = (by - ay) * 12 + (bm - am); if (bd < ad) m--; return Math.max(0, m); }
function ourVested(qty, sc, start, stop) { if (!sc || !start || stop < start) return 0; const m = monthsBetween(start, stop); if (m < sc.cliff) return 0; return Math.min(qty, Math.floor(qty * Math.min(m, sc.months) / sc.months)); }

// ---------- securities ----------
const secId = new Map(); let s = 0; const warnings = [];
const txs = [];
const termByHolder = new Map(); // holder -> [{term, issue}]
for (const r of ledger) {
  const label = r['Security ID']; const h = holderOf(r);
  if (!h) { warnings.push(`no stakeholder for ${label}`); continue; }
  const id = ++s; secId.set(label, id);
  const issued = i0(r['Quantity Issued']); const outQ = i0(r['Quantity Outstanding']);
  const issue = d(r['Issue Date']) || d(r['Original Acquisition Date']);
  if (r['Security Type'] === 'Certificate') {
    const cls = /preferred/i.test(r['Share Class']) ? 2 : 1;
    const rep = i0(r['Quantity Repurchased']), can = i0(r['Quantity Canceled']), tr = i0(r['Quantity Transferred']);
    const status = outQ > 0 ? 'outstanding' : rep ? 'repurchased' : tr ? 'transferred' : can ? 'canceled' : 'canceled';
    if (outQ > 0 && outQ !== issued) warnings.push(`${label}: partially outstanding (${outQ} of ${issued}); imported as ${issued}`);
    const sale = sales.find((x) => x['Security ID'] === label);
    out.push(`INSERT INTO securities (id, label, kind, stakeholder_id, class_id, quantity, price, issue_date, status, notes) VALUES (${id},${q(label)},'share',${h},${cls},${issued},${q(n(r['Price Paid Per Share']))},${q(issue)},'${status}',${q([r['Notes'], sale ? `Sold ${sale['Sale Date']} at ${sale['Sale Price Per Share']}` : '', r['Federal Exemption'] ? 'Exemption: ' + r['Federal Exemption'] : ''].filter(Boolean).join('; ') || null)});`);
    if (status !== 'outstanding') txs.push({ id, type: status === 'repurchased' ? 'repurchase' : status === 'transferred' ? 'transfer' : 'cancel', qty: issued, date: d(r['Repurchase Date']) || d(r['Canceled Date']) || d(sale?.['Sale Date']) || issue, price: n(sale?.['Sale Price Per Share']), note: 'Imported from Carta' });
  } else {
    const typ = /iso/i.test(r['Base Award Type']) && r['Is ISO Disqualified?'] !== 'Yes' ? 'ISO' : 'NSO';
    const sc = sched(r['Vesting Schedule']);
    const start = d(r['Vesting Start Date']) || issue;
    const term = d(r['Termination Date']);
    const cartaVested = i0(r['Total Vested Quantity']);
    // our model stops vesting at the holder's termination; check the schedule reproduces Carta's vested count
    let override = null;
    if (!sc) override = cartaVested;
    else { const ov = ourVested(issued, sc, start, term && term < today ? term : today); if (ov !== cartaVested) { override = cartaVested; warnings.push(`${label}: schedule gives ${ov} vested, Carta says ${cartaVested}; using Carta's number as a floor`); } }
    if (term) { if (!termByHolder.has(h)) termByHolder.set(h, []); termByHolder.get(h).push({ term, issue }); }
    const notes = [r['Vesting Schedule'] && !sc ? `Carta schedule: ${r['Vesting Schedule']}` : '', r['Is ISO Disqualified?'] === 'Yes' ? `ISO disqualified ${r['ISO Disqualification Date']}` : '', r['Termination Reason'] ? `Terminated (${r['Termination Reason']})` : ''].filter(Boolean).join('; ');
    out.push(`INSERT INTO securities (id, label, kind, stakeholder_id, plan_id, quantity, issue_date, option_type, exercise_price, expiration_date, exercise_deadline, vest_months, cliff_months, vest_start, vest_override_vested, notes) VALUES (${id},${q(label)},'option',${h},1,${issued},${q(issue)},'${typ}',${q(n(r['Exercise Price']))},${q(d(r['Grant Life Expiration Date']))},${q(d(r['Last Date to Exercise']))},${q(sc?.months ?? null)},${q(sc?.cliff ?? 0)},${q(sc ? start : null)},${q(override)},${q(notes || null)});`);
    const forf = i0(r['Quantity Forfeited']), exp = i0(r['Quantity Expired']), can = i0(r['Quantity Canceled']), exd = i0(r['Quantity Exercised']);
    if (forf) txs.push({ id, type: 'forfeit', qty: forf, date: term || d(r['Canceled Date']) || issue, note: 'Imported from Carta' });
    if (exp) txs.push({ id, type: 'expire', qty: exp, date: d(r['Last Date to Exercise']) || d(r['Grant Life Expiration Date']) || issue, note: 'Imported from Carta' });
    if (can) txs.push({ id, type: 'cancel', qty: can, date: d(r['Canceled Date']) || issue, note: r['Cancellation Reason'] || 'Imported from Carta' });
    const gap = issued - outQ - forf - exp - can - exd;
    if (gap !== 0) warnings.push(`${label}: issued ${issued} != outstanding ${outQ} + exercised ${exd} + forfeited ${forf} + expired ${exp} + canceled ${can} (gap ${gap})`);
    r.__exd = exd;
  }
}

// ---------- exercises (with FMV) ----------
const certs = ledger.filter((r) => r['Security Type'] === 'Certificate');
const usedCerts = new Set();
const exByGrant = new Map();
for (const e of exRows) {
  const g = secId.get(e['Security ID']); if (!g) { warnings.push(`exercise for unknown grant ${e['Security ID']}`); continue; }
  const qty = i0(e['Quantity Exercised']); const date = d(e['Exercise Date']);
  const cert = certs.find((c) => !usedCerts.has(c['Security ID']) && c['Stakeholder Name'] === e['Stakeholder Name'] && i0(c['Quantity Issued']) === qty && d(c['Issue Date']) === date)
    || certs.find((c) => !usedCerts.has(c['Security ID']) && c['Stakeholder Name'] === e['Stakeholder Name'] && i0(c['Quantity Issued']) === qty);
  if (cert) usedCerts.add(cert['Security ID']);
  txs.push({ id: g, type: 'exercise', qty, date, price: n(e['Exercise Price']), fmv: n(e['FMV at Time of Exercise']), res: cert ? secId.get(cert['Security ID']) : null, note: `Imported from Carta (${e['Exercise Type'] || 'exercise'})` });
  exByGrant.set(e['Security ID'], (exByGrant.get(e['Security ID']) || 0) + qty);
}
// exercises in the ledger with no row in the Exercised report (older exercises)
for (const r of ledger.filter((x) => x['Security Type'] !== 'Certificate')) {
  const missing = (r.__exd || 0) - (exByGrant.get(r['Security ID']) || 0);
  if (missing > 0) { txs.push({ id: secId.get(r['Security ID']), type: 'exercise', qty: missing, date: d(r['Issue Date']), price: n(r['Exercise Price']), note: 'Imported from Carta (exercise date not in report)' }); warnings.push(`${r['Security ID']}: ${missing} exercised with no dated exercise row`); }
}
for (const t of txs) out.push(`INSERT INTO transactions (security_id, type, quantity, price, fmv, effective_date, resulting_security_id, note, actor) VALUES (${t.id},'${t.type}',${t.qty},${q(t.price ?? null)},${q(t.fmv ?? null)},${q(t.date)},${q(t.res ?? null)},${q(t.note)},'carta-import');`);
for (const c of certs) if (usedCerts.has(c['Security ID'])) {
  const src = txs.find((t) => t.res === secId.get(c['Security ID']));
  if (src) out.push(`UPDATE securities SET source_security_id=${src.id} WHERE id=${secId.get(c['Security ID'])};`);
}

// ---------- termination dates: only when no grant was issued after it (rehires keep vesting) ----------
for (const [h, list] of termByHolder) {
  const last = list.map((x) => x.term).sort().pop();
  const laterGrant = ledger.some((r) => holderOf(r) === h && r['Security Type'] !== 'Certificate' && d(r['Issue Date']) > last);
  if (!laterGrant) out.push(`UPDATE stakeholders SET termination_date=${q(last)} WHERE id=${h};`);
}

// ---------- valuation + settings ----------
if (flag('fmv') && flag('fmv-date')) { const fd = flag('fmv-date'); out.push(`INSERT INTO valuations (effective_date, fmv, provider, expires_on) VALUES (${q(fd)}, ${Number(flag('fmv'))}, 'Carta', ${q(String(+fd.slice(0, 4) + 1) + fd.slice(4))});`); } else log('No --fmv/--fmv-date given: record the current 409A in the app after import.');
if (flag('company')) out.push(`INSERT OR IGNORE INTO settings (key, value) VALUES ('company_legal_name',${q(flag('company'))});`);
console.log(out.join('\n'));

// ---------- summary ----------
const opt = ledger.filter((r) => r['Security Type'] !== 'Certificate');
const crt = ledger.filter((r) => r['Security Type'] === 'Certificate');
const sum = (rows, f) => rows.reduce((a, r) => a + i0(r[f]), 0);
const common = sum(crt.filter((r) => /common/i.test(r['Share Class'])), 'Quantity Outstanding');
const pref = sum(crt.filter((r) => /preferred/i.test(r['Share Class'])), 'Quantity Outstanding');
const optOut = sum(opt, 'Quantity Outstanding');
const exercised = sum(opt, 'Quantity Exercised');
const avail = (reserved ?? 0) - optOut - exercised;
log(`\nCarta source totals: common ${common}, pref ${pref}, options out ${optOut}, exercised ${exercised}, plan reserved ${reserved}, available ${avail}, FD ${common + pref + optOut + avail}`);
log(`Imported ${people.length} stakeholders, ${crt.length} certificates, ${opt.length} grants, ${exRows.length} dated exercises, ${txs.length} transactions`);
if (warnings.length) log(`Warnings (${warnings.length}):\n  ` + warnings.join('\n  '));
