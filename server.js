/**
 * InstaPort TMS — Unified Server
 * Handles: static files, SA auth, REST API v1, sensor webhooks,
 *          Stripe payments, SSE live updates, ERP/WMS hooks
 *
 * npm run dev     → development (serves index.html from root)
 * npm start       → production (serves dist/)
 * npm run release → build + start
 */

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const cors       = require('cors');
const helmet     = require('helmet');

const app  = express();
const PORT = process.env.PORT || 7434;
const DEV  = process.argv.includes('--dev');
const ROOT = DEV ? __dirname : path.join(__dirname, 'dist');

// ═══════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false, // relax for inline scripts in index.html
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// Raw body for Stripe webhooks (must be before express.json)
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

// ═══════════════════════════════════════════════════════
// SENSOR MANAGER (RMS / IoT / MQTT)
// ═══════════════════════════════════════════════════════
const sensors = require('./integrations/sensors');

// Connect to MQTT broker if configured
if (process.env.MQTT_BROKER_URL) {
  sensors.connectMQTT(process.env.MQTT_BROKER_URL);
}
// Start HTTP polling if configured
if (process.env.SENSOR_POLL_URL) {
  sensors.startHTTPPolling(process.env.SENSOR_POLL_URL, {
    apiKey: process.env.SENSOR_API_KEY,
    intervalMs: parseInt(process.env.SENSOR_POLL_MS || 30000),
  });
}
// Dev mode: simulate readings every 15 sec
if (DEV && !process.env.MQTT_BROKER_URL) {
  setInterval(() => {
    sensors.simulateReading('SIM-T01', 'TRK-001');
    sensors.simulateReading('SIM-T02', 'TRK-002');
  }, 15000);
  sensors.simulateReading('SIM-T01', 'TRK-001'); // immediate on start
}

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS (WhatsApp / SMS / Email)
// ═══════════════════════════════════════════════════════
const notif = require('./integrations/notifications');

// Auto-notify on sensor alerts
sensors.on('alert', async (alert) => {
  const org = {
    name:      process.env.ALERT_ORG_NAME  || 'InstaPort',
    whatsapp:  process.env.ALERT_WHATSAPP,
    email:     process.env.ALERT_EMAIL,
    sms:       process.env.ALERT_SMS,
  };
  if (org.whatsapp || org.email || org.sms) {
    await notif.notifySensorAlert(alert, org);
  }
});

// ═══════════════════════════════════════════════════════
// SSE — Live sensor/event stream for browser dashboard
// ═══════════════════════════════════════════════════════
const _sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('connected', { ts: new Date().toISOString() });

  // Send current sensor snapshot immediately
  send('sensors', sensors.getSnapshot());

  _sseClients.add(send);
  req.on('close', () => _sseClients.delete(send));
});

// Broadcast sensor readings to all SSE clients
sensors.on('reading', (reading) => {
  _sseClients.forEach(send => {
    try { send('sensor_reading', reading); } catch (e) {}
  });
});
sensors.on('alert', (alert) => {
  _sseClients.forEach(send => {
    try { send('sensor_alert', alert); } catch (e) {}
  });
});

// ═══════════════════════════════════════════════════════
// SA AUTH (Level 2 — credentials in .env only)
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

// Sensor snapshot endpoint (no auth — for internal dashboard polls)
app.get('/api/sensors', (req, res) => res.json(sensors.getSnapshot()));

// Trigger a test notification (dev only)
app.post('/api/dev/test-notify', async (req, res) => {
  if (!DEV) return res.status(403).json({ error: 'Dev only' });
  const { to, message, channel } = req.body;
  let result;
  if (channel === 'whatsapp') result = await notif.sendWhatsApp(to, message);
  else if (channel === 'sms') result = await notif.sendSMS(to, message);
  else result = await notif.sendEmail({ to, subject: 'Test', text: message });
  res.json({ ok: result });
});

// ERP webhook receiver (external ERP pushes events here)
app.post('/api/webhooks/erp', (req, res) => {
  console.log('  🔗 ERP webhook received:', req.body?.event || 'unknown');
  global._webhookEvents = global._webhookEvents || [];
  global._webhookEvents.unshift({ source: 'erp', ...req.body, ts: new Date().toISOString() });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// STRIPE PAYMENTS
// ═══════════════════════════════════════════════════════
const payment = require('./integrations/payment');

app.post('/api/stripe/checkout', async (req, res) => {
  const { orgId, orgName, email, plan } = req.body;
  const result = await payment.createCheckoutSession(orgId, orgName, email, plan);
  res.json(result);
});

app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const result = await payment.handleWebhook(req.body, sig);
  if (result?.event === 'PAYMENT_COMPLETED' && result.orgId && result.plan) {
    // Update plan in Supabase (if available)
    console.log('  💳 Upgrading', result.orgId, 'to', result.plan);
    // TODO: update Supabase tenants table here
  }
  res.json({ received: true });
});

app.get('/api/stripe/portal', async (req, res) => {
  const { customerId } = req.query;
  const result = await payment.createPortalSession(customerId);
  res.json(result);
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
  console.log('');
  console.log('  🚀 InstaPort TMS Server');
  console.log('  ═══════════════════════════════════════════');
  console.log('  URL      : http://localhost:' + PORT);
  console.log('  Mode     : ' + (DEV ? '🔧 Development' : '📦 Production (dist/)'));
  console.log('  SA Auth  : /api/sa-auth ✅');
  console.log('  REST API : /api/v1 ✅');
  console.log('  Sensors  : ' + (process.env.MQTT_BROKER_URL ? '🌡️ MQTT connected' : DEV ? '🧪 Simulated' : '⚠️ Set MQTT_BROKER_URL'));
  console.log('  Stream   : /api/stream (SSE) ✅');
  console.log('  Stripe   : ' + (process.env.STRIPE_SECRET_KEY ? '💳 Configured' : '⚠️ Set STRIPE_SECRET_KEY'));
  console.log('  WhatsApp : ' + (process.env.TWILIO_SID ? '📱 Configured' : '⚠️ Set TWILIO_SID'));
  console.log('  Email    : ' + (process.env.SENDGRID_KEY ? '📧 Configured' : '⚠️ Set SENDGRID_KEY'));
  console.log('  ═══════════════════════════════════════════');
  console.log('');
});
