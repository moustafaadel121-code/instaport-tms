/**
 * integrations/payment.js
 * Stripe payment gateway — plan subscriptions
 */

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Plan → Stripe Price ID mapping (set in Stripe dashboard, put IDs in .env)
const PLAN_PRICES = {
  starter:      process.env.STRIPE_PRICE_STARTER,
  professional: process.env.STRIPE_PRICE_PROFESSIONAL,
  enterprise:   process.env.STRIPE_PRICE_ENTERPRISE,
};

// ── Create a Stripe checkout session for plan upgrade ─────────────
async function createCheckoutSession(orgId, orgName, email, plan, successUrl, cancelUrl) {
  if (!stripe) return { ok: false, error: 'Stripe not configured' };
  const priceId = PLAN_PRICES[plan];
  if (!priceId) return { ok: false, error: 'No price configured for plan: ' + plan };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      metadata: { orgId, plan },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || process.env.STRIPE_SUCCESS_URL || 'http://localhost:7434/?upgraded=1',
      cancel_url:  cancelUrl  || process.env.STRIPE_CANCEL_URL  || 'http://localhost:7434/?cancelled=1',
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (e) {
    console.warn('  Stripe error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Handle Stripe webhook (plan activated after payment) ───────────
async function handleWebhook(rawBody, sig) {
  if (!stripe) return null;
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.warn('  Stripe webhook sig error:', e.message);
    return null;
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { orgId, plan } = session.metadata;
    console.log('  💳 Payment completed:', orgId, '->', plan);
    return { orgId, plan, event: 'PAYMENT_COMPLETED' };
  }
  return null;
}

// ── Create Stripe customer portal link ────────────────────────────
async function createPortalSession(customerId, returnUrl) {
  if (!stripe) return { ok: false, error: 'Stripe not configured' };
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || 'http://localhost:7434/',
    });
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { createCheckoutSession, handleWebhook, createPortalSession, PLAN_PRICES };
