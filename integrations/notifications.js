/**
 * integrations/notifications.js
 * WhatsApp (Twilio), SMS (Twilio), Email (SendGrid / Mailgun)
 */

const twilio   = require('twilio');
const sgMail   = require('@sendgrid/mail');
const axios    = require('axios');

// Lazy-init clients
let _twilioClient = null;
function getTwilio() {
  if (!_twilioClient && process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
    _twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  }
  return _twilioClient;
}

if (process.env.SENDGRID_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_KEY);
}

// ── WhatsApp ──────────────────────────────────────────────────────
async function sendWhatsApp(to, message) {
  const client = getTwilio();
  if (!client) { console.warn('WhatsApp: Twilio not configured'); return false; }
  try {
    await client.messages.create({
      from: 'whatsapp:' + (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM),
      to:   'whatsapp:' + to,
      body: message,
    });
    console.log('  📱 WhatsApp sent to', to);
    return true;
  } catch (e) {
    console.warn('  WhatsApp error:', e.message);
    return false;
  }
}

// ── SMS ───────────────────────────────────────────────────────────
async function sendSMS(to, message) {
  const client = getTwilio();
  if (!client) { console.warn('SMS: Twilio not configured'); return false; }
  try {
    await client.messages.create({
      from: process.env.TWILIO_FROM,
      to,
      body: message,
    });
    console.log('  💬 SMS sent to', to);
    return true;
  } catch (e) {
    console.warn('  SMS error:', e.message);
    return false;
  }
}

// ── Email (SendGrid) ──────────────────────────────────────────────
async function sendEmailSendGrid({ to, subject, html, text }) {
  if (!process.env.SENDGRID_KEY) return false;
  try {
    await sgMail.send({
      to,
      from:    process.env.SENDGRID_FROM || 'noreply@instaport.app',
      subject,
      html:    html || `<p>${text}</p>`,
      text:    text || subject,
    });
    console.log('  📧 [SendGrid] Email sent to', to);
    return true;
  } catch (e) {
    console.warn('  SendGrid error:', e.message);
    return false;
  }
}

// ── Email (Mailgun) ───────────────────────────────────────────────
async function sendEmailMailgun({ to, subject, html, text }) {
  const key    = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!key || !domain) return false;
  try {
    const form = new URLSearchParams({
      from:    process.env.MAILGUN_FROM || `InstaPort <noreply@${domain}>`,
      to,
      subject,
      html:    html || `<p>${text}</p>`,
      text:    text || subject,
    });
    await axios.post(
      `https://api.mailgun.net/v3/${domain}/messages`,
      form.toString(),
      {
        auth:    { username: 'api', password: key },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    console.log('  📧 [Mailgun] Email sent to', to);
    return true;
  } catch (e) {
    console.warn('  Mailgun error:', e.message);
    return false;
  }
}

// ── Email — auto-pick provider ────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  // SendGrid takes priority, then Mailgun
  if (process.env.SENDGRID_KEY)   return sendEmailSendGrid({ to, subject, html, text });
  if (process.env.MAILGUN_API_KEY) return sendEmailMailgun({ to, subject, html, text });
  console.warn('Email: No provider configured (set SENDGRID_KEY or MAILGUN_API_KEY)');
  return false;
}

// ── Trip event notifications ───────────────────────────────────────
async function notifyTripEvent(event, trip, org) {
  const msgs = {
    dispatched: `🚛 Trip #${trip.id} dispatched. Truck: ${trip.truck || '—'}. Destination: ${trip.dests || '—'}`,
    completed:  `✅ Trip #${trip.id} completed successfully.`,
    alert:      `⚠️ Alert on Trip #${trip.id}: ${trip.alertMsg || 'Check the app for details'}`,
  };
  const msg = msgs[event] || `Trip #${trip.id} status: ${event}`;

  const notifs = [];
  if (org.whatsapp) notifs.push(sendWhatsApp(org.whatsapp, `[${org.name}] ${msg}`));
  if (org.sms)      notifs.push(sendSMS(org.sms, `[${org.name}] ${msg}`));
  if (org.email)    notifs.push(sendEmail({ to: org.email, subject: `InstaPort — ${event}`, text: msg }));
  await Promise.allSettled(notifs);
}

// ── Sensor alert notifications ─────────────────────────────────────
async function notifySensorAlert(alert, org) {
  const msg = `🌡️ SENSOR ALERT [${org.name}]\n${alert.message}\nSensor: ${alert.reading.sensorId}\nTruck: ${alert.reading.truckPlate || '—'}\nTime: ${new Date(alert.ts).toLocaleString()}`;
  const notifs = [];
  if (org.whatsapp) notifs.push(sendWhatsApp(org.whatsapp, msg));
  if (org.email)    notifs.push(sendEmail({ to: org.email, subject: '⚠️ Sensor Alert — InstaPort', text: msg }));
  await Promise.allSettled(notifs);
}

module.exports = { sendWhatsApp, sendSMS, sendEmail, notifyTripEvent, notifySensorAlert };
