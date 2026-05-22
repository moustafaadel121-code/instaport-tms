/**
 * integrations/auth.js
 * Server-side authentication — bcrypt PIN verification + JWT sessions
 * Keeps credentials server-side; browser never sees raw PINs or hashes
 */

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const https   = require('https');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY  || '8h';
const SUPA_URL   = process.env.SUPABASE_URL;
const SUPA_KEY   = process.env.SUPABASE_ANON_KEY;

// ── Supabase REST helper (no npm package needed) ──────────────────
async function _supaFetch(path, opts = {}) {
  const url  = SUPA_URL + '/rest/v1' + path;
  const res  = await fetch(url, {
    ...opts,
    headers: {
      apikey:        SUPA_KEY,
      Authorization: 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...(opts.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText);
  return data;
}

// ── Hash a PIN (call when creating/resetting a user) ──────────────
async function hashPin(plainPin) {
  return bcrypt.hash(String(plainPin), 12);
}

// ── Verify a PIN against its stored hash ─────────────────────────
async function verifyPin(plainPin, hash) {
  // Support legacy plain-text PINs during migration period
  if (!hash) return false;
  if (hash.startsWith('$2')) {
    return bcrypt.compare(String(plainPin), hash);
  }
  // Legacy plain-text comparison (migration: hash it next save)
  return String(plainPin) === String(hash);
}

// ── Issue a JWT session token ─────────────────────────────────────
function issueToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// ── Verify a JWT session token ────────────────────────────────────
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ── Middleware: require valid JWT ─────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) :
                 req.headers['x-session-token'] || '';
  if (!token) return res.status(401).json({ ok: false, error: 'Session required. Please log in.' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' });
  req.session = payload;
  next();
}

// ── Authenticate a regular user (org + employeeId + pin) ──────────
async function authenticateUser(orgId, employeeId, pin) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase not configured on server');

  // 1. Load tenant
  const [tenant] = await _supaFetch(
    `/tenants?id=eq.${encodeURIComponent(orgId)}&select=id,name,plan,active&limit=1`
  );
  if (!tenant)             throw new Error('Organization not found');
  if (tenant.active === false || tenant.active === 0)
                           throw new Error('Organization is deactivated');

  // 2. Load user — try employee_id match, then id match
  const users = await _supaFetch(
    `/users?tenant_id=eq.${encodeURIComponent(orgId)}&or=(employee_id.eq.${encodeURIComponent(employeeId)},id.eq.${encodeURIComponent(employeeId)})&select=id,employee_id,name,role,pin,active&limit=5`
  );
  const user = users.find(u =>
    (String(u.employee_id) === String(employeeId) || String(u.id) === String(employeeId)) &&
    u.active !== false && u.active !== 0
  );
  if (!user) throw new Error('Employee not found or inactive');

  // 3. Verify PIN
  const ok = await verifyPin(pin, user.pin);
  if (!ok) throw new Error('Invalid PIN');

  // 4. Upgrade to bcrypt hash if still plain-text (silent migration)
  if (!String(user.pin).startsWith('$2')) {
    const hashed = await hashPin(pin);
    try {
      await _supaFetch(
        `/users?id=eq.${user.id}&tenant_id=eq.${encodeURIComponent(orgId)}`,
        { method: 'PATCH', body: JSON.stringify({ pin: hashed }) }
      );
    } catch (e) { /* non-fatal — will retry next login */ }
  }

  return {
    userId:   String(user.employee_id || user.id),
    name:     user.name,
    role:     user.role,
    orgId:    tenant.id,
    orgName:  tenant.name,
    plan:     tenant.plan || 'starter',
  };
}

// ── SA audit log ─────────────────────────────────────────────────
const _saAuditLog = []; // in-memory; persist to Supabase if needed

function saAudit(action, detail, ip) {
  const entry = { ts: new Date().toISOString(), action, detail, ip };
  _saAuditLog.unshift(entry);
  if (_saAuditLog.length > 500) _saAuditLog.pop();
  console.log(`  🔐 SA AUDIT [${entry.ts}] ${action} — ${detail} (${ip})`);
}

function getSaAuditLog(limit = 100) {
  return _saAuditLog.slice(0, limit);
}

module.exports = {
  hashPin,
  verifyPin,
  issueToken,
  verifyToken,
  requireAuth,
  authenticateUser,
  saAudit,
  getSaAuditLog,
};
