/**
 * integrations/config.js
 * Runtime configuration store — SA can update credentials from the UI
 * Values saved to config.json, merged over .env on startup
 * No server restart needed for most integrations
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

// ── Load saved config on startup ─────────────────────────────────
let _store = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    _store = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // Apply saved values into process.env so all modules pick them up
    Object.keys(_store).forEach(k => {
      if (_store[k] !== '' && _store[k] != null) {
        process.env[k] = String(_store[k]);
      }
    });
    console.log('  ⚙️  Runtime config loaded:', Object.keys(_store).length, 'keys');
  }
} catch (e) {
  console.warn('  Config load error:', e.message);
}

// ── Set one or many values ─────────────────────────────────────────
function set(keyOrObj, value) {
  if (typeof keyOrObj === 'object') {
    Object.keys(keyOrObj).forEach(k => _setOne(k, keyOrObj[k]));
  } else {
    _setOne(keyOrObj, value);
  }
  _save();
}

function _setOne(key, value) {
  if (value === '' || value == null) return; // skip empty
  _store[key] = value;
  process.env[key] = String(value); // live update — no restart needed
}

// ── Get a value (runtime store first, then process.env) ───────────
function get(key, fallback) {
  return _store[key] || process.env[key] || fallback;
}

// ── Delete a key ──────────────────────────────────────────────────
function del(key) {
  delete _store[key];
  _save();
}

// ── Persist to config.json ────────────────────────────────────────
function _save() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(_store, null, 2), 'utf8');
  } catch (e) {
    console.warn('  Config save error:', e.message);
  }
}

// ── Get all stored keys (redacted for display) ────────────────────
function getAll(redact = true) {
  const out = {};
  Object.keys(_store).forEach(k => {
    const v = _store[k];
    if (redact && _isSensitive(k)) {
      out[k] = v ? '••••••••' + String(v).slice(-4) : '';
    } else {
      out[k] = v;
    }
  });
  return out;
}

function _isSensitive(key) {
  return /token|secret|key|pass|sid|pin/i.test(key);
}

// ── Re-init GPS/Sensors after config change ───────────────────────
function reinitGPS() {
  try {
    const gps = require('./gps');
    gps.stop();
    if (process.env.TRACCAR_URL)     gps.startTraccar();
    else if (process.env.SAMSARA_API_KEY) gps.startSamsara();
    else if (process.env.WIALON_TOKEN)    gps.startWialon();
    else if (process.env.GPS_POLL_URL)    gps.startGeneric(process.env.GPS_POLL_URL, { token: process.env.GPS_API_TOKEN });
    console.log('  ⚙️  GPS re-initialized');
  } catch (e) { console.warn('  GPS reinit error:', e.message); }
}

function reinitSensors() {
  try {
    const sensors = require('./sensors');
    if (process.env.MQTT_BROKER_URL) sensors.connectMQTT(process.env.MQTT_BROKER_URL);
    if (process.env.SENSOR_POLL_URL) sensors.startHTTPPolling(process.env.SENSOR_POLL_URL, { apiKey: process.env.SENSOR_API_KEY });
    console.log('  ⚙️  Sensors re-initialized');
  } catch (e) { console.warn('  Sensors reinit error:', e.message); }
}

module.exports = { set, get, del, getAll, reinitGPS, reinitSensors };
