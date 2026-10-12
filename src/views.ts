import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#16161a;--quiet:#6b6b74;--line:#e4e4e0;--accent:#2f6fde;--accent-ink:#fff;--good:#1f8a4c;--warn:#b76e00;--bad:#c23a3a;--tint:#eef3fd;--warn-tint:#fdf4e5}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1b1b1f;--ink:#ececef;--quiet:#9a9aa4;--line:#2c2c33;--accent:#6b9bff;--accent-ink:#0d0d10;--good:#4cc27e;--warn:#e0a24a;--bad:#ff7b7b;--tint:#1d2638;--warn-tint:#2e2516}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header.top{display:flex;align-items:center;gap:20px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
header.top .brand{font-weight:700;letter-spacing:-.01em;color:var(--ink)}
header.top nav{display:flex;gap:16px;flex-wrap:wrap}header.top nav a{color:var(--quiet);font-weight:500}header.top nav a.on{color:var(--ink)}
header.top .who{margin-left:auto;color:var(--quiet);font-size:13px}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;letter-spacing:-.02em;margin:4px 0 16px}h2{font-size:17px;margin:28px 0 10px}
.muted{color:var(--quiet)}.small{font-size:13px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.stat .label{font-size:12.5px;color:var(--quiet)}.stat .value{font-size:22px;font-weight:650;letter-spacing:-.01em;margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12.5px;color:var(--quiet);font-weight:600;white-space:nowrap;background:var(--card)}
th[data-sort]{cursor:pointer;user-select:none}th[data-sort]:hover{color:var(--ink)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--tint)}
.scroll{overflow-x:auto}
.btn{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}
.btn:hover{text-decoration:none;border-color:var(--quiet)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.danger{color:var(--bad)}.btn.sm{padding:4px 10px;font-size:13px}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
.chip{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--ink);background:var(--card)}
.chip.on{background:var(--tint);border-color:var(--accent)}
.banner{border-radius:10px;padding:12px 16px;margin:0 0 16px;border:1px solid}
.banner.warn{background:var(--warn-tint);border-color:var(--warn)}.banner.info{background:var(--tint);border-color:var(--accent)}.banner.bad{border-color:var(--bad)}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.pill.good{color:var(--good);border-color:var(--good)}.pill.warn{color:var(--warn);border-color:var(--warn)}.pill.bad{color:var(--bad);border-color:var(--bad)}
form.stack{display:grid;gap:12px;max-width:520px}
label{display:grid;gap:4px;font-size:13px;color:var(--quiet);font-weight:500}
input,select,textarea{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent)}
.kv{display:grid;grid-template-columns:180px 1fr;gap:6px 16px}.kv dt{color:var(--quiet)}.kv dd{margin:0}
pre.wire{white-space:pre-wrap;background:var(--tint);padding:12px;border-radius:8px;font:13px/1.5 ui-monospace,Menlo,monospace}
.steps{display:flex;gap:0;margin:12px 0}.steps span{flex:1;text-align:center;font-size:12.5px;color:var(--quiet);border-top:3px solid var(--line);padding-top:6px}.steps span.on{color:var(--ink);border-color:var(--accent);font-weight:600}
@media (max-width:640px){header.top{flex-wrap:wrap}.kv{grid-template-columns:1fr}th{position:static}}
@media print{header.top,.noprint{display:none}body{background:#fff}}
`;

const SORT_JS = `
document.querySelectorAll('table.sortable').forEach(t=>{t.querySelectorAll('th[data-sort]').forEach((th,i)=>{th.addEventListener('click',()=>{
 const idx=[...th.parentNode.children].indexOf(th);const tb=t.tBodies[0];const rows=[...tb.rows];const asc=th.dataset.dir!=='asc';
 t.querySelectorAll('th').forEach(h=>delete h.dataset.dir);th.dataset.dir=asc?'asc':'desc';
 const val=r=>{const c=r.cells[idx];const v=c.dataset.v??c.innerText.trim();const n=parseFloat(String(v).replace(/[$,%]/g,''));return isNaN(n)?String(v).toLowerCase():n};
 rows.sort((a,b)=>{const x=val(a),y=val(b);return (x>y?1:x<y?-1:0)*(asc?1:-1)});rows.forEach(r=>tb.appendChild(r));});});});
const q=document.getElementById('q');if(q){q.addEventListener('input',()=>{const s=q.value.toLowerCase();document.querySelectorAll('table.searchable tbody tr').forEach(r=>{r.style.display=r.innerText.toLowerCase().includes(s)?'':'none'})})}
`;

export function layout(opts: { title: string; appName: string; who?: string; admin?: boolean; active?: string; body: H }) {
  const nav = opts.admin
    ? [['/admin', 'Cap table'], ['/admin/holders', 'Holders'], ['/admin/securities', 'Securities'], ['/admin/exercises', 'Exercises'], ['/admin/valuations', '409A'], ['/admin/reports', 'Reports'], ['/admin/audit', 'Audit log'], ['/admin/settings', 'Settings'], ['/me', 'My equity']]
    : opts.who ? [['/me', 'My equity'], ['/me/requests', 'Exercise requests']] : [];
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · ${opts.appName}</title><style>${raw(CSS)}</style></head><body>
<header class="top"><a class="brand" href="${opts.admin ? '/admin' : '/me'}">${opts.appName}</a>
<nav>${nav.map(([h, l]) => html`<a href="${h}" class="${opts.active === h ? 'on' : ''}">${l}</a>`)}</nav>
${opts.who ? html`<span class="who">${opts.who} · <a href="/logout">Log out</a></span>` : ''}</header>
<main>${opts.body}</main><script>${raw(SORT_JS)}</script></body></html>`;
}

export { html, raw };
