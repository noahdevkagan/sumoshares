import { html, raw } from './views';

export const REPO_URL = 'https://github.com/noahdevkagan/sumoshares';

const CSS = `
:root{--bg:#fbfbf9;--card:#fff;--ink:#16161a;--quiet:#62626b;--line:#e6e6e1;--accent:#2f6fde;--accent-ink:#fff;--tint:#eef3fd}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1a1a1e;--ink:#ececef;--quiet:#9a9aa4;--line:#2b2b31;--accent:#6b9bff;--accent-ink:#0d0d10;--tint:#1c2436}}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
nav.top{display:flex;align-items:center;justify-content:space-between;padding:18px 0}
nav.top .brand{font-weight:750;letter-spacing:-.02em;color:var(--ink);font-size:18px}
nav.top .links{display:flex;gap:18px;align-items:center}nav.top .links a{color:var(--quiet);font-weight:550}
.btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:11px 18px;border-radius:10px;font-weight:650}
.btn:hover{text-decoration:none;border-color:var(--quiet)}.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.hero{padding:56px 0 36px;max-width:760px}
.hero h1{font-size:clamp(34px,5.5vw,54px);line-height:1.05;letter-spacing:-.035em;margin:0 0 18px}
.hero p{font-size:19px;color:var(--quiet);margin:0 0 26px;max-width:640px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:40px 0 8px}
.fact{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:16px}.fact b{display:block;font-size:22px;letter-spacing:-.02em}.fact span{color:var(--quiet);font-size:14px}
h2{font-size:26px;letter-spacing:-.025em;margin:64px 0 8px}.sub{color:var(--quiet);margin:0 0 22px}
.shots{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}
figure img{display:block;width:100%;height:auto;border-bottom:1px solid var(--line)}
figcaption{padding:12px 14px;font-size:14px;color:var(--quiet)}figcaption b{color:var(--ink)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;counter-reset:s}
.step{border:1px solid var(--line);background:var(--card);border-radius:12px;padding:18px;counter-increment:s}
.step:before{content:counter(s);display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--tint);color:var(--accent);font-weight:700;margin-bottom:10px}
.step h3{margin:0 0 6px;font-size:17px}.step p{margin:0;color:var(--quiet);font-size:15px}
code{font:13.5px ui-monospace,Menlo,monospace;background:var(--tint);padding:1px 6px;border-radius:5px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}ul{padding-left:20px;margin:0}li{margin:4px 0}
footer{border-top:1px solid var(--line);margin-top:72px;padding:26px 0 48px;color:var(--quiet);font-size:14px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
@media (max-width:760px){.shots,.steps,.cols{grid-template-columns:1fr}.hero{padding-top:28px}}
`;

export function homePage(appName: string) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${appName}: open source cap table you host yourself</title>
<meta name="description" content="Open source cap table and option-exercise app. Export from Carta, deploy to Cloudflare in 15 minutes, pay about $5 a month.">
<meta property="og:title" content="${appName}: open source cap table you host yourself"><meta property="og:image" content="/shot-captable.png">
<style>${raw(CSS)}</style></head><body>
<div class="wrap">
<nav class="top"><a class="brand" href="/">${appName}</a><div class="links"><a href="${REPO_URL}">GitHub</a><a href="/login" class="btn">Holder login</a></div></nav>

<section class="hero">
  <h1>Your cap table, without the Carta bill.</h1>
  <p>An open source app to hold your cap table, let employees see their equity and exercise options, and track 409A and option deadlines. Export from Carta, deploy to Cloudflare, pay about $5 a month.</p>
  <div class="cta"><a class="btn primary" href="${REPO_URL}">Get the code on GitHub</a><a class="btn" href="${REPO_URL}#step-1-export-your-data-from-carta">How to move off Carta</a></div>
</section>

<div class="facts">
  <div class="fact"><b>~$0/mo</b><span>Cloudflare free plan + SendFox email, vs about $10k/yr on Carta</span></div>
  <div class="fact"><b>15 min</b><span>to deploy: Workers, D1, R2, SendFox email</span></div>
  <div class="fact"><b>0 diffs</b><span>our import vs Carta, across every holder and grant</span></div>
  <div class="fact"><b>MIT</b><span>open source license, your data stays in your account</span></div>
</div>

<h2>What it looks like</h2>
<p class="sub">Screenshots use made-up demo data.</p>
<div class="shots">
  <figure><img src="/shot-captable.png" alt="Admin cap table with fully diluted totals and 409A reminder" loading="lazy"><figcaption><b>Cap table.</b> Fully diluted by class, as of any date, with the 409A expiry banner.</figcaption></figure>
  <figure><img src="/shot-holders.png" alt="Sortable holders table" loading="lazy"><figcaption><b>Holders.</b> One sortable table with filters, search and CSV export.</figcaption></figure>
  <figure><img src="/shot-holder.png" alt="Holder view of their options" loading="lazy"><figcaption><b>Holder portal.</b> Vested, exercised, exercise price and deadline countdown.</figcaption></figure>
  <figure><img src="/shot-exercise.png" alt="Exercise options form" loading="lazy"><figcaption><b>Exercise.</b> Pick a quantity, sign, get wire instructions (or pay online).</figcaption></figure>
</div>

<h2>Move off Carta in three steps</h2>
<p class="sub">Full walkthrough in the <a href="${REPO_URL}#readme">README</a>.</p>
<div class="steps">
  <div class="step"><h3>Export from Carta</h3><p>Run reports, then export Securities Ledger, Stakeholder Details, Exercised and Settled, and OCX to Excel. Download your certificates and 409A reports.</p></div>
  <div class="step"><h3>Deploy to Cloudflare</h3><p>Clone the repo, create the D1 database and R2 bucket, add a SendFox transactional key for email, then <code>wrangler deploy</code>.</p></div>
  <div class="step"><h3>Import and tie out</h3><p>Run the importer, then the tie-out script. It checks every total, holder and grant against Carta before you cancel.</p></div>
</div>

<h2>What's in it</h2>
<div class="cols">
  <div><ul>
    <li>Cap table of record: classes, plan pool, fully diluted, any as-of date</li>
    <li>Issue, cancel, repurchase and transfer shares; grant, forfeit and expire options</li>
    <li>Holder login by email link, no passwords</li>
    <li>Option exercise with wire instructions, optional Stripe ACH or card</li>
    <li>Terminations: stop vesting, forfeit unvested, set the exercise deadline</li>
  </ul></div>
  <div><ul>
    <li>409A tracking with reminders at 90, 60, 30 and 7 days</li>
    <li>Option deadline reminders to holders</li>
    <li>Exports: CSV, Form 3921 inputs, Open Cap Table Format, full backup</li>
    <li>Append-only audit log of every change</li>
    <li>Nightly backups to R2</li>
  </ul></div>
</div>

<footer><span>Built at AppSumo to replace Carta. Open source under the MIT license.</span><span><a href="${REPO_URL}">GitHub</a> · <a href="/login">Holder login</a></span></footer>
</div></body></html>`;
}
