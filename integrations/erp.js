/**
 * integrations/erp.js
 * ERP / Accounting / WMS integration
 * Supports: SAP, Oracle, MS Dynamics, QuickBooks, Xero, Sage, any REST ERP
 */

const axios = require('axios');

// ── Generic ERP push ──────────────────────────────────────────────
async function pushToERP(endpoint, data, options = {}) {
  if (!endpoint) return { ok: false, error: 'No ERP endpoint configured' };
  try {
    const res = await axios.post(endpoint, data, {
      headers: {
        'Authorization': options.token ? `Bearer ${options.token}` : undefined,
        'Content-Type': 'application/json',
        'X-Api-Key': options.apiKey || undefined,
        ...options.headers,
      },
      timeout: 10000,
    });
    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    console.warn('  ERP push error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Map a TMS trip to a generic ERP shipment document ─────────────
function tripToERPDoc(trip, orgId) {
  return {
    source:        'instaport-tms',
    org_id:        orgId,
    document_type: 'SHIPMENT',
    ref:           trip.id,
    date:          trip.date || new Date().toISOString().slice(0, 10),
    customer:      trip.customer,
    origin:        trip.from,
    destinations:  trip.dests,
    truck:         trip.truck,
    driver:        trip.driver,
    distance_km:   trip.km,
    cost:          trip.cost,
    co2_kg:        trip.co2,
    status:        trip.status,
    type:          trip.type,
    condition:     trip.condition,
    synced_at:     new Date().toISOString(),
  };
}

// ── QuickBooks / Xero: map invoice to accounting format ───────────
function invoiceToAccountingDoc(invoice, orgId) {
  return {
    source:       'instaport-tms',
    org_id:       orgId,
    type:         'INVOICE',
    invoice_no:   invoice.id || invoice.invoiceNo,
    date:         invoice.date,
    due_date:     invoice.dueDate,
    customer:     invoice.customer,
    amount:       invoice.total,
    currency:     invoice.currency || 'USD',
    line_items:   (invoice.items || []).map(i => ({
      description: i.desc || i.description,
      quantity:    i.qty  || 1,
      unit_price:  i.rate || i.price,
      total:       i.total,
    })),
    status:       invoice.status,
    synced_at:    new Date().toISOString(),
  };
}

// ── WMS: map inbound/outbound to warehouse event ──────────────────
function tripToWMSEvent(trip, eventType) {
  return {
    source:      'instaport-tms',
    event_type:  eventType, // 'OUTBOUND' | 'INBOUND'
    ref:         trip.id,
    truck:       trip.truck,
    driver:      trip.driver,
    origin:      trip.from,
    destination: trip.dests,
    customer:    trip.customer,
    status:      trip.status,
    timestamp:   new Date().toISOString(),
  };
}

// ── Sync queue: retry failed pushes ───────────────────────────────
const _queue = [];
function queuePush(type, payload, config) {
  _queue.push({ type, payload, config, attempts: 0, ts: Date.now() });
}
async function processQueue() {
  while (_queue.length > 0) {
    const item = _queue[0];
    if (item.attempts >= 3) { _queue.shift(); continue; }
    const result = await pushToERP(item.config.endpoint, item.payload, item.config);
    if (result.ok) { _queue.shift(); }
    else { item.attempts++; break; }
  }
}
setInterval(processQueue, 60000); // retry every minute

module.exports = { pushToERP, tripToERPDoc, invoiceToAccountingDoc, tripToWMSEvent, queuePush };
