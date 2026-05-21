/**
 * integrations/sensors.js
 * Temperature & Humidity sensor integration (RMS / IoT)
 * Supports: MQTT brokers, HTTP polling APIs, Websocket streams
 */

const mqtt   = require('mqtt');
const axios  = require('axios');
const EventEmitter = require('events');

class SensorManager extends EventEmitter {
  constructor() {
    super();
    this.readings  = {};   // { sensorId: { temp, humidity, ts, truckId, location } }
    this.alerts    = [];   // recent out-of-range alerts
    this.clients   = [];   // MQTT clients
    this.pollers   = [];   // HTTP polling intervals
    this.connected = false;
  }

  // ── Connect to MQTT broker (RMS systems use MQTT) ──────────────
  connectMQTT(brokerUrl, options = {}) {
    if (!brokerUrl) return;
    const client = mqtt.connect(brokerUrl, {
      username: options.username || process.env.MQTT_USER,
      password: options.password || process.env.MQTT_PASS,
      clientId: 'instaport-tms-' + Date.now(),
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      console.log('  🌡️  Sensor MQTT connected:', brokerUrl);
      this.connected = true;
      // Subscribe to all sensor topics
      const topics = options.topics || [
        'sensors/+/temperature',
        'sensors/+/humidity',
        'sensors/+/telemetry',
        'rms/+/data',
        'trucks/+/sensors',
      ];
      client.subscribe(topics, err => {
        if (!err) console.log('  📡 Subscribed to sensor topics');
      });
    });

    client.on('message', (topic, payload) => {
      this._handleMQTTMessage(topic, payload);
    });

    client.on('error', err => console.warn('  MQTT error:', err.message));
    client.on('offline', () => { this.connected = false; });
    this.clients.push(client);
    return client;
  }

  // ── HTTP polling (for RMS APIs that expose REST endpoints) ──────
  startHTTPPolling(apiUrl, options = {}) {
    if (!apiUrl) return;
    const interval = options.intervalMs || 30000; // 30 sec default
    const poll = async () => {
      try {
        const res = await axios.get(apiUrl, {
          headers: {
            'Authorization': 'Bearer ' + (options.apiKey || process.env.SENSOR_API_KEY),
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        });
        const data = res.data;
        // Handle array or single reading
        const readings = Array.isArray(data) ? data : [data];
        readings.forEach(r => this._processReading(r));
      } catch (e) {
        console.warn('  Sensor poll error:', e.message);
      }
    };
    poll(); // immediate first poll
    const id = setInterval(poll, interval);
    this.pollers.push(id);
    console.log('  🌡️  HTTP sensor polling started:', apiUrl);
  }

  // ── Receive a sensor push (webhook POST from RMS) ───────────────
  receivePush(data) {
    const readings = Array.isArray(data) ? data : [data];
    readings.forEach(r => this._processReading(r));
  }

  // ── Internal: parse MQTT message ───────────────────────────────
  _handleMQTTMessage(topic, payload) {
    try {
      const data = JSON.parse(payload.toString());
      // Extract sensor ID from topic: sensors/{id}/temperature
      const parts = topic.split('/');
      const sensorId = data.sensor_id || data.id || parts[1] || 'unknown';
      this._processReading({ ...data, sensor_id: sensorId });
    } catch (e) {
      console.warn('  Bad MQTT payload on', topic);
    }
  }

  // ── Internal: normalize and store a reading ─────────────────────
  _processReading(raw) {
    // Normalize field names across different RMS vendors
    const reading = {
      sensorId:    raw.sensor_id   || raw.sensorId   || raw.id       || 'unknown',
      truckId:     raw.truck_id    || raw.truckId     || raw.truck    || null,
      truckPlate:  raw.plate       || raw.truck_plate || raw.vehicle  || null,
      temp:        parseFloat(raw.temperature ?? raw.temp ?? raw.t ?? null),
      humidity:    parseFloat(raw.humidity     ?? raw.hum  ?? raw.h ?? null),
      location:    raw.location    || raw.gps    || null,
      battery:     raw.battery     || raw.bat    || null,
      ts:          raw.timestamp   || raw.ts     || new Date().toISOString(),
      raw,
    };

    this.readings[reading.sensorId] = reading;
    this.emit('reading', reading);

    // ── Check thresholds and emit alerts ───────────────────────────
    const limits = this._getLimits(reading);
    if (!isNaN(reading.temp)) {
      if (reading.temp > limits.tempMax) {
        this._alert('TEMP_HIGH', reading, `Temperature ${reading.temp}°C exceeds max ${limits.tempMax}°C`);
      } else if (reading.temp < limits.tempMin) {
        this._alert('TEMP_LOW', reading, `Temperature ${reading.temp}°C below min ${limits.tempMin}°C`);
      }
    }
    if (!isNaN(reading.humidity)) {
      if (reading.humidity > limits.humMax) {
        this._alert('HUM_HIGH', reading, `Humidity ${reading.humidity}% exceeds max ${limits.humMax}%`);
      }
    }
  }

  // ── Get thresholds (can be per-truck or global) ─────────────────
  _getLimits(reading) {
    // Default cold-chain limits; override via SENSOR_TEMP_MIN/MAX env vars
    return {
      tempMin: parseFloat(process.env.SENSOR_TEMP_MIN ?? -5),
      tempMax: parseFloat(process.env.SENSOR_TEMP_MAX ?? 8),
      humMax:  parseFloat(process.env.SENSOR_HUM_MAX  ?? 85),
    };
  }

  _alert(type, reading, message) {
    const alert = { type, reading, message, ts: new Date().toISOString() };
    this.alerts.unshift(alert);
    if (this.alerts.length > 200) this.alerts.pop();
    this.emit('alert', alert);
    console.warn('  ⚠️  Sensor Alert:', message, '| Sensor:', reading.sensorId);
  }

  // ── Get current snapshot for API/dashboard ──────────────────────
  getSnapshot() {
    return {
      sensors:   Object.values(this.readings),
      alerts:    this.alerts.slice(0, 20),
      connected: this.connected,
      count:     Object.keys(this.readings).length,
    };
  }

  // ── Inject a test reading (for dev/demo) ────────────────────────
  simulateReading(sensorId, truckPlate) {
    this._processReading({
      sensor_id:   sensorId || 'SIM-001',
      truck_plate: truckPlate || 'DEMO-01',
      temperature: (Math.random() * 16 - 5).toFixed(1),   // -5 to +11
      humidity:    (50 + Math.random() * 40).toFixed(1),  // 50-90%
      battery:     (80 + Math.random() * 20).toFixed(0),
      timestamp:   new Date().toISOString(),
    });
  }

  stop() {
    this.clients.forEach(c => c.end());
    this.pollers.forEach(id => clearInterval(id));
  }
}

module.exports = new SensorManager();
