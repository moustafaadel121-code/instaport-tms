/**
 * integrations/paypal.js
 * PayPal Payments — one-time orders & subscriptions
 */

const axios = require('axios');

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let _accessToken = null;
let _tokenExpiry = 0;

async function _getToken() {
  if (!process.env.PAYPAL_CLIENT_ID) throw new Error('PayPal not configured');
  if (_accessToken && Date.now() < _tokenExpiry - 60000) return _accessToken;
  const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _accessToken = res.data.access_token;
  _tokenExpiry = Date.now() + res.data.expires_in * 1000;
  return _accessToken;
}

// Plan prices (USD) — set in .env or defaults
const PLAN_PRICES = {
  starter:      parseFloat(process.env.PAYPAL_PRICE_STARTER      || 99),
  professional: parseFloat(process.env.PAYPAL_PRICE_PROFESSIONAL || 299),
  enterprise:   parseFloat(process.env.PAYPAL_PRICE_ENTERPRISE   || 999),
};

// ── Create PayPal checkout order ─────────────────────────────────
async function createOrder(orgId, orgName, email, plan) {
  if (!process.env.PAYPAL_CLIENT_ID) return { ok: false, error: 'PayPal not configured' };
  const amount = PLAN_PRICES[plan];
  if (!amount) return { ok: false, error: 'Unknown plan: ' + plan };

  try {
    const token = await _getToken();
    const res = await axios.post(`${PAYPAL_BASE}/v2/checkout/orders`, {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: orgId,
        description:  `InstaPort TMS — ${plan} plan`,
        custom_id:    JSON.stringify({ orgId, plan }),
        amount: { currency_code: 'USD', value: amount.toFixed(2) },
        payee: { email_address: process.env.PAYPAL_MERCHANT_EMAIL },
      }],
      payer: { email_address: email },
      application_context: {
        brand_name:          'InstaPort TMS',
        landing_page:        'BILLING',
        shipping_preference: 'NO_SHIPPING',
        user_action:         'PAY_NOW',
        return_url: process.env.PAYPAL_SUCCESS_URL || 'http://localhost:7434/?upgraded=1',
        cancel_url: process.env.PAYPAL_CANCEL_URL  || 'http://localhost:7434/?cancelled=1',
      },
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });

    const approveLink = res.data.links?.find(l => l.rel === 'approve')?.href;
    console.log('  💰 PayPal order created:', res.data.id, '→', plan);
    return { ok: true, orderId: res.data.id, url: approveLink, provider: 'paypal' };
  } catch (e) {
    console.warn('  PayPal order error:', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

// ── Capture PayPal order (called after buyer approves) ───────────
async function captureOrder(orderId) {
  try {
    const token = await _getToken();
    const res = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    const unit  = res.data.purchase_units?.[0];
    const meta  = JSON.parse(unit?.custom_id || '{}');
    console.log('  💰 PayPal captured:', orderId, '→', meta.plan);
    return { ok: true, orderId, orgId: meta.orgId, plan: meta.plan, event: 'PAYMENT_COMPLETED', provider: 'paypal' };
  } catch (e) {
    console.warn('  PayPal capture error:', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

// ── Handle PayPal webhook ────────────────────────────────────────
async function handleWebhook(body) {
  const type = body.event_type;
  console.log('  💰 PayPal webhook:', type);

  if (type === 'CHECKOUT.ORDER.APPROVED') {
    const orderId = body.resource?.id;
    if (orderId) return captureOrder(orderId);
  }
  if (type === 'PAYMENT.CAPTURE.COMPLETED') {
    const unit = body.resource?.supplementary_data?.related_ids;
    const custom = body.resource?.custom_id;
    if (custom) {
      const meta = JSON.parse(custom);
      return { ok: true, orgId: meta.orgId, plan: meta.plan, event: 'PAYMENT_COMPLETED', provider: 'paypal' };
    }
  }
  return null;
}

// ── Get order details ─────────────────────────────────────────────
async function getOrder(orderId) {
  try {
    const token = await _getToken();
    const res = await axios.get(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return { ok: true, order: res.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function isConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

module.exports = { createOrder, captureOrder, handleWebhook, getOrder, isConfigured, PLAN_PRICES };
