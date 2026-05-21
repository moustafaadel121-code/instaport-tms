/**
 * integrations/gps.js
 * GPS / Telematics — multi-provider real-time tracking
 * Supports: Traccar, Samsara, Wialon, Teltonika (MQTT), Generic REST
 */

const axios = require('axios');
const EventEmitter = require('events');

class GPSManager extends EventEmitter {
  constructor() {
    super();
    this.positions = {};   // { truckPlate: { lat, lng, speed, ignition, address, ts, provider } }
    this.history   = {};   // { truckPlate: [{lat,lng,ts},...] } last 200 points per truck
    this.geofences = [];
    this.pollers   = [];
    this.connected = false;
    this.provider  = null;
  }

  // ── Traccar (self-hosted open-source GPS server) ────────────────
  startTraccar(options = {}) {
    const url  = options.url  || process.env.TRACCAR_URL;
    const user = options.user || process.env.TRACCAR_USER;
    const pass = options.pass || process.env.TRACCAR_PASS;
    if (!url) return;

    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const poll = async () => {
      try {
        const [posRes, devRes] = await Promise.all([
          axios.get(`${url}/api/positions`, { headers: { Authorization: `Basic ${auth}` }, timeout: 8000 }),
          axios.get(`${url}/api/devices`,   { headers: { Authorization: `Basic ${auth}` }, timeout: 8000 }),
        ]);
        const devices = {};
        (Array.isArray(devRes.data) ? devRes.data : []).forEach(d => { devices[d.id] = d; });
        (Array.isArray(posRes.data) ? posRes.data : []).forEach(p => {
          const dev = devices[p.deviceId] || {};
          this._processPosition({
            provider:   'traccar',
            deviceId:   p.deviceId,
            truckPlate: dev.name || dev.uniqueId || String(p.deviceId),
            lat:        p.latitude,
            lng:        p.longitude,
            speed:      Math.round(p.speed * 1.852),  // knots → km/h
            ignition:   p.attributes?.ignition ?? null,
            address:    p.address || null,
            battery:    p.attributes?.battery ?? null,
            ts:         p.fixTime || p.serverTime,
          });
        });
        this.connected = true;
      } catch (e) {
        console.warn('  Traccar poll error:', e.message);
        this.connected = false;
      }
    };

    poll();
    const id = setInterval(poll, options.intervalMs || 30000);
    this.pollers.push(id);
    this.provider = 'traccar';
    console.log('  📍 GPS: Traccar polling →', url);
  }

  // ── Samsara (commercial fleet GPS) ─────────────────────────────
  startSamsara(options = {}) {
    const apiKey = options.apiKey || process.env.SAMSARA_API_KEY;
    if (!apiKey) return;

    const poll = async () => {
      try {
        const res = await axios.get('https://api.samsara.com/fleet/vehicles/stats', {
          headers: { Authorization: `Bearer ${apiKey}` },
          params:  { types: 'gps,engineStates' },
          timeout: 8000,
        });
        (res.data?.data || []).forEach(v => {
          const gps = v.gps;
          if (!gps) return;
          this._processPosition({
            provider:   'samsara',
            deviceId:   v.id,
            truckPlate: v.name || v.id,
            lat:        gps.latitude,
            lng:        gps.longitude,
            speed:      gps.speedMilesPerHour != null ? Math.round(gps.speedMilesPerHour * 1.60934) : null,
            ignition:   v.engineStates?.[0]?.value === 'On',
            address:    gps.reverseGeo?.formattedLocation || null,
            ts:         gps.time,
          });
        });
        this.connected = true;
      } catch (e) {
        console.warn('  Samsara poll error:', e.message);
        this.connected = false;
      }
    };

    poll();
    const id = setInterval(poll, options.intervalMs || 30000);
    this.pollers.push(id);
    this.provider = 'samsara';
    console.log('  📍 GPS: Samsara polling started');
  }

  // ── Wialon (GPS fleet platform) ────────────────────────────────
  startWialon(options = {}) {
    const token  = options.token   || process.env.WIALON_TOKEN;
    const base   = options.baseUrl || process.env.WIALON_URL || 'https://hst-api.wialon.com';
    if (!token) return;

    let sid = null;

    const login = async () => {
      const res = await axios.get(`${base}/wialon/ajax.html`, {
        params: { svc: 'token/login', params: JSON.stringify({ token }) },
      });
      sid = res.data?.eid;
      console.log('  📍 GPS: Wialon session started');
    };

    const poll = async () => {
      if (!sid) { try { await login(); } catch (e) { console.warn('  Wialon login error:', e.message); return; } }
      try {
        const res = await axios.get(`${base}/wialon/ajax.html`, {
          params: {
            svc: 'core/search_items', sid,
            params: JSON.stringify({
              spec: { itemsType: 'avl_unit', propName: 'sys_name', propValueMask: '*', sortType: 'sys_name' },
              force: 1, flags: 0x00000001 | 0x00000100, from: 0, to: 0,
            }),
          },
        });
        (res.data?.items || []).forEach(v => {
          if (!v.pos) return;
          this._processPosition({
            provider:   'wialon',
            deviceId:   v.id,
            truckPlate: v.nm || String(v.id),
            lat:        v.pos.y,
            lng:        v.pos.x,
            speed:      v.pos.s,
            ignition:   !!(v.pos.f & 0x1),
            ts:         new Date(v.pos.t * 1000).toISOString(),
          });
        });
        this.connected = true;
      } catch (e) {
        console.warn('  Wialon poll error:', e.message);
        sid = null; // force re-login next tick
      }
    };

    login().then(() => {
      const id = setInterval(poll, options.intervalMs || 30000);
      this.pollers.push(id);
      poll();
    }).catch(e => console.warn('  Wialon init error:', e.message));

    this.provider = 'wialon';
    console.log('  📍 GPS: Wialon integration starting →', base);
  }

  // ── Generic REST polling (any fleet API) ────────────────────────
  startGeneric(apiUrl, options = {}) {
    if (!apiUrl) return;
    const poll = async () => {
      try {
        const res = await axios.get(apiUrl, {
          headers: {
            Authorization: options.token  ? `Bearer ${options.token}` : undefined,
            'X-Api-Key':   options.apiKey || undefined,
            ...options.headers,
          },
          timeout: 8000,
        });
        const data = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.vehicles || [res.data]);
        data.forEach(p => {
          this._processPosition({
            provider:   'generic',
            truckPlate: p.plate || p.name || p.vehicle || p.id,
            lat:        p.lat   || p.latitude  || p.y,
            lng:        p.lng   || p.longitude || p.x,
            speed:      p.speed || p.spd,
            ignition:   p.ignition ?? p.ign ?? null,
            address:    p.address || null,
            ts:         p.ts || p.timestamp || new Date().toISOString(),
          });
        });
        this.connected = true;
      } catch (e) {
        console.warn('  GPS generic poll error:', e.message);
      }
    };
    poll();
    const id = setInterval(poll, options.intervalMs || 30000);
    this.pollers.push(id);
    this.provider = this.provider || 'generic';
    console.log('  📍 GPS: Generic REST polling →', apiUrl);
  }

  // ── Teltonika / MQTT GPS positions ─────────────────────────────
  // Called from sensors.js MQTT handler for GPS topics
  handleMQTT(topic, data) {
    this._processPosition({
      provider:   'teltonika',
      deviceId:   data.imei || data.device_id || data.id,
      truckPlate: data.plate || data.license_plate || data.vehicle || data.imei,
      lat:        data.lat  || data.latitude  || data.y,
      lng:        data.lng  || data.longitude || data.x,
      speed:      data.speed || data.spd,
      ignition:   data.ignition ?? data.ign ?? null,
      ts:         data.timestamp || data.ts || new Date().toISOString(),
    });
    this.connected = true;
  }

  // ── Receive webhook push from GPS platform ─────────────────────
  receivePush(data) {
    const list = Array.isArray(data) ? data : [data];
    list.forEach(p => this._processPosition({ provider: 'push', ...p }));
  }

  // ── Simulate GPS positions (dev mode) ──────────────────────────
  simulatePositions(plates = []) {
    // Cairo area — random movement
    const base = { lat: 30.0444, lng: 31.2357 };
    plates.forEach((plate, i) => {
      const pos = this.positions[plate] || {
        lat: base.lat + (Math.random() - 0.5) * 2,
        lng: base.lng + (Math.random() - 0.5) * 2,
      };
      this._processPosition({
        provider:   'simulated',
        truckPlate: plate,
        lat:        pos.lat + (Math.random() - 0.5) * 0.01,
        lng:        pos.lng + (Math.random() - 0.5) * 0.01,
        speed:      Math.floor(Math.random() * 100),
        ignition:   Math.random() > 0.2,
        ts:         new Date().toISOString(),
      });
    });
  }

  // ── Internal: normalize + store + emit ─────────────────────────
  _processPosition(raw) {
    const lat = parseFloat(raw.lat);
    const lng = parseFloat(raw.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const pos = {
      provider:   raw.provider   || 'unknown',
      deviceId:   raw.deviceId   || raw.truckPlate,
      truckPlate: (raw.truckPlate || raw.deviceId || 'unknown').toUpperCase(),
      lat,
      lng,
      speed:    raw.speed   != null ? Math.round(parseFloat(raw.speed))   : null,
      ignition: raw.ignition != null ? !!raw.ignition : null,
      address:  raw.address  || null,
      battery:  raw.battery  || null,
      ts:       raw.ts       || new Date().toISOString(),
    };

    this.positions[pos.truckPlate] = pos;

    // Trail history (last 200 points per truck)
    if (!this.history[pos.truckPlate]) this.history[pos.truckPlate] = [];
    this.history[pos.truckPlate].push({ lat: pos.lat, lng: pos.lng, ts: pos.ts });
    if (this.history[pos.truckPlate].length > 200) this.history[pos.truckPlate].shift();

    this.emit('position', pos);
    this._checkGeofences(pos);
  }

  // ── Geofence engine ────────────────────────────────────────────
  addGeofence(id, name, lat, lng, radiusKm) {
    this.geofences.push({ id, name, lat, lng, radiusKm, inside: {} });
  }
  _checkGeofences(pos) {
    this.geofences.forEach(gf => {
      const dist  = this._haversine(pos.lat, pos.lng, gf.lat, gf.lng);
      const now   = dist <= gf.radiusKm;
      const was   = gf.inside[pos.truckPlate];
      if (now !== was) {
        gf.inside[pos.truckPlate] = now;
        this.emit('geofence', {
          type: now ? 'ENTERED' : 'EXITED',
          geofence: gf.name, geofenceId: gf.id,
          truck: pos.truckPlate,
          ts: pos.ts,
        });
      }
    });
  }
  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Snapshot for API / SSE ─────────────────────────────────────
  getSnapshot() {
    return {
      positions:  this.positions,
      count:      Object.keys(this.positions).length,
      connected:  this.connected,
      provider:   this.provider,
    };
  }

  getHistory(truckPlate) {
    return this.history[truckPlate?.toUpperCase()] || [];
  }

  stop() { this.pollers.forEach(id => clearInterval(id)); }
}

module.exports = new GPSManager();
