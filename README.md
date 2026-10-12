# SumoShares

A small, self-hosted cap table and option-exercise app. It replaces Carta for companies that mostly just need to:

- keep the cap table (who owns what) as the system of record
- let shareholders and option holders log in and see their equity
- let option holders exercise (wire or optional online payment) and get their shares issued
- track 409A valuations and option deadlines, with email reminders
- export everything cleanly (CSV, Open Cap Table Format) for lawyers, auditors or a buyer

It runs entirely on Cloudflare: Workers (app), D1 (database), R2 (documents and nightly backups), Cron Triggers (reminders) and Email Sending (login links). Expected cost: about $5 a month (Workers Paid plan, needed for Email Sending).

We built it to move AppSumo off Carta (about $10k a year) after seeing we only used a fraction of it. More at [sumoshares.com](https://sumoshares.com).

| Admin: cap table | Admin: holders |
|---|---|
| ![Cap table](https://sumoshares.com/shot-captable.png) | ![Holders](https://sumoshares.com/shot-holders.png) |
| **Holder: their equity** | **Holder: exercise options** |
| ![Holder view](https://sumoshares.com/shot-holder.png) | ![Exercise](https://sumoshares.com/shot-exercise.png) |

*Screenshots use made-up demo data.*

## What's in it

**Holders** (log in with an emailed magic link, no passwords):
- Shares, options (granted, vested, exercised, available), exercise price, deadline countdown, current FMV, % ownership
- Exercise options: pick a quantity, accept the agreement by typing your name, get wire instructions with a reference code. Optional "Pay online" (Stripe ACH or card) if you add a Stripe key
- Request status, certificates, documents, update email and address

**Admins** (emails listed in `ADMIN_EMAILS`):
- Cap table by class with an as-of date picker, fully diluted totals, plan pool
- Holders table: sortable, searchable, filters (employees, ex-employees, investors, deadline in 90 days), CSV export, "view as holder"
- Securities: issue shares, grant options (blocks prices below FMV and grants beyond the pool), cancel, repurchase, transfer, forfeit, expire, upload documents
- Termination: stops vesting, forfeits unvested options, sets the post-termination exercise deadline
- Exercise queue: mark paid, approve (issues the next certificate and records FMV), cancel
- 409A: record valuations; a banner shows from 90 days before expiry; exercises pause automatically if it lapses
- Reports: cap table, holders, securities, options, exercises (Form 3921 inputs), transactions, audit log, OCF JSON, full backup
- Audit log of every change; the database blocks edits and deletes on it

**Daily job:** 409A reminders to admins at 90/60/30/7/0 days, option-deadline reminders to holders at 90/30/7 days, auto-expire options past their deadline, nightly JSON backup to R2, Monday digest of open requests.

## Step 1: Export your data from Carta

Everything comes from Carta's standard reports. No Carta API access is needed.

1. Log in to Carta and open your company.
2. In the left sidebar go to **Essentials > Run reports**, then click **All Reports**.
3. Open each report below, keep the "As of" date as today, and click **Export to Excel**. Carta builds the file in the background; the **Downloads** button at the top of the page shows a count when they're ready. Open it and click **Download** on each one.

   | Report | Section in Carta | Used for |
   |---|---|---|
   | **Securities Ledger** (required) | Securities | Every certificate and option grant, with vesting, exercised, forfeited and expired counts |
   | **Stakeholder Details** (required) | Stakeholder | Names, emails, relationships, addresses |
   | **Exercised and Settled** (recommended) | Transactions | Exercise dates and FMV at exercise (for Form 3921) |
   | **OCX** (recommended) | Capitalization | Authorized shares per class and the plan reserve history |
   | **Options Outstanding Report** | Securities | Cross-check for vested and exercisable counts |
   | **Cap Table** | Capitalization | Cross-check per holder (fully diluted) |

   If Chrome only saves the first file, look for the "This site is trying to download multiple files" prompt near the address bar and click **Allow**.

4. Grab the documents too (Carta doesn't put them in reports):
   - **Share certificates:** Essentials > Manage equity > Shares, tick the select-all box, then **Actions > Print certificates and full detail**, and save as PDF.
   - **409A reports:** Compliance & Tax > Valuations > Download 409A report.
   - **Grant agreements and everything else:** ask Carta support for a bulk document export before you cancel.
5. Write down the totals on Carta's cap table page (fully diluted, each class outstanding, options outstanding, available in plan) and the counts of certificates, grants and completed exercises. You'll check against them in Step 3.
6. Put all the exported `.xlsx` files in one folder, e.g. `~/carta-exports`.

## Step 2: Deploy to Cloudflare (about 15 minutes)

```bash
git clone https://github.com/noahdevkagan/sumoshares && cd sumoshares
npm install
npx wrangler login

# Database and storage
npx wrangler d1 create sumoshares            # paste the database_id into wrangler.toml (both places)
npx wrangler r2 bucket create sumoshares-docs
npx wrangler d1 execute sumoshares --remote --file=schema.sql
```

Edit `wrangler.toml`: under `[env.production]` set the `routes` line to your domain, and under `[env.production.vars]` set `APP_URL`, `ADMIN_EMAILS` and `MAIL_FROM` (an address on your domain). Keep `routes` and `send_email` under `[env.production]` and not under `.vars`, or Cloudflare treats them as plain text and email silently won't send.

Email: in the Cloudflare dashboard go to **Compute > Workers plans** and upgrade to Paid, then **Email Service > Email Sending > Onboard Domain**, pick your domain and click **Activate** (it adds the DNS records). Prefer Resend? Set `RESEND_API_KEY` as a secret instead.

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET --env production
npx wrangler deploy --env production
```

Optional online payments: `npx wrangler secret put STRIPE_SECRET_KEY --env production` and `STRIPE_WEBHOOK_SECRET` (webhook URL `https://<your-domain>/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`).

## Step 3: Import and tie out

```bash
# Optional: check every column was recognized
node scripts/import-carta.mjs ~/carta-exports --inspect

# Build the import (add your current 409A and legal name)
node scripts/import-carta.mjs ~/carta-exports --fmv 4.25 --fmv-date 2026-01-01 --company "Acme, Inc." > seed-carta.sql

# Load it
npx wrangler d1 execute sumoshares --remote --file=seed-carta.sql

# Check totals against the numbers you wrote down
cp tieout.targets.example.json tieout.targets.json   # fill in your Carta numbers
node scripts/tieout.mjs --remote                      # must say "All totals match Carta"

# Check every holder and every outstanding grant (reads the Cap Table and Options Outstanding exports)
node --experimental-strip-types scripts/compare-carta.mjs ~/carta-exports
```

The importer prints warnings for anything it couldn't reproduce exactly (for example a custom vesting schedule). In those cases it uses Carta's vested number. `seed-carta.sql` and `tieout.targets.json` contain your real data and are gitignored. Keep them out of the repo.

Then log in at your domain with an admin email, open **Settings**, and fill in the legal name, wire instructions, exercise agreement text and controller email.

## Before you cancel Carta

1. Tie-out and the per-holder comparison both pass.
2. All documents are downloaded from Carta (certificates, grant agreements, 409A reports), and the ones holders need are uploaded here.
3. The next 409A is ordered and you know when the current one expires.
4. A few holders have tried it, and you've run both systems side by side for a few weeks.
5. Counsel has confirmed anything unusual (for example, grants made under an older plan).

## Local development

```bash
echo "SESSION_SECRET=dev-secret-change-me" > .dev.vars
npx wrangler d1 execute sumoshares --local --file=schema.sql
npx wrangler d1 execute sumoshares --local --file=seed-demo.sql     # placeholder data
npx wrangler dev
# open http://localhost:8787 and log in as you@example.com; the login link shows on screen in dev
```

## Files

| File | What |
|---|---|
| `schema.sql` | Tables. Audit log and transactions are append-only (enforced by triggers) |
| `src/logic.ts` | Vesting, balances and cap table math (no I/O, easy to test) |
| `src/home.ts`, `public/` | Public landing page and its screenshots (edit or delete for your company) |
| `src/holder.ts` | Holder portal, exercise flow, certificates, documents |
| `src/admin.ts` | Admin screens and ledger actions |
| `src/reports.ts` | CSV, OCF and backup exports |
| `src/cron.ts` | Daily reminders, expirations, backups |
| `src/auth.ts` | Magic links, signed session cookie, CSRF check, Stripe signature check |
| `src/mail.ts` | Email via Cloudflare Email Sending or Resend |
| `scripts/import-carta.mjs` | Carta exports to SQL |
| `scripts/tieout.mjs` | Totals vs Carta |
| `scripts/compare-carta.mjs` | Every holder and outstanding grant vs Carta |

## Not included (do these outside the app)

409A valuations (buy from a provider), Form 3921 filing (use the exercises export), payroll withholding on NSO exercises, board consents, Rule 701 tracking, SAFEs, warrants and RSUs.

## License

MIT
