/**
 * InstaPort TMS — License Key Generator (VENDOR TOOL — never ship this file)
 *
 * Usage:
 *   node make-license.js <domains> <expiry> <company>
 *
 * Examples:
 *   node make-license.js company.com 2027-12-31 "Al Noor Shipping"
 *   node make-license.js "company.com,192.168.1.50,tms.company.com" 2027-06-30 "PharmaLog"
 *
 * Then build the licensed copy:
 *   node build.js --license <generated-key>
 */

const SALT = '|IP-LIC-2026-K9'; // must match _licHash usage in index.html

function licHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  let h2 = 52711;
  for (let j = s.length - 1; j >= 0; j--) h2 = ((h2 << 5) + h2 + s.charCodeAt(j)) >>> 0;
  return h.toString(16) + h2.toString(16);
}

const [domains, expiry, company] = process.argv.slice(2);
if (!domains || !expiry) {
  console.log('Usage: node make-license.js <domain1,domain2,...> <YYYY-MM-DD> "<Company Name>"');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
  console.error('Expiry must be YYYY-MM-DD');
  process.exit(1);
}

const payload = {
  d: domains.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  exp: expiry,
  c: company || '',
  iat: new Date().toISOString().slice(0, 10)
};
const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
const key = b64 + '.' + licHash(b64 + SALT);

console.log('\n══ InstaPort TMS License ══════════════════════════');
console.log('Company : ' + (company || '(unnamed)'));
console.log('Domains : ' + payload.d.join(', ') + '  (+ localhost always allowed)');
console.log('Expires : ' + expiry);
console.log('───────────────────────────────────────────────────');
console.log('KEY:\n' + key);
console.log('───────────────────────────────────────────────────');
console.log('Build the licensed copy with:\n  node build.js --license ' + key + '\n');
