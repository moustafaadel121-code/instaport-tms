/**
 * integrations/accounting.js
 * QuickBooks Online, Xero, Sage — invoice sync & OAuth flows
 */

const axios = require('axios');

// ── Token store (in production: persist in Supabase) ──────────────
const _tokens = {
  quickbooks: { accessToken: null, refreshToken: null, realmId: null, expiresAt: 0 },
  xero:       { accessToken: null, refreshToken: null, tenantId: null, expiresAt: 0 },
};

// ════════════════════════════════════════════════════════════
// QUICKBOOKS ONLINE
// ════════════════════════════════════════════════════════════
const QB_API  = 'https://api.intuit.com';
const QB_AUTH = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOK  = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function qbOAuthUrl(redirectUri) {
  if (!process.env.QB_CLIENT_ID) return null;
  const p = new URLSearchParams({
    client_id:     process.env.QB_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    state:         'qb_' + Date.now(),
  });
  return `${QB_AUTH}?${p}`;
}

async function qbExchangeCode(code, realmId, redirectUri) {
  const creds = _b64(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`);
  const res = await axios.post(QB_TOK,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _tokens.quickbooks = {
    accessToken:  res.data.access_token,
    refreshToken: res.data.refresh_token,
    realmId,
    expiresAt:    Date.now() + res.data.expires_in * 1000,
  };
  console.log('  💼 QuickBooks connected — realm:', realmId);
  return { ok: true };
}

async function _qbEnsureToken() {
  const t = _tokens.quickbooks;
  if (!t.accessToken) throw new Error('QuickBooks not connected');
  if (Date.now() > t.expiresAt - 60000) {
    const creds = _b64(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`);
    const res = await axios.post(QB_TOK,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }).toString(),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    t.accessToken = res.data.access_token;
    t.expiresAt   = Date.now() + res.data.expires_in * 1000;
  }
  return t;
}

async function qbCreateInvoice(invoice) {
  try {
    const t = await _qbEnsureToken();
    const body = {
      CustomerRef: { value: invoice.qbCustomerId || '1', name: invoice.customer },
      DueDate:     invoice.dueDate,
      Line: (invoice.items || []).map((item, i) => ({
        Id: String(i + 1),
        Amount: +(item.total || (item.qty * item.rate)).toFixed(2),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty:       item.qty  || 1,
          UnitPrice: item.rate || item.price || 0,
          ItemRef:   { value: '1', name: item.desc || 'Service' },
        },
      })),
    };
    const res = await axios.post(
      `${QB_API}/v3/company/${t.realmId}/invoice?minorversion=65`,
      body,
      { headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
    );
    const id = res.data.Invoice?.Id;
    console.log('  💼 QB invoice created:', id);
    return { ok: true, id, provider: 'quickbooks' };
  } catch (e) {
    console.warn('  QB invoice error:', e.response?.data?.Fault || e.message);
    return { ok: false, error: e.message };
  }
}

async function qbGetCustomers() {
  try {
    const t = await _qbEnsureToken();
    const res = await axios.get(
      `${QB_API}/v3/company/${t.realmId}/query?query=select * from Customer MAXRESULTS 200&minorversion=65`,
      { headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json' } }
    );
    return { ok: true, customers: res.data.QueryResponse?.Customer || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function qbGetInvoices() {
  try {
    const t = await _qbEnsureToken();
    const res = await axios.get(
      `${QB_API}/v3/company/${t.realmId}/query?query=select * from Invoice ORDERBY TxnDate DESC MAXRESULTS 50&minorversion=65`,
      { headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json' } }
    );
    return { ok: true, invoices: res.data.QueryResponse?.Invoice || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// XERO
// ════════════════════════════════════════════════════════════
const XERO_AUTH  = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN = 'https://identity.xero.com/connect/token';

function xeroOAuthUrl(redirectUri) {
  if (!process.env.XERO_CLIENT_ID) return null;
  const p = new URLSearchParams({
    response_type: 'code',
    client_id:     process.env.XERO_CLIENT_ID,
    redirect_uri:  redirectUri,
    scope:         'openid profile email accounting.transactions accounting.contacts offline_access',
    state:         'xero_' + Date.now(),
  });
  return `${XERO_AUTH}?${p}`;
}

async function xeroExchangeCode(code, redirectUri) {
  const creds = _b64(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`);
  const res = await axios.post(XERO_TOKEN,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  // Get tenant
  const conns = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${res.data.access_token}` },
  });
  _tokens.xero = {
    accessToken:  res.data.access_token,
    refreshToken: res.data.refresh_token,
    tenantId:     conns.data?.[0]?.tenantId,
    expiresAt:    Date.now() + res.data.expires_in * 1000,
  };
  console.log('  💼 Xero connected — tenant:', _tokens.xero.tenantId);
  return { ok: true };
}

async function _xeroEnsureToken() {
  const t = _tokens.xero;
  if (!t.accessToken) throw new Error('Xero not connected');
  if (Date.now() > t.expiresAt - 60000) {
    const creds = _b64(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`);
    const res = await axios.post(XERO_TOKEN,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }).toString(),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    t.accessToken = res.data.access_token;
    t.expiresAt   = Date.now() + res.data.expires_in * 1000;
  }
  return t;
}

async function xeroCreateInvoice(invoice) {
  try {
    const t = await _xeroEnsureToken();
    const doc = {
      Type:    'ACCREC',
      Contact: { Name: invoice.customer },
      DueDate: invoice.dueDate,
      LineAmountTypes: 'Exclusive',
      LineItems: (invoice.items || []).map(item => ({
        Description: item.desc || 'Service',
        Quantity:    item.qty  || 1,
        UnitAmount:  item.rate || item.price || 0,
        AccountCode: process.env.XERO_ACCOUNT_CODE || '200',
      })),
      Status: 'AUTHORISED',
    };
    const res = await axios.put('https://api.xero.com/api.xro/2.0/Invoices',
      { Invoices: [doc] },
      { headers: { Authorization: `Bearer ${t.accessToken}`, 'Xero-Tenant-Id': t.tenantId, 'Content-Type': 'application/json' } }
    );
    const id = res.data.Invoices?.[0]?.InvoiceID;
    console.log('  💼 Xero invoice created:', id);
    return { ok: true, id, provider: 'xero' };
  } catch (e) {
    console.warn('  Xero invoice error:', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

async function xeroGetContacts() {
  try {
    const t = await _xeroEnsureToken();
    const res = await axios.get('https://api.xero.com/api.xro/2.0/Contacts', {
      headers: { Authorization: `Bearer ${t.accessToken}`, 'Xero-Tenant-Id': t.tenantId },
    });
    return { ok: true, contacts: res.data.Contacts || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// SAGE ACCOUNTING
// ════════════════════════════════════════════════════════════
const SAGE_BASE = 'https://api.accounting.sage.com/v3.1';

async function sagePushInvoice(invoice) {
  const apiKey    = process.env.SAGE_API_KEY;
  if (!apiKey) return { ok: false, error: 'Sage not configured' };
  try {
    const res = await axios.post(`${SAGE_BASE}/sales_invoices`, {
      sales_invoice: {
        contact_id: invoice.sageContactId || invoice.customerId,
        date:       invoice.date,
        due_date:   invoice.dueDate,
        invoice_lines: (invoice.items || []).map(item => ({
          description:        item.desc || 'Service',
          quantity:           item.qty  || 1,
          unit_price:         item.rate || item.price || 0,
          ledger_account_id:  process.env.SAGE_LEDGER_ID,
        })),
      },
    }, { headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' } });
    console.log('  💼 Sage invoice created:', res.data.id);
    return { ok: true, id: res.data.id, provider: 'sage' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sageGetContacts() {
  const apiKey = process.env.SAGE_API_KEY;
  if (!apiKey) return { ok: false, error: 'Sage not configured' };
  try {
    const res = await axios.get(`${SAGE_BASE}/contacts`, {
      headers: { 'X-Api-Key': apiKey },
      params:  { items_per_page: 100 },
    });
    return { ok: true, contacts: res.data.items || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Push invoice to all connected accounting systems ─────────────
async function syncInvoiceAll(invoice) {
  const results = {};
  if (_tokens.quickbooks.accessToken) results.quickbooks = await qbCreateInvoice(invoice);
  if (_tokens.xero.accessToken)       results.xero       = await xeroCreateInvoice(invoice);
  if (process.env.SAGE_API_KEY)       results.sage       = await sagePushInvoice(invoice);
  return results;
}

// ── Connection status ─────────────────────────────────────────────
function getStatus() {
  return {
    quickbooks: {
      connected: !!_tokens.quickbooks.accessToken,
      realmId:   _tokens.quickbooks.realmId,
      configured: !!(process.env.QB_CLIENT_ID && process.env.QB_CLIENT_SECRET),
    },
    xero: {
      connected:  !!_tokens.xero.accessToken,
      tenantId:   _tokens.xero.tenantId,
      configured: !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET),
    },
    sage: {
      connected:  !!process.env.SAGE_API_KEY,
      configured: !!process.env.SAGE_API_KEY,
    },
  };
}

function _b64(str) { return Buffer.from(str).toString('base64'); }

module.exports = {
  qbOAuthUrl, qbExchangeCode, qbCreateInvoice, qbGetCustomers, qbGetInvoices,
  xeroOAuthUrl, xeroExchangeCode, xeroCreateInvoice, xeroGetContacts,
  sagePushInvoice, sageGetContacts,
  syncInvoiceAll, getStatus, _tokens,
};
