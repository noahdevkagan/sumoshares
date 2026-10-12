import type { Env } from './db';

/** Creates a Stripe Checkout Session for one exercise. ACH bank debit first, card as fallback. */
export async function createCheckout(env: Env, opts: { reference: string; amountCents: number; email: string | null; description: string }) {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', opts.reference);
  body.set('success_url', `${env.APP_URL}/me?paid=${encodeURIComponent(opts.reference)}`);
  body.set('cancel_url', `${env.APP_URL}/me/requests`);
  body.append('payment_method_types[]', 'us_bank_account');
  body.append('payment_method_types[]', 'card');
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(opts.amountCents));
  body.set('line_items[0][price_data][product_data][name]', opts.description);
  body.set('metadata[exercise_reference]', opts.reference);
  body.set('payment_intent_data[metadata][exercise_reference]', opts.reference);
  if (opts.email) body.set('customer_email', opts.email);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'Stripe error');
  return { id: j.id as string, url: j.url as string };
}
