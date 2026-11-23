'use strict';
// Zwei-Faktor-Anmeldung (TOTP nach RFC 6238) ohne externe Abhängigkeit, nur der QR-Code kommt aus qrcode-generator
const crypto = require('crypto');
const qrcode = require('qrcode-generator');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30; // Sekunden je Code

function base32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Ungültiges Base32-Zeichen');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}
const counterAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);
const code = (secretB32, ms = Date.now()) => hotp(secretB32, counterAt(ms));

/** Prüft einen 6-stelligen Code (±1 Zeitfenster). Gibt den passenden Zähler zurück oder null. Zähler <= `last` gelten als schon benutzt. */
function verify(secretB32, input, last = -1, ms = Date.now()) {
  const c = String(input || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = counterAt(ms);
  let found = null;
  for (let d = -1; d <= 1; d++) {
    const k = now + d;
    const a = Buffer.from(hotp(secretB32, k)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b) && k > last) found = k;
  }
  return found;
}

const otpauth = (account, secret, issuer = 'MC Server Panel') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// Wiederherstellungscodes: zufällig, nur als Hash gespeichert, einmal benutzbar
const normRecovery = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = (s) => crypto.createHash('sha256').update(normRecovery(s)).digest('hex');
function newRecoveryCodes(n = 8) {
  const plain = Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return h.slice(0, 5) + '-' + h.slice(5); });
  return { plain, hashes: plain.map(hashRecovery) };
}

module.exports = { base32encode, base32decode, newSecret, code, verify, otpauth, qrSvg, hashRecovery, newRecoveryCodes, normRecovery };
