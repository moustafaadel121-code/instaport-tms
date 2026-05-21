/**
 * InstaPort TMS — Production Server
 * Level 2: SA credentials live here in .env, never in browser code
 * Level 3: Serves the dist/ build (minified + obfuscated)
 *
 * Run: node server.js
 * Dev: node server.js --dev   (serves index.html from root, not dist/)
 */

require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 7434;
const DEV  = process.argv.includes('--dev');
const ROOT = DEV ? __dirname : path.join(__dirname, 'dist');

// ── Security headers ──────────────────────────────────────────────
app.use(function(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());

// ── Simple in-memory rate limiter for SA auth ─────────────────────
const _saAttempts = {};
function _saRateLimit(ip) {
  const now = Date.now();
  if (!_saAttempts[ip]) _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > _saAttempts[ip].reset) { _saAttempts[ip] = { count: 0, reset: now + 15 * 60 * 1000 }; }
  _saAttempts[ip].count++;
  return _saAttempts[ip].count > 5; // block after 5 attempts in 15 min
}

// ── Level 2: SA auth endpoint ─────────────────────────────────────
// Credentials validated server-side — never exposed in browser code
app.post('/api/sa-auth', function(req, res) {
  const ip = req.ip || req.connection.remoteAddress;

  if (_saRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { org, userId, pin } = req.body;

  // Constant-time comparison to prevent timing attacks
  const orgOk    = crypto.timingSafeEqual(Buffer.from(org    || ''), Buffer.from(process.env.SA_ORG     || ''));
  const userOk   = crypto.timingSafeEqual(Buffer.from(userId || ''), Buffer.from(process.env.SA_USER_ID || ''));
  const pinOk    = crypto.timingSafeEqual(Buffer.from(pin    || ''), Buffer.from(process.env.SA_PIN     || ''));

  if (orgOk && userOk && pinOk) {
    // Clear rate limit on success
    delete _saAttempts[ip];
    return res.json({
      ok:   true,
      name: process.env.SA_NAME || 'Super Admin',
      role: 'superadmin',
    });
  }

  return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
});

// ── Static files (dist/ in prod, root in dev) ─────────────────────
app.use(express.static(ROOT));

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', function(req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, function() {
  console.log('');
  console.log('  🚀 InstaPort TMS Server');
  console.log('  ─────────────────────────────────');
  console.log('  URL  : http://localhost:' + PORT);
  console.log('  Mode : ' + (DEV ? '🔧 Development (source)' : '📦 Production (dist/)'));
  console.log('  SA   : credentials loaded from .env ✅');
  console.log('');
});
