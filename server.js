/**
 * InstaPort TMS — Unified Server
 * Handles: static files, SA auth, REST API v1, sensor webhooks,
 *          Stripe + PayPal payments, SSE live updates, ERP/WMS hooks,
 *          GPS/Telematics (Traccar/Samsara/Wialon/Generic),
 *          Accounting OAuth (QuickBooks / Xero / Sage),
 *          Notifications (WhatsApp / SMS / Email)
 *
 * npm run dev     → development (serves index.html from root)
 * npm start       → production (serves dist/)
 * npm run release → build + start
 */

require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const cors    = require('cors');
const helmet  = require('helmet');

const app  = express();
const PORT = process.env.PORT || 7434;
const DEV  = process.argv.includes('--dev');
const ROOT = DEV ? __dirname : path.join(__dirname, 'dist');

// ═══════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:  process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// Raw body for Stripe webhooks (must be before express.json)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

// ═══════════════════════════════════════════════════════
// INTEGRATION MODULES
// ═══════════════════════════════════════════════════════
const sensors    = require('./integrations/sensors');
const gps        = require('./integrations/gps');
const notif      = require('./integrations/notifications');
const payment    = require('./integrations/payment');
const paypal     = require('./integrations/paypal');
const accounting = require('./integrations/accounting');
const erp        = require('./integrations/erp');

// ═══════════════════════════════════════════════════════
// SENSOR MANAGER (RMS / IoT / MQTT)
// ═══════════════════════════════════════════════════════
if (process.env.MQTT_BROKER_URL) {
  sensors.connectMQTT(process.env.MQTT_BROKER_URL);
}
if (process.env.SENSOR_POLL_URL) {
  sensors.startHTTPPolling(process.env.SENSOR_POLL_URL, {
    apiKey:     process.env.SENSOR_API_KEY,
    intervalMs: parseInt(process.env.SENSOR_POLL_MS || 30000),
  });
}
if (DEV && !process.env.MQTT_BROKER_URL) {
  sensors.simulateReading('SIM-T01', 'TRK-001');
  sensors.simulateReading('SIM-T02', 'TRK-002');
  setInterval(() => {
    sensors.simulateReading('SIM-T01', 'TRK-001');
    sensors.simulateReading('SIM-T02', 'TRK-002');
  }, 15000);
}

// ═══════════════════════════════════════════════════════
// GPS / TELEMATICS
// ═══════════════════════════════════════════════════════
if (process.env.TRACCAR_URL) {
  gps.startTraccar();
} else if (process.env.SAMSARA_API_KEY) {
  gps.startSamsara();
} else if (process.env.WIALON_TOKEN) {
  gps.startWialon();
} else if (process.env.GPS_POLL_URL) {
  gps.startGeneric(process.env.GPS_POLL_URL, {
    token:      process.env.GPS_API_TOKEN,
    apiKey:     process.env.GPS_API_KEY,
    intervalMs: parseInt(process.env.GPS_POLL_MS || 30000),
  });
} else if (DEV) {
  // Simulate GPS in dev mode
  const simPlates = ['TRK-001', 'TRK-002', 'TRK-003'];
  gps.simulatePositions(simPlates);
  setInterval(() => gps.simulatePositions(simPlates), 20000);
}

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS (auto-alert on sensor events)
// ═══════════════════════════════════════════════════════
const _alertOrg = {
  name:     process.env.ALERT_ORG_NAME || 'InstaPort',
  whatsapp: process.env.ALERT_WHATSAPP,
  email:    process.env.ALERT_EMAIL,
  sms:      process.env.ALERT_SMS,
};
sensors.on('alert', async (alert) => {
  if (_alertOrg.whatsapp || _alertOrg.email || _alertOrg.sms) {
    await notif.notifySensorAlert(alert, _alertOrg);
  }
});
gps.on('geofence', async (event) => {
  const msg = `📍 ${event.type}: Truck ${event.truck} ${event.type === 'ENTERED' ? 'entered' : 'left'} ${event.geofence}`;
  if (_alertOrg.whatsapp) notif.sendWhatsApp(_alertOrg.whatsapp, msg);
  if (_alertOrg.email)    notif.sendEmail({ to: _alertOrg.email, subject: `GPS Geofence — ${event.type}`, text: msg });
});

// ═══════════════════════════════════════════════════════
// SSE — Live stream (sensors + GPS + events)
// ═══════════════════════════════════════════════════════
const _sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('connected',  { ts: new Date().toISOString() });
  send('sensors',    sensors.getSnapshot());
  send('gps',        gps.getSnapshot());

  _sseClients.add(send);
  req.on('close', () => _sseClients.delete(send));
});

function _broadcast(event, data) {
  _sseClients.forEach(send => { try { send(event, data); } catch (e) {} });
}

sensors.on('reading',  r => _broadcast('sensor_reading', r));
sensors.on('alert',    a => _broadcast('sensor_alert',   a));
gps.on('position',     p => _broadcast('gps_position',   p));
gps.on('geofence',     e => _broadcast('gps_geofence',   e));

// ═══════════════════════════════════════════════════════
// SA AUTH (credentials in .env only — timing-safe)
// ═══════════════════════════════════════════════════════
const _saAttempts = {};
function _saRateLimit(ip) {
  const now = Date.now();
  if (!_saAttempts[ip]) _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > _saAttempts[ip].reset) _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  _saAttempts[ip].count++;
  return _saAttempts[ip].count > 5;
}

app.post('/api/sa-auth', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  if (_saRateLimit(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
  const { org, userId, pin } = req.body;
  try {
    const orgOk  = crypto.timingSafeEqual(Buffer.from(org    || '', 'utf8'), Buffer.from(process.env.SA_ORG     || '', 'utf8'));
    const userOk = crypto.timingSafeEqual(Buffer.from(userId || '', 'utf8'), Buffer.from(process.env.SA_USER_ID || '', 'utf8'));
    const pinOk  = crypto.timingSafeEqual(Buffer.from(pin    || '', 'utf8'), Buffer.from(process.env.SA_PIN     || '', 'utf8'));
    if (orgOk && userOk && pinOk) {
      delete _saAttempts[ip];
      return res.json({ ok: true, name: process.env.SA_NAME || 'Super Admin', role: 'superadmin' });
    }
    return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Bad request' });
  }
});

// ═══════════════════════════════════════════════════════
// REST API v1
// ═══════════════════════════════════════════════════════
const apiRouter = require('./integrations/api');
app.use('/api/v1', apiRouter);

// Sensor + GPS snapshot endpoints
app.get('/api/sensors', (req, res) => res.json(sensors.getSnapshot()));
app.get('/api/gps',     (req, res) => res.json(gps.getSnapshot()));
app.get('/api/gps/history/:plate', (req, res) => res.json({ history: gps.getHistory(req.params.plate) }));

// GPS webhook push (from GPS platform → InstaPort)
app.post('/api/webhooks/gps', (req, res) => {
  gps.receivePush(req.body);
  res.json({ ok: true });
});

// ERP webhook receiver
app.post('/api/webhooks/erp', (req, res) => {
  console.log('  🔗 ERP webhook:', req.body?.event || 'unknown');
  global._webhookEvents = global._webhookEvents || [];
  global._webhookEvents.unshift({ source: 'erp', ...req.body, ts: new Date().toISOString() });
  res.json({ ok: true });
});

// Dev test notification
app.post('/api/dev/test-notify', async (req, res) => {
  if (!DEV) return res.status(403).json({ error: 'Dev only' });
  const { to, message, channel } = req.body;
  let result;
  if (channel === 'whatsapp') result = await notif.sendWhatsApp(to, message);
  else if (channel === 'sms') result = await notif.sendSMS(to, message);
  else result = await notif.sendEmail({ to, subject: 'Test', text: message });
  res.json({ ok: result });
});

// ═══════════════════════════════════════════════════════
// STRIPE PAYMENTS
// ═══════════════════════════════════════════════════════
app.post('/api/stripe/checkout', async (req, res) => {
  const { orgId, orgName, email, plan } = req.body;
  res.json(await payment.createCheckoutSession(orgId, orgName, email, plan));
});

app.post('/api/stripe/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const result = await payment.handleWebhook(req.body, sig);
  if (result?.event === 'PAYMENT_COMPLETED') {
    console.log('  💳 Stripe: Upgrading', result.orgId, '→', result.plan);
    _broadcast('plan_upgraded', result);
  }
  res.json({ received: true });
});

app.get('/api/stripe/portal', async (req, res) => {
  const { customerId } = req.query;
  res.json(await payment.createPortalSession(customerId));
});

// ═══════════════════════════════════════════════════════
// PAYPAL PAYMENTS
// ═══════════════════════════════════════════════════════
app.post('/api/paypal/checkout', async (req, res) => {
  const { orgId, orgName, email, plan } = req.body;
  res.json(await paypal.createOrder(orgId, orgName, email, plan));
});

app.get('/api/paypal/capture', async (req, res) => {
  const { token } = req.query; // PayPal sends ?token=ORDER_ID on return
  const result = await paypal.captureOrder(token);
  if (result?.event === 'PAYMENT_COMPLETED') {
    console.log('  💰 PayPal: Upgrading', result.orgId, '→', result.plan);
    _broadcast('plan_upgraded', result);
  }
  // Redirect to app
  const status = result?.ok ? 'upgraded=1' : 'cancelled=1';
  res.redirect(`/?${status}`);
});

app.post('/api/paypal/webhook', async (req, res) => {
  const result = await paypal.handleWebhook(req.body);
  if (result?.event === 'PAYMENT_COMPLETED') {
    _broadcast('plan_upgraded', result);
  }
  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════
// ACCOUNTING OAUTH — QuickBooks & Xero
// ═══════════════════════════════════════════════════════
const OAUTH_BASE = process.env.APP_URL || `http://localhost:${PORT}`;

// QuickBooks OAuth flow
app.get('/api/oauth/quickbooks', (req, res) => {
  const url = accounting.qbOAuthUrl(`${OAUTH_BASE}/api/oauth/quickbooks/callback`);
  if (!url) return res.status(400).json({ error: 'QB_CLIENT_ID not configured' });
  res.redirect(url);
});

app.get('/api/oauth/quickbooks/callback', async (req, res) => {
  const { code, realmId } = req.query;
  try {
    await accounting.qbExchangeCode(code, realmId, `${OAUTH_BASE}/api/oauth/quickbooks/callback`);
    res.redirect('/#sa_integrations?connected=quickbooks');
  } catch (e) {
    res.status(500).send('QuickBooks auth failed: ' + e.message);
  }
});

// Xero OAuth flow
app.get('/api/oauth/xero', (req, res) => {
  const url = accounting.xeroOAuthUrl(`${OAUTH_BASE}/api/oauth/xero/callback`);
  if (!url) return res.status(400).json({ error: 'XERO_CLIENT_ID not configured' });
  res.redirect(url);
});

app.get('/api/oauth/xero/callback', async (req, res) => {
  const { code } = req.query;
  try {
    await accounting.xeroExchangeCode(code, `${OAUTH_BASE}/api/oauth/xero/callback`);
    res.redirect('/#sa_integrations?connected=xero');
  } catch (e) {
    res.status(500).send('Xero auth failed: ' + e.message);
  }
});

// Accounting status + invoice sync
app.get('/api/accounting/status', (req, res) => {
  res.json(accounting.getStatus());
});

app.post('/api/accounting/sync-invoice', async (req, res) => {
  const saToken = req.headers['x-sa-token'];
  if (saToken !== process.env.SA_API_TOKEN) return res.status(403).json({ error: 'SA token required' });
  const result = await accounting.syncInvoiceAll(req.body);
  res.json(result);
});

app.get('/api/accounting/customers', async (req, res) => {
  const saToken = req.headers['x-sa-token'];
  if (saToken !== process.env.SA_API_TOKEN) return res.status(403).json({ error: 'SA token required' });
  const { provider } = req.query;
  if (provider === 'xero') return res.json(await accounting.xeroGetContacts());
  if (provider === 'sage') return res.json(await accounting.sageGetContacts());
  res.json(await accounting.qbGetCustomers());
});

// ═══════════════════════════════════════════════════════
// INTEGRATIONS STATUS (for SA panel)
// ═══════════════════════════════════════════════════════
app.get('/api/integrations/status', (req, res) => {
  const saToken = req.headers['x-sa-token'];
  if (saToken !== process.env.SA_API_TOKEN) return res.status(403).json({ error: 'SA token required' });

  res.json({
    sensors: {
      connected:  sensors.connected,
      count:      sensors.getSnapshot().count,
      mqtt:       !!process.env.MQTT_BROKER_URL,
      httpPoll:   !!process.env.SENSOR_POLL_URL,
    },
    gps: {
      connected:  gps.connected,
      provider:   gps.provider,
      count:      gps.getSnapshot().count,
      traccar:    !!process.env.TRACCAR_URL,
      samsara:    !!process.env.SAMSARA_API_KEY,
      wialon:     !!process.env.WIALON_TOKEN,
      generic:    !!process.env.GPS_POLL_URL,
    },
    notifications: {
      whatsapp:   !!process.env.TWILIO_SID,
      sms:        !!process.env.TWILIO_SID,
      sendgrid:   !!process.env.SENDGRID_KEY,
      mailgun:    !!process.env.MAILGUN_API_KEY,
    },
    payments: {
      stripe:     !!process.env.STRIPE_SECRET_KEY,
      paypal:     paypal.isConfigured(),
      mode:       process.env.PAYPAL_MODE || 'sandbox',
    },
    accounting:    accounting.getStatus(),
    erp: {
      endpoint:   !!process.env.ERP_ENDPOINT,
      wms:        !!process.env.WMS_ENDPOINT,
    },
    api: {
      enabled:    true,
      demoKey:    !!(process.env.DEMO_API_KEY),
    },
  });
});

// ═══════════════════════════════════════════════════════
// STATIC FILES + SPA FALLBACK
// ═══════════════════════════════════════════════════════
app.use(express.static(ROOT));
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// ═══════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════
app.listen(PORT, () => {
  const cfg = (val, label) => val ? `✅ ${label}` : `⚠️  ${label} (not set)`;
  console.log('');
  console.log('  🚀 InstaPort TMS Server');
  console.log('  ══════════════════════════════════════════════════');
  console.log('  URL        : http://localhost:' + PORT);
  console.log('  Mode       : ' + (DEV ? '🔧 Development' : '📦 Production'));
  console.log('  ─────────────────── Sensors ──────────────────────');
  console.log('  MQTT       : ' + (process.env.MQTT_BROKER_URL ? '🌡️  ' + process.env.MQTT_BROKER_URL : DEV ? '🧪 Simulated' : '⚠️  Set MQTT_BROKER_URL'));
  console.log('  HTTP Poll  : ' + (process.env.SENSOR_POLL_URL ? '✅ ' + process.env.SENSOR_POLL_URL : '—'));
  console.log('  ─────────────────── GPS ──────────────────────────');
  console.log('  Provider   : ' + (process.env.TRACCAR_URL ? '📍 Traccar' : process.env.SAMSARA_API_KEY ? '📍 Samsara' : process.env.WIALON_TOKEN ? '📍 Wialon' : process.env.GPS_POLL_URL ? '📍 Generic' : DEV ? '🧪 Simulated' : '⚠️  No GPS configured'));
  console.log('  ─────────────────── Notifications ────────────────');
  console.log('  WhatsApp   : ' + cfg(process.env.TWILIO_SID,      'Twilio WhatsApp/SMS'));
  console.log('  Email      : ' + (process.env.SENDGRID_KEY ? '✅ SendGrid' : process.env.MAILGUN_API_KEY ? '✅ Mailgun' : '⚠️  No email provider'));
  console.log('  ─────────────────── Payments ─────────────────────');
  console.log('  Stripe     : ' + cfg(process.env.STRIPE_SECRET_KEY, 'Stripe'));
  console.log('  PayPal     : ' + cfg(process.env.PAYPAL_CLIENT_ID,  'PayPal (' + (process.env.PAYPAL_MODE || 'sandbox') + ')'));
  console.log('  ─────────────────── Accounting ───────────────────');
  console.log('  QuickBooks : ' + cfg(process.env.QB_CLIENT_ID,    'QuickBooks OAuth'));
  console.log('  Xero       : ' + cfg(process.env.XERO_CLIENT_ID,  'Xero OAuth'));
  console.log('  Sage       : ' + cfg(process.env.SAGE_API_KEY,    'Sage API'));
  console.log('  ─────────────────── Other ────────────────────────');
  console.log('  ERP Push   : ' + cfg(process.env.ERP_ENDPOINT,    'ERP Endpoint'));
  console.log('  REST API   : /api/v1 ✅');
  console.log('  SSE Stream : /api/stream ✅');
  console.log('  ══════════════════════════════════════════════════');
  console.log('');
});
