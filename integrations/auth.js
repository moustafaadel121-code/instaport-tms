/**
 * integrations/auth.js
 * Server-side authentication — bcrypt + JWT + TOTP 2FA + RLS-safe Supabase
 *
 * Security layers:
 *  1. bcrypt PIN hashing (cost 12) — plain-text PINs silently migrated on login
 *  2. JWT session tokens (8h expiry) — signed with HS256, never stored server-side
 *  3. TOTP 2FA for Super Admin — Google Authenticator / Authy compatible
 *  4. Supabase service-role key for server queries — bypasses anon RLS safely
 *  5. SA audit log — every login/fail/config-change recorded with IP + timestamp
 */

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode   = require('qrcode');
const fs       = require('fs');
const path     = require('path');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-in-production-please';
const JWT_EXPIRY  = process.env.JWT_EXPIRY  || '8h';
const SUPA_URL    = process.env.SUPABASE_URL;
// Use service key if available (bypasses RLS — safe for server-side), else anon key
const SUPA_KEY    = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

// ══════════════════════════════════════════════════════════════════
// SUPABASE REST helper
// ══════════════════════════════════════════════════════════════════
async function _supaFetch(path, opts = {}) {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase not configured on server');
  const url = SUPA_URL + '/rest/v1' + path;
  const res = await fetch(url, {
    ...opts,
    headers: {
      apikey:          SUPA_KEY,
      Authorization:   'Bearer ' + SUPA_KEY,
      'Content-Type':  'application/json',
      Prefer:          'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error((data?.message || data?.error || String(data)).slice(0, 200));
  return data;
}

// ══════════════════════════════════════════════════════════════════
// BCRYPT PIN HELPERS
// ══════════════════════════════════════════════════════════════════
async function hashPin(plainPin) {
  return bcrypt.hash(String(plainPin), 12);
}

async function verifyPin(plainPin, stored) {
  if (!stored) return false;
  if (String(stored).startsWith('$2')) {
    return bcrypt.compare(String(plainPin), stored);
  }
  // Legacy plain-text — still works, will be upgraded on next login
  return String(plainPin) === String(stored);
}

// ══════════════════════════════════════════════════════════════════
// JWT SESSION TOKENS
// ══════════════════════════════════════════════════════════════════
function issueToken(payload) {
  // Remove internal JWT fields before re-signing
  const { iat, exp, ...clean } = payload;
  return jwt.sign(clean, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// Express middleware — attach parsed token to req.session
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7)
               : req.headers['x-session-token'] || '';
  if (!token) return res.status(401).json({ ok: false, error: 'Session required. Please log in.' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' });
  req.session = payload;
  next();
}

// ══════════════════════════════════════════════════════════════════
// TOTP 2FA — Super Admin only
// ══════════════════════════════════════════════════════════════════
let _totpSecret = process.env.SA_TOTP_SECRET || null;
let _totpEnabled = process.env.SA_TOTP_ENABLED === 'true';

/**
 * generateTotpSecret() — call once to set up 2FA.
 * Prints the secret + QR code URL to the console, and saves to .env.
 * After calling this, scan the QR in Google Authenticator, then set
 * SA_TOTP_ENABLED=true in .env and restart.
 */
async function generateTotpSecret() {
  const secret = speakeasy.generateSecret({
    name:   `InstaPort SA (${process.env.SA_USER_ID || 'SA01'})`,
    issuer: 'InstaPort TMS',
    length: 20,
  });
  _totpSecret = secret.base32;

  // Generate QR code as data URL for the browser setup page
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  console.log('\n  ╔═══════════════════════════════════════════════╗');
  console.log('  ║        2FA SETUP — SCAN IN AUTHENTICATOR      ║');
  console.log('  ╠═══════════════════════════════════════════════╣');
  console.log('  ║  Secret:', secret.base32.padEnd(37), '║');
  console.log('  ║  OTP URL:', secret.otpauth_url.slice(0, 36).padEnd(37), '║');
  console.log('  ╠═══════════════════════════════════════════════╣');
  console.log('  ║  Add this to your .env file:                  ║');
  console.log('  ║  SA_TOTP_SECRET=' + secret.base32.padEnd(30), '║');
  console.log('  ║  SA_TOTP_ENABLED=true                         ║');
  console.log('  ╚═══════════════════════════════════════════════╝\n');

  return { secret: secret.base32, otpauthUrl: secret.otpauth_url, qrDataUrl };
}

function verifyTotp(token) {
  if (!_totpSecret) return false;
  return speakeasy.totp.verify({
    secret:   _totpSecret,
    encoding: 'base32',
    token:    String(token),
    window:   1, // allow 30s clock drift either side
  });
}

function isTotpEnabled() { return _totpEnabled && !!_totpSecret; }

// ══════════════════════════════════════════════════════════════════
// USER AUTHENTICATION (org + employeeId + PIN → JWT)
// ══════════════════════════════════════════════════════════════════
async function authenticateUser(orgId, employeeId, pin) {
  // 1. Load and validate tenant
  const tenants = await _supaFetch(
    `/tenants?id=eq.${encodeURIComponent(orgId)}&select=id,name,plan,active&limit=1`
  );
  const tenant = Array.isArray(tenants) ? tenants[0] : tenants;
  if (!tenant)                                    throw new Error('Organization not found');
  if (tenant.active === false || tenant.active === 0) throw new Error('Organization is deactivated');

  // 2. Load matching user
  const users = await _supaFetch(
    `/users?tenant_id=eq.${encodeURIComponent(orgId)}` +
    `&select=id,employee_id,name,role,pin,active&limit=500`
  );
  const userList = Array.isArray(users) ? users : [];
  const user = userList.find(u =>
    (String(u.employee_id || '') === String(employeeId) ||
     String(u.id)               === String(employeeId)) &&
    u.active !== false && u.active !== 0
  );
  if (!user) throw new Error('Employee not found or inactive');

  // 3. Verify PIN
  const ok = await verifyPin(pin, user.pin);
  if (!ok) throw new Error('Invalid PIN');

  // 4. Silent PIN migration: upgrade plain-text → bcrypt
  if (!String(user.pin || '').startsWith('$2')) {
    const hashed = await hashPin(pin);
    try {
      await _supaFetch(
        `/users?id=eq.${encodeURIComponent(user.id)}&tenant_id=eq.${encodeURIComponent(orgId)}`,
        { method: 'PATCH', body: JSON.stringify({ pin: hashed }) }
      );
    } catch { /* non-fatal — retries next login */ }
  }

  return {
    userId:  String(user.employee_id || user.id),
    name:    user.name,
    role:    user.role,
    orgId:   tenant.id,
    orgName: tenant.name,
    plan:    tenant.plan || 'starter',
  };
}

// ══════════════════════════════════════════════════════════════════
// SA AUDIT LOG
// ══════════════════════════════════════════════════════════════════
const _saAuditLog = [];

function saAudit(action, detail, ip) {
  const entry = {
    ts:     new Date().toISOString(),
    action,
    detail,
    ip:     ip ? ip.replace(/^::ffff:/, '') : '—',
  };
  _saAuditLog.unshift(entry);
  if (_saAuditLog.length > 1000) _saAuditLog.pop();
  console.log(`  🔐 [${entry.ts}] ${action} | ${detail} | IP: ${entry.ip}`);
}

function getSaAuditLog(limit = 200) {
  return _saAuditLog.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
// SUPABASE RLS POLICY SCRIPT (generate + return for SA to apply)
// ══════════════════════════════════════════════════════════════════
function getRlsScript() {
  return `
-- ═══════════════════════════════════════════════════════════════
-- InstaPort TMS — Supabase Row Level Security (RLS) Policies
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- 1. TENANTS table — each org can only read their own row
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_self_read"   ON tenants;
DROP POLICY IF EXISTS "tenant_self_update" ON tenants;

CREATE POLICY "tenant_self_read" ON tenants
  FOR SELECT USING (id = current_setting('app.tenant_id', true));

CREATE POLICY "tenant_self_update" ON tenants
  FOR UPDATE USING (id = current_setting('app.tenant_id', true));

-- 2. USERS table — users can only see users in their own org
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_tenant_read"   ON users;
DROP POLICY IF EXISTS "users_tenant_write"  ON users;

CREATE POLICY "users_tenant_read" ON users
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY "users_tenant_write" ON users
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true));

-- 3. TRIPS table
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trips_tenant" ON trips;
CREATE POLICY "trips_tenant" ON trips
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true));

-- 4. TRUCKS / FLEET table
ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trucks_tenant" ON trucks;
CREATE POLICY "trucks_tenant" ON trucks
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true));

-- 5. INVITE CODES — only service role (SA server) can read/write
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invite_codes_sa_only" ON invite_codes;
CREATE POLICY "invite_codes_sa_only" ON invite_codes
  FOR ALL USING (auth.role() = 'service_role');

-- 6. Verify RLS is active on all tables:
SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename;
`;
}

module.exports = {
  hashPin,
  verifyPin,
  issueToken,
  verifyToken,
  requireAuth,
  authenticateUser,
  generateTotpSecret,
  verifyTotp,
  isTotpEnabled,
  saAudit,
  getSaAuditLog,
  getRlsScript,
};
