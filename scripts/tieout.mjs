#!/usr/bin/env node
// Compare SumoShares totals to the numbers in your Carta account. Usage: node scripts/tieout.mjs [--remote]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
// Targets come from tieout.targets.json (gitignored; copy tieout.targets.example.json and fill in your Carta numbers).
const T = JSON.parse(fs.readFileSync(new URL('../tieout.targets.json', import.meta.url), 'utf8'));
const remote = process.argv.includes('--remote') ? '--remote' : '--local';
const sql = (s) => { const o = execSync(`npx wrangler d1 execute sumoshares ${remote} --json --command "${s.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return JSON.parse(o.slice(o.indexOf('[')))[0].results; };

const common = sql(`SELECT COALESCE(SUM(quantity),0) v FROM securities WHERE kind='share' AND class_id=1 AND status='outstanding'`)[0].v;
const pref = sql(`SELECT COALESCE(SUM(quantity),0) v FROM securities WHERE kind='share' AND class_id=2 AND status='outstanding'`)[0].v;
const granted = sql(`SELECT COALESCE(SUM(quantity),0) v FROM securities WHERE kind='option'`)[0].v;
const closed = sql(`SELECT COALESCE(SUM(t.quantity),0) v FROM transactions t JOIN securities s ON s.id=t.security_id WHERE s.kind='option' AND t.type IN ('exercise','forfeit','expire','cancel')`)[0].v;
const exercised = sql(`SELECT COALESCE(SUM(t.quantity),0) v FROM transactions t WHERE t.type='exercise'`)[0].v;
const reserved = sql(`SELECT reserved v FROM plans WHERE id=1`)[0]?.v ?? 0;
const optOut = granted - closed;
const avail = reserved - optOut - exercised;
const fd = common + pref + optOut + avail;
const certs = sql(`SELECT COUNT(*) v FROM securities WHERE kind='share'`)[0].v;
const grants = sql(`SELECT COUNT(*) v FROM securities WHERE kind='option'`)[0].v;
const exN = sql(`SELECT COUNT(*) v FROM transactions WHERE type='exercise'`)[0].v;

const rows = [
  ['Fully diluted', fd, T.fullyDiluted], ['Common outstanding', common, T.common], ['Preferred outstanding', pref, T.preferred],
  ['Options outstanding', optOut, T.optionsOutstanding], ['Available in plan', avail, T.available], ['Share certificates', certs, T.certificates],
  ['Option grants', grants, T.grants], ['Exercises completed', exN, T.exercises],
];
let bad = 0;
for (const [k, got, want] of rows) { const ok = got === want; if (!ok) bad++; console.log(`${ok ? 'OK  ' : 'DIFF'} ${k.padEnd(22)} ours ${String(got).padStart(10)}  carta ${String(want).padStart(10)}${ok ? '' : `  (${got - want > 0 ? '+' : ''}${got - want})`}`); }
console.log(bad ? `\n${bad} mismatch(es). Do not go live until these match.` : '\nAll totals match Carta.');
process.exit(bad ? 1 : 0);
