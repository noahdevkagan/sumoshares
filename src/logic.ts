// Pure equity math: vesting, balances, cap table. No I/O here so it is easy to test.

export type Security = {
  id: number; label: string; kind: 'share' | 'option'; stakeholder_id: number;
  class_id: number | null; plan_id: number | null; quantity: number; price: number | null;
  issue_date: string; option_type: string | null; exercise_price: number | null;
  expiration_date: string | null; exercise_deadline: string | null;
  vest_months: number | null; cliff_months: number | null; vest_start: string | null;
  vest_override_vested: number | null; status: string; notes: string | null;
};
export type Tx = { id: number; security_id: number; type: string; quantity: number; effective_date: string; price: number | null; fmv: number | null; resulting_security_id: number | null; note: string | null; actor: string | null; created_at: string };
export type Stakeholder = { id: number; name: string; email: string | null; relationship: string | null; termination_date: string | null; address: string | null };
export type StockClass = { id: number; name: string; prefix: string | null; authorized: number | null; is_preferred: number; conversion_ratio: number };
export type Plan = { id: number; name: string; reserved: number; class_id: number | null; board_approval_date: string | null; expiration_date: string | null };

export const today = () => new Date().toISOString().slice(0, 10);

export function monthsBetween(a: string, b: string): number {
  // whole months elapsed from a to b (vesting happens on the same day-of-month)
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  let m = (by - ay) * 12 + (bm - am);
  if (bd < ad) m -= 1;
  return Math.max(0, m);
}

export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysUntil(d: string, from = today()): number {
  return Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
}

/** Options vested as of a date (before subtracting exercises). Vesting stops at termination. */
export function vestedAsOf(s: Security, asOf: string, terminationDate?: string | null): number {
  if (s.kind !== 'option') return s.quantity;
  const stop = terminationDate && terminationDate < asOf ? terminationDate : asOf;
  if (!s.vest_months || !s.vest_start) {
    // no schedule: fully vested at grant unless an imported vested number exists
    return s.vest_override_vested ?? s.quantity;
  }
  if (stop < s.vest_start) return 0;
  const m = monthsBetween(s.vest_start, stop);
  if (m < (s.cliff_months || 0)) return 0;
  const v = Math.floor((s.quantity * Math.min(m, s.vest_months)) / s.vest_months);
  return Math.min(s.quantity, Math.max(v, s.vest_override_vested ?? 0));
}

/** Per-option balances from its transactions. */
export function optionBalance(s: Security, txs: Tx[], asOf = today(), terminationDate?: string | null) {
  const mine = txs.filter((t) => t.security_id === s.id && t.effective_date <= asOf);
  const sum = (type: string) => mine.filter((t) => t.type === type).reduce((a, t) => a + t.quantity, 0);
  const exercised = sum('exercise');
  const forfeited = sum('forfeit');
  const expired = sum('expire');
  const canceled = sum('cancel');
  const outstanding = Math.max(0, s.quantity - exercised - forfeited - expired - canceled);
  const vested = vestedAsOf(s, asOf, terminationDate);
  const exercisable = Math.max(0, Math.min(vested - exercised, outstanding));
  return { granted: s.quantity, exercised, forfeited, expired, canceled, outstanding, vested, exercisable, unvested: Math.max(0, outstanding - exercisable) };
}

export function optionDeadline(s: Security): string | null {
  const d = [s.exercise_deadline, s.expiration_date].filter(Boolean) as string[];
  return d.length ? d.sort()[0] : null;
}

/** Share certificate is outstanding as of date if issued by then and not canceled/repurchased/transferred before then. */
export function shareOutstanding(s: Security, txs: Tx[], asOf = today()): number {
  if (s.kind !== 'share' || s.issue_date > asOf) return 0;
  const ended = txs.some((t) => t.security_id === s.id && ['cancel', 'repurchase', 'transfer'].includes(t.type) && t.effective_date <= asOf);
  if (ended) return 0;
  if (s.status !== 'outstanding' && !txs.some((t) => t.security_id === s.id)) return 0; // imported as already ended
  return s.quantity;
}

export type CapTable = {
  asOf: string;
  classes: { cls: StockClass; outstanding: number }[];
  plans: { plan: Plan; outstanding: number; exercised: number; available: number }[];
  byHolder: { holder: Stakeholder; shares: number; optionsOutstanding: number; optionsVested: number; fd: number; pct: number; deadline: string | null }[];
  fullyDiluted: number;
};

export function buildCapTable(holders: Stakeholder[], classes: StockClass[], plans: Plan[], secs: Security[], txs: Tx[], asOf = today()): CapTable {
  const hById = new Map(holders.map((h) => [h.id, h]));
  const classOut = new Map<number, number>();
  const planOut = new Map<number, number>();
  const planEx = new Map<number, number>();
  const perHolder = new Map<number, { shares: number; oo: number; ov: number; deadline: string | null }>();
  const ensure = (id: number) => { if (!perHolder.has(id)) perHolder.set(id, { shares: 0, oo: 0, ov: 0, deadline: null }); return perHolder.get(id)!; };

  for (const s of secs) {
    if (s.kind === 'share') {
      const q = shareOutstanding(s, txs, asOf);
      if (!q) continue;
      const cls = classes.find((c) => c.id === s.class_id);
      const asConv = Math.round(q * (cls?.conversion_ratio ?? 1));
      classOut.set(s.class_id!, (classOut.get(s.class_id!) || 0) + q);
      ensure(s.stakeholder_id).shares += asConv;
    } else {
      if (s.issue_date > asOf) continue;
      const h = hById.get(s.stakeholder_id);
      const b = optionBalance(s, txs, asOf, h?.termination_date);
      planOut.set(s.plan_id!, (planOut.get(s.plan_id!) || 0) + b.outstanding);
      planEx.set(s.plan_id!, (planEx.get(s.plan_id!) || 0) + b.exercised);
      if (b.outstanding > 0) {
        const r = ensure(s.stakeholder_id);
        r.oo += b.outstanding; r.ov += b.exercisable;
        const dl = optionDeadline(s);
        if (dl && b.exercisable > 0 && (!r.deadline || dl < r.deadline)) r.deadline = dl;
      }
    }
  }
  const planRows = plans.map((p) => {
    const outstanding = planOut.get(p.id) || 0;
    const exercised = planEx.get(p.id) || 0;
    return { plan: p, outstanding, exercised, available: Math.max(0, p.reserved - outstanding - exercised) };
  });
  const classRows = classes.map((c) => ({ cls: c, outstanding: classOut.get(c.id) || 0 }));
  const fullyDiluted =
    classRows.reduce((a, r) => a + Math.round(r.outstanding * (r.cls.conversion_ratio ?? 1)), 0) +
    planRows.reduce((a, r) => a + r.outstanding + r.available, 0);
  const byHolder = [...perHolder.entries()].map(([id, r]) => {
    const fd = r.shares + r.oo;
    return { holder: hById.get(id)!, shares: r.shares, optionsOutstanding: r.oo, optionsVested: r.ov, fd, pct: fullyDiluted ? fd / fullyDiluted : 0, deadline: r.deadline };
  }).filter((r) => r.holder && r.fd > 0).sort((a, b) => b.fd - a.fd);
  return { asOf, classes: classRows, plans: planRows, byHolder, fullyDiluted };
}

/** Vesting curve points for a small chart: [{date, vested}] at each vest month. */
export function vestingCurve(s: Security, terminationDate?: string | null) {
  if (!s.vest_months || !s.vest_start) return [];
  const pts: { date: string; vested: number }[] = [];
  for (let m = 0; m <= s.vest_months; m++) {
    const d = addMonths(s.vest_start, m);
    pts.push({ date: d, vested: vestedAsOf(s, d, terminationDate) });
  }
  return pts;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmtUsd = (n: number | null | undefined) => n == null ? '' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (n: number) => (n * 100).toFixed(2) + '%';
export function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + day + ', ' + y;
}
