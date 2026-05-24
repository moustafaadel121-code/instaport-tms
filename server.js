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

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
// Runtime config must load BEFORE other integrations so saved keys are in process.env
const cfg = require('./integrations/config');

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const cors    = require('cors');
const helmet  = require('helmet');
const auth    = require('./integrations/auth');

const app  = express();
const PORT = process.env.PORT || 7434;
const DEV  = process.argv.includes('--dev');
const ROOT = DEV ? __dirname : path.join(__dirname, 'dist');

// ═══════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════
app.use(helmet({ contentSecurityPolicy: false }));
const _ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: function(origin, cb){
    // Allow no-origin requests (curl, mobile apps, same-origin)
    if(!origin) return cb(null, true);
    if(_ALLOWED_ORIGINS.includes('*')) return cb(null, true);
    if(_ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith('.github.io')))
      return cb(null, true);
    cb(new Error('CORS: origin not allowed: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
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

// ── Localhost-only guard — SA panel never reachable from internet ──
function _localOnly(req, res, next) {
  const raw = req.ip || req.socket.remoteAddress || '';
  const ip  = raw.replace(/^::ffff:/, ''); // normalise IPv4-mapped IPv6
  const ok  = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
  if (!ok) {
    return res.status(403).json({
      ok: false,
      error: 'SA access is restricted to localhost only. Open http://localhost:' + (process.env.PORT || 7434) + ' on your server machine.'
    });
  }
  next();
}

const _saAttempts = {};
function _saRateLimit(ip) {
  const now = Date.now();
  if (!_saAttempts[ip]) _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > _saAttempts[ip].reset) _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  _saAttempts[ip].count++;
  return _saAttempts[ip].count > 5;
}

app.post('/api/sa-auth', _localOnly, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  if (_saRateLimit(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
  try {
    const { org, userId, pin, totp } = req.body || {};
    // timingSafeEqual requires equal-length buffers — pad to max length to avoid throws
    function _safeEq(a, b) {
      const ba = Buffer.from(a || '', 'utf8');
      const bb = Buffer.from(b || '', 'utf8');
      const len = Math.max(ba.length, bb.length, 1);
      const pa = Buffer.alloc(len); ba.copy(pa);
      const pb = Buffer.alloc(len); bb.copy(pb);
      return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length;
    }
    const orgOk  = _safeEq(org,    process.env.SA_ORG     || '');
    const userOk = _safeEq(userId, process.env.SA_USER_ID || '');
    const pinOk  = _safeEq(pin,    process.env.SA_PIN     || '');
    if (orgOk && userOk && pinOk) {
      // ── 2FA check (if enabled) ────────────────────────────────
      if (auth.isTotpEnabled()) {
        if (!totp) {
          // Credentials correct but 2FA code not yet provided
          return res.json({ ok: false, require2FA: true, message: 'Enter your 6-digit authenticator code.' });
        }
        if (!auth.verifyTotp(totp)) {
          auth.saAudit('SA_2FA_FAIL', `Wrong TOTP for user=${userId}`, ip);
          return res.status(401).json({ ok: false, error: 'Invalid authenticator code. Try again.' });
        }
        auth.saAudit('SA_2FA_OK', `TOTP verified for user=${userId}`, ip);
      }
      delete _saAttempts[ip];
      const saToken = auth.issueToken({ role: 'superadmin', userId, org });
      auth.saAudit('SA_LOGIN', 'Login successful', ip);
      return res.json({ ok: true, name: process.env.SA_NAME || 'Super Admin', role: 'superadmin', token: saToken });
    }
    auth.saAudit('SA_LOGIN_FAIL', `Failed attempt org=${org} user=${userId}`, ip);
    return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Bad request' });
  }
});

// ── SA 2FA Setup — generate secret + QR (localhost only) ─────────
app.get('/api/sa-2fa/setup', _localOnly, async (req, res) => {
  try {
    const data = await auth.generateTotpSecret();
    auth.saAudit('SA_2FA_SETUP', 'New TOTP secret generated', req.ip);
    res.json({ ok: true, ...data, instructions: [
      '1. Open Google Authenticator or Authy on your phone',
      '2. Tap + → Scan QR code (use the qrDataUrl as an <img> src to display it)',
      '3. Add these lines to your .env file and restart:',
      `   SA_TOTP_SECRET=${data.secret}`,
      '   SA_TOTP_ENABLED=true',
      '4. Test with /api/sa-2fa/verify?token=YOUR_CODE',
    ]});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SA 2FA Verify — test a TOTP code before enabling ─────────────
app.get('/api/sa-2fa/verify', _localOnly, (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, error: 'token query param required' });
  const valid = auth.verifyTotp(token);
  res.json({ ok: valid, message: valid ? '✅ Code is valid — 2FA working correctly' : '❌ Invalid code' });
});

// ── SA Audit Log (localhost only) ────────────────────────────────
app.get('/api/sa-audit', _localOnly, (req, res) => {
  res.json({ ok: true, log: auth.getSaAuditLog(200) });
});

// ── Supabase RLS script (localhost only) ─────────────────────────
app.get('/api/sa-rls-script', _localOnly, (req, res) => {
  res.type('text/plain').send(auth.getRlsScript());
});

// ═══════════════════════════════════════════════════════
// USER AUTH — bcrypt PIN verification + JWT session token
// (Works alongside Supabase; server verifies PIN never browser)
// ═══════════════════════════════════════════════════════
const _authAttempts = {};
function _authRateLimit(ip) {
  const now = Date.now();
  if (!_authAttempts[ip]) _authAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > _authAttempts[ip].reset) _authAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  _authAttempts[ip].count++;
  return _authAttempts[ip].count > 10;
}

app.post('/api/auth', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (_authRateLimit(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
  const { org, userId, pin } = req.body || {};
  if (!org || !userId || !pin) return res.status(400).json({ ok: false, error: 'org, userId, pin required' });
  // Block SA org from regular auth endpoint
  if (org === (process.env.SA_ORG || 'ip-master')) {
    return res.status(403).json({ ok: false, error: 'Use SA login for this organization.' });
  }
  try {
    const user  = await auth.authenticateUser(org, userId, pin);
    const token = auth.issueToken({ ...user, iat: Date.now() });
    delete _authAttempts[ip];
    return res.json({ ok: true, token, user: { name: user.name, role: user.role, orgId: user.orgId, orgName: user.orgName, plan: user.plan } });
  } catch (e) {
    _authAttempts[ip] = _authAttempts[ip] || { count: 1, reset: Date.now() + 15 * 60 * 1000 };
    return res.status(401).json({ ok: false, error: e.message });
  }
});

// ── Verify a session token (browser calls this on page refresh) ──
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body || {};
  const payload = auth.verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Session expired' });
  // Issue a fresh token (sliding window)
  const newToken = auth.issueToken({ ...payload, iat: undefined, exp: undefined });
  return res.json({ ok: true, token: newToken, user: { name: payload.name, role: payload.role, orgId: payload.orgId, plan: payload.plan } });
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
// ACCOUNTING OAUTH — QuickBooks & Xero  (SA / localhost only)
// ═══════════════════════════════════════════════════════
const OAUTH_BASE = process.env.APP_URL || `http://localhost:${PORT}`;

// QuickBooks OAuth flow
app.get('/api/oauth/quickbooks', _localOnly, (req, res) => {
  const url = accounting.qbOAuthUrl(`${OAUTH_BASE}/api/oauth/quickbooks/callback`);
  if (!url) return res.status(400).json({ error: 'QB_CLIENT_ID not configured' });
  res.redirect(url);
});

app.get('/api/oauth/quickbooks/callback', _localOnly, async (req, res) => {
  const { code, realmId } = req.query;
  try {
    await accounting.qbExchangeCode(code, realmId, `${OAUTH_BASE}/api/oauth/quickbooks/callback`);
    res.send(_oauthSuccessPage('QuickBooks', 'quickbooks'));
  } catch (e) {
    res.send(_oauthErrorPage('QuickBooks', e.message));
  }
});

// Xero OAuth flow
app.get('/api/oauth/xero', _localOnly, (req, res) => {
  const url = accounting.xeroOAuthUrl(`${OAUTH_BASE}/api/oauth/xero/callback`);
  if (!url) return res.status(400).json({ error: 'XERO_CLIENT_ID not configured' });
  res.redirect(url);
});

app.get('/api/oauth/xero/callback', _localOnly, async (req, res) => {
  const { code } = req.query;
  try {
    await accounting.xeroExchangeCode(code, `${OAUTH_BASE}/api/oauth/xero/callback`);
    res.send(_oauthSuccessPage('Xero', 'xero'));
  } catch (e) {
    res.send(_oauthErrorPage('Xero', e.message));
  }
});

// ── OAuth popup helper pages ──────────────────────────────────────
function _oauthSuccessPage(label, provider) {
  return `<!DOCTYPE html><html><head><title>${label} Connected</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f0f1a;color:#fff;}
.box{text-align:center;}.icon{font-size:56px;}.msg{font-size:18px;margin:12px 0 4px;}.sub{font-size:13px;opacity:.6;}</style></head>
<body><div class="box"><div class="icon">✅</div>
<div class="msg">${label} connected successfully</div>
<div class="sub">This window will close automatically…</div></div>
<script>
  try{window.opener&&window.opener.postMessage({type:'oauth_success',provider:'${provider}'},'*');}catch(e){}
  setTimeout(function(){window.close();},1800);
</script></body></html>`;
}
function _oauthErrorPage(label, msg) {
  return `<!DOCTYPE html><html><head><title>${label} Error</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f0f1a;color:#fff;}
.box{text-align:center;max-width:420px;padding:24px;}.icon{font-size:56px;}.msg{font-size:16px;margin:12px 0 4px;}.sub{font-size:12px;opacity:.5;word-break:break-all;}</style></head>
<body><div class="box"><div class="icon">❌</div>
<div class="msg">${label} connection failed</div>
<div class="sub">${msg}</div></div>
<script>
  try{window.opener&&window.opener.postMessage({type:'oauth_error',provider:'${label.toLowerCase()}',message:'${msg.replace(/'/g,"\\'")}'},'*');}catch(e){}
  setTimeout(function(){window.close();},4000);
</script></body></html>`;
}

// Accounting status + invoice sync
app.get('/api/accounting/status',           _localOnly, (req, res) => {
  res.json(accounting.getStatus());
});

app.post('/api/accounting/sync-invoice',    _localOnly, async (req, res) => {
  const result = await accounting.syncInvoiceAll(req.body);
  res.json(result);
});

app.get('/api/accounting/customers',        _localOnly, async (req, res) => {
  const { provider } = req.query;
  if (provider === 'xero') return res.json(await accounting.xeroGetContacts());
  if (provider === 'sage') return res.json(await accounting.sageGetContacts());
  res.json(await accounting.qbGetCustomers());
});

// ═══════════════════════════════════════════════════════
// INTEGRATIONS STATUS / CONFIG / TEST (SA / localhost only)
// ═══════════════════════════════════════════════════════
app.get('/api/integrations/status', _localOnly, (req, res) => {
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
// SA CONFIG — Save credentials from UI panel (no .env editing)
// ═══════════════════════════════════════════════════════

// Save config values posted from SA Integrations page
app.post('/api/integrations/config', _localOnly, (req, res) => {

  const { values, reinit } = req.body; // values = { KEY: 'value', ... }
  if (!values || typeof values !== 'object') return res.status(400).json({ error: 'values object required' });

  // Save to runtime store + process.env
  cfg.set(values);

  // Re-initialize affected integrations live (no restart needed)
  const keys = Object.keys(values);
  const touchesGPS     = keys.some(k => /TRACCAR|SAMSARA|WIALON|GPS_POLL/i.test(k));
  const touchesSensors = keys.some(k => /MQTT|SENSOR_POLL/i.test(k));

  if (reinit !== false) {
    if (touchesGPS)     cfg.reinitGPS();
    if (touchesSensors) cfg.reinitSensors();
  }

  console.log('  ⚙️  Config updated by SA:', keys.join(', '));
  res.json({ ok: true, saved: keys.length, reinit: { gps: touchesGPS, sensors: touchesSensors } });
});

// Get current config (values redacted for display)
app.get('/api/integrations/config', _localOnly, (req, res) => {
  res.json({ ok: true, config: cfg.getAll(true) }); // redacted view
});

// Test a specific integration (send a test notification etc.)
app.post('/api/integrations/test', _localOnly, async (req, res) => {

  const { type } = req.body;
  const notif = require('./integrations/notifications');

  try {
    if (type === 'whatsapp' && process.env.ALERT_WHATSAPP) {
      const ok = await notif.sendWhatsApp(process.env.ALERT_WHATSAPP, '✅ InstaPort TMS — WhatsApp test successful!');
      return res.json({ ok, message: ok ? 'WhatsApp sent to ' + process.env.ALERT_WHATSAPP : 'Failed — check Twilio credentials' });
    }
    if (type === 'email' && process.env.ALERT_EMAIL) {
      const ok = await notif.sendEmail({ to: process.env.ALERT_EMAIL, subject: '✅ InstaPort TMS — Email test', text: 'Email integration working correctly.' });
      return res.json({ ok, message: ok ? 'Email sent to ' + process.env.ALERT_EMAIL : 'Failed — check email provider credentials' });
    }
    if (type === 'sms' && process.env.ALERT_SMS) {
      const ok = await notif.sendSMS(process.env.ALERT_SMS, '✅ InstaPort TMS — SMS test successful!');
      return res.json({ ok, message: ok ? 'SMS sent to ' + process.env.ALERT_SMS : 'Failed — check Twilio credentials' });
    }
    if (type === 'sensor') {
      const snap = require('./integrations/sensors').getSnapshot();
      return res.json({ ok: true, message: snap.count + ' sensor(s) connected, ' + snap.alerts.length + ' alerts', data: snap });
    }
    if (type === 'gps') {
      const snap = require('./integrations/gps').getSnapshot();
      return res.json({ ok: snap.count > 0, message: snap.count + ' truck(s) tracked via ' + (snap.provider || 'none'), data: snap });
    }
    res.json({ ok: false, message: 'Unknown test type or missing alert destination in config' });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════
// STATIC FILES + SPA FALLBACK
// ═══════════════════════════════════════════════════════
app.use(express.static(ROOT, { etag: false, lastModified: false, maxAge: 0 }));
app.get('/{*path}', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(ROOT, 'index.html'));
});

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
