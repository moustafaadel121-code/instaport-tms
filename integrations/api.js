/**
 * integrations/api.js
 * Public REST API v1 — for client developers & external systems
 * Mounted at /api/v1 in server.js
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const router    = express.Router();

// ── API Key store (in production: store in Supabase) ──────────────
// Simple in-memory store for demo; replace with DB in production
const _apiKeys = new Map();
// Seed a demo key
_apiKeys.set(process.env.DEMO_API_KEY || 'ipk_demo_00000000', {
  orgId: 'instaport', name: 'Demo Key', active: true, created: new Date().toISOString(),
});

// ── Rate limiting ─────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 100,
  message: { error: 'Too many requests — limit: 100 per 15 minutes' },
  standardHeaders: true,
});
router.use(apiLimiter);

// ── API Key auth middleware ────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header' });
  const info = _apiKeys.get(key);
  if (!info || !info.active) return res.status(401).json({ error: 'Invalid or inactive API key' });
  req.apiOrg = info.orgId;
  req.apiKey = { name: info.name, org: info.orgId };
  next();
}

// ── Documentation root ────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    name:    'InstaPort TMS API',
    version: 'v1',
    docs:    'https://docs.instaport.app/api',
    endpoints: [
      'GET  /api/v1/trips',
      'GET  /api/v1/trips/:id',
      'GET  /api/v1/fleet',
      'GET  /api/v1/sensors',
      'GET  /api/v1/invoices',
      'GET  /api/v1/alerts',
      'POST /api/v1/webhooks/trip',
      'POST /api/v1/webhooks/sensor',
      'POST /api/v1/keys/generate  (SA only)',
    ],
  });
});

// ── /trips ────────────────────────────────────────────────────────
router.get('/trips', requireApiKey, (req, res) => {
  const { status, limit = 50, offset = 0, from, to } = req.query;
  // In production: query Supabase with org filter
  // Here we return the in-memory data via global app state
  let trips = global._appTrips || [];
  trips = trips.filter(t => t.tenant_id === req.apiOrg || !t.tenant_id);
  if (status)  trips = trips.filter(t => t.status === status);
  if (from)    trips = trips.filter(t => t.date >= from);
  if (to)      trips = trips.filter(t => t.date <= to);
  res.json({
    count:  trips.length,
    offset: parseInt(offset),
    limit:  parseInt(limit),
    data:   trips.slice(offset, parseInt(offset) + parseInt(limit)).map(mapTrip),
  });
});

router.get('/trips/:id', requireApiKey, (req, res) => {
  const trips = global._appTrips || [];
  const trip = trips.find(t => t.id === req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json({ data: mapTrip(trip) });
});

// ── /fleet ────────────────────────────────────────────────────────
router.get('/fleet', requireApiKey, (req, res) => {
  const trucks = global._appTrucks || [];
  res.json({ count: trucks.length, data: trucks.map(mapTruck) });
});

// ── /sensors ─────────────────────────────────────────────────────
router.get('/sensors', requireApiKey, (req, res) => {
  const sensors = require('./sensors');
  res.json(sensors.getSnapshot());
});

// ── /invoices ─────────────────────────────────────────────────────
router.get('/invoices', requireApiKey, (req, res) => {
  const invoices = global._appInvoices || [];
  res.json({ count: invoices.length, data: invoices });
});

// ── /alerts ───────────────────────────────────────────────────────
router.get('/alerts', requireApiKey, (req, res) => {
  const sensors = require('./sensors');
  res.json({ alerts: sensors.alerts });
});

// ── Webhook: receive trip event from external system ──────────────
router.post('/webhooks/trip', requireApiKey, (req, res) => {
  const { event, trip_id, status } = req.body;
  console.log('  🔗 Webhook trip event:', event, trip_id);
  // Emit to connected clients via SSE / WebSocket here
  global._webhookEvents = global._webhookEvents || [];
  global._webhookEvents.unshift({ type: 'TRIP', event, trip_id, status, ts: new Date().toISOString() });
  res.json({ ok: true, received: { event, trip_id } });
});

// ── Webhook: receive sensor data push from RMS ───────────────────
router.post('/webhooks/sensor', (req, res) => {
  // No API key required — sensor devices push directly
  const sensors = require('./sensors');
  sensors.receivePush(req.body);
  res.json({ ok: true });
});

// ── Generate API key (SA only, validated via SA token header) ─────
router.post('/keys/generate', (req, res) => {
  const saToken = req.headers['x-sa-token'];
  if (saToken !== process.env.SA_API_TOKEN) {
    return res.status(403).json({ error: 'SA token required' });
  }
  const { orgId, name } = req.body;
  const key = 'ipk_' + uuidv4().replace(/-/g, '');
  _apiKeys.set(key, { orgId, name, active: true, created: new Date().toISOString() });
  res.json({ ok: true, key, org: orgId });
});

// ── Field mappers ─────────────────────────────────────────────────
function mapTrip(t) {
  return {
    id: t.id, customer: t.customer, type: t.type, direction: t.dir,
    condition: t.condition, origin: t.from || t.origin,
    destinations: t.dests, truck: t.truck, driver: t.driver,
    distance_km: t.km, cost: t.cost, co2_kg: t.co2,
    status: t.status, date: t.date,
  };
}
function mapTruck(t) {
  return {
    plate: t.plate, type: t.type, manufacturer: t.mfr,
    cooling: t.cooling, status: t.status, valid: t.valid,
  };
}

// ── Expose key store for server.js ────────────────────────────────
router._apiKeys = _apiKeys;

module.exports = router;
