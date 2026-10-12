import { secureHeaders } from 'hono/secure-headers';
import { html } from './views';
import { newApp, page, str, type C } from './app';
import { one, run, audit, type Env } from './db';
import { readSession, startSession, endSession, createLoginToken, consumeLoginToken, sameOrigin, isAdminEmail, verifyStripeSignature } from './auth';
import { sendMail, adminEmails } from './mail';
import { holder } from './holder';
import { admin } from './admin';
import { reports } from './reports';
import { daily } from './cron';
import { homePage, REPO_URL } from './home';
import { fmtUsd } from './logic';

const app = newApp();
app.use('*', secureHeaders({ referrerPolicy: 'same-origin', contentSecurityPolicy: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'", 'https://checkout.stripe.com'] } }));
app.use('*', sameOrigin);
app.use('*', async (c, next) => { c.set('session', await readSession(c as C)); await next(); });

app.get('/', (c) => { const s = c.get('session'); if (s) return c.redirect(s.isAdmin ? '/admin' : '/me'); return c.html(homePage(c.env.APP_NAME)); });

app.get('/login', (c) => page(c, 'Log in', html`<div class="card" style="max-width:420px;margin:48px auto">
  <h1>${c.env.APP_NAME}</h1><p class="muted">See your equity and exercise options. Enter the email on file and we'll send a login link.</p>
  ${c.req.query('sent') ? html`<div class="banner info">If that email is on file, a login link is on its way. It works for 30 minutes.</div>` : ''}
  ${c.req.query('dev') ? html`<div class="banner warn small">Dev mode link: <a href="${c.req.query('dev')}">${c.req.query('dev')}</a></div>` : ''}
  ${c.req.query('bad') ? html`<div class="banner bad">That link expired or was already used. Request a new one.</div>` : ''}
  <form class="stack" method="post" action="/login"><label>Email<input type="email" name="email" required autofocus></label><button class="btn primary">Email me a login link</button></form><p class="small muted" style="margin-top:16px"><a href="/">What is ${c.env.APP_NAME}?</a> · <a href="${REPO_URL}">Open source on GitHub</a></p></div>`));

app.post('/login', async (c) => {
  const f = await c.req.parseBody();
  const email = str(f.email).toLowerCase();
  // Only send to emails we know (holder or admin). Same response either way so emails can't be probed.
  const known = isAdminEmail(c.env, email) || !!(await one(c.env.DB, 'SELECT 1 FROM stakeholders WHERE lower(email)=?', email));
  console.log('[login] request', { known, domain: email.split('@')[1] || '' });
  let dev = '';
  if (known) {
    const token = await createLoginToken(c.env, email);
    const link = `${c.env.APP_URL}/auth?token=${token}`;
    await sendMail(c.env, email, `Your ${c.env.APP_NAME} login link`, `Log in (link works for 30 minutes):\n${link}\n\nDidn't ask for this? Ignore this email.`);
    if (c.env.DEV_SHOW_LINKS === '1') dev = `&dev=${encodeURIComponent(link)}`;
  }
  return c.redirect(`/login?sent=1${dev}`);
});

app.get('/auth', async (c) => {
  const email = await consumeLoginToken(c.env, c.req.query('token') || '');
  if (!email) return c.redirect('/login?bad=1');
  await startSession(c as C, email);
  await audit(c.env.DB, email, 'login', 'session', null, null, null, c.req.header('cf-connecting-ip') || '');
  return c.redirect(isAdminEmail(c.env, email) ? '/admin' : '/me');
});

// Emergency admin login (works before email is set up). Set ADMIN_BOOTSTRAP_KEY as a secret; delete it once email works.
app.get('/admin-key', async (c) => {
  const k = c.req.query('k') || '';
  const want = (c.env as any).ADMIN_BOOTSTRAP_KEY as string | undefined;
  if (!want || k.length < 32 || k !== want) return c.text('Not found', 404);
  const email = c.env.ADMIN_EMAILS.split(',')[0].trim().toLowerCase();
  await startSession(c as C, email);
  await audit(c.env.DB, email, 'login_bootstrap_key', 'session', null, null, null, c.req.header('cf-connecting-ip') || '');
  return c.redirect('/admin');
});

app.get('/logout', (c) => { endSession(c); return c.redirect('/login'); });

// Stripe webhook: marks a request paid when money settles. Approval stays manual.
app.post('/stripe/webhook', async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return c.text('not configured', 404);
  const body = await c.req.text();
  if (!(await verifyStripeSignature(body, c.req.header('stripe-signature'), c.env.STRIPE_WEBHOOK_SECRET))) return c.text('bad signature', 400);
  const ev = JSON.parse(body);
  const obj = ev.data?.object || {};
  const paidNow = (ev.type === 'checkout.session.completed' && obj.payment_status === 'paid') || ev.type === 'checkout.session.async_payment_succeeded';
  const ref = obj.client_reference_id || obj.metadata?.exercise_reference;
  if (ref && paidNow) {
    const e = await one<any>(c.env.DB, 'SELECT * FROM exercise_requests WHERE reference=?', ref);
    if (e && e.status === 'requested' && Math.round(e.cost * 100) === obj.amount_total) {
      await run(c.env.DB, `UPDATE exercise_requests SET status='paid', method='online', paid_at=datetime('now') WHERE id=?`, e.id);
      await audit(c.env.DB, 'stripe', 'exercise_paid', 'exercise_request', e.id, { status: 'requested' }, { session: obj.id, amount: obj.amount_total }, '');
      await sendMail(c.env, adminEmails(c.env), `Paid online: ${ref} (${fmtUsd(e.cost)})`, `Approve and issue shares: ${c.env.APP_URL}/admin/exercises`);
    }
  }
  if (ref && ev.type === 'checkout.session.async_payment_failed') {
    await sendMail(c.env, adminEmails(c.env), `Online payment failed: ${ref}`, `The holder's bank payment failed. ${c.env.APP_URL}/admin/exercises`);
  }
  return c.json({ received: true });
});

app.route('/', holder);
app.route('/', admin);
app.route('/', reports);

app.notFound((c) => page(c, 'Not found', html`<h1>Not found</h1><p><a href="/">Home</a></p>`));
app.onError((err, c) => { console.error(err); return c.text('Something went wrong: ' + err.message, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(daily(env).then((l) => console.log('[cron]', l.join('; '))));
  },
};
