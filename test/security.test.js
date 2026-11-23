'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPanel } = require('./helpers');
const totp = require('../lib/totp');

const panels = [];
const panel = async (env) => { const p = await startPanel(env); panels.push(p); return p; };
after(async () => { for (const p of panels) await p.stop(); });

const raw = (p, body, headers = {}) => fetch(p.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('TOTP: RFC-6238-Testvektor (SHA-1, 59 s → 94287082, hier 6 Stellen: 287082)', () => {
  const secret = totp.base32encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.code(secret, 59 * 1000), '287082');
  assert.equal(totp.code(secret, 1111111109 * 1000), '081804');
  assert.equal(totp.code(secret, 2000000000 * 1000), '279037');
});

test('TOTP: ±1 Zeitfenster, Wiederverwendung und falsche Codes', () => {
  const s = totp.newSecret();
  const now = 1700000000000;
  const c = totp.code(s, now);
  const k = totp.verify(s, c, -1, now);
  assert.ok(Number.isInteger(k));
  assert.equal(totp.verify(s, c, k, now), null); // schon benutzt
  assert.ok(totp.verify(s, c, -1, now + 30000) !== null); // ein Fenster später noch gültig
  assert.equal(totp.verify(s, c, -1, now + 90000), null); // zu alt
  assert.equal(totp.verify(s, '12345', -1, now), null);
  assert.equal(totp.verify(s, 'abcdef', -1, now), null);
});

test('Secure-Flag am Cookie: nur bei HTTPS (über Proxy-Header von localhost)', async () => {
  const p = await panel();
  const plain = await raw(p, { username: 'admin', password: 'dev' });
  assert.doesNotMatch(plain.headers.getSetCookie().join(';'), /Secure/);
  const https = await raw(p, { username: 'admin', password: 'dev' }, { 'x-forwarded-proto': 'https' });
  assert.match(https.headers.getSetCookie().join(';'), /Secure/);
  const forced = await panel({ MCPANEL_COOKIE_SECURE: '1' });
  assert.match((await raw(forced, { username: 'admin', password: 'dev' })).headers.getSetCookie().join(';'), /Secure/);
});

test('Login-Sperre gilt je echter Client-Adresse (X-Forwarded-For hinter dem Proxy)', { timeout: 30000 }, async () => {
  const p = await panel();
  const bad = (ip) => raw(p, { username: 'admin', password: 'falsch' }, { 'x-forwarded-for': ip });
  let last;
  for (let i = 0; i < 6; i++) last = await bad('203.0.113.5');
  assert.equal(last.status, 429);
  assert.equal((await bad('203.0.113.6')).status, 401); // ein anderer Client ist nicht gesperrt
  assert.equal((await raw(p, { username: 'admin', password: 'dev' }, { 'x-forwarded-for': '203.0.113.7' })).status, 200);
});

test('Ohne vertrauenswürdigen Proxy wird X-Forwarded-For ignoriert (nicht fälschbar)', { timeout: 30000 }, async () => {
  const p = await panel({ MCPANEL_TRUST_PROXY: 'false' });
  let last;
  for (let i = 0; i < 6; i++) last = await raw(p, { username: 'admin', password: 'falsch' }, { 'x-forwarded-for': '198.51.100.' + i });
  assert.equal(last.status, 429);
});

test('Zwei-Faktor: einrichten, anmelden, Wiederherstellungscode, deaktivieren, Reset durch Admin', { timeout: 60000 }, async () => {
  const p = await panel();
  const a = await p.admin();
  assert.equal((await a.post('/api/users', { username: 'anna', password: 'passwort123', role: 'moderator' })).status, 200);
  const u = await p.client().login('anna', 'passwort123');

  assert.equal((await u.get('/api/me/2fa')).json.enabled, false);
  assert.equal((await u.post('/api/me/2fa/setup', { password: 'falsch' })).status, 403);
  const s = await u.post('/api/me/2fa/setup', { password: 'passwort123' });
  assert.equal(s.status, 200, s.text);
  assert.match(s.json.svg, /<svg/);
  assert.match(s.json.uri, /^otpauth:\/\/totp\//);
  const secret = s.json.secret.replace(/\s/g, '');
  assert.equal((await u.post('/api/me/2fa/enable', { code: '000000' })).status, 403);
  const en = await u.post('/api/me/2fa/enable', { code: totp.code(secret) });
  assert.equal(en.status, 200, en.text);
  assert.equal(en.json.recovery.length, 8);

  // Anmeldung: Passwort allein reicht nicht mehr
  const c = p.client();
  const step1 = await c.post('/api/login', { username: 'anna', password: 'passwort123' });
  assert.equal(step1.status, 200);
  assert.equal(step1.json.totp, true);
  assert.ok(step1.json.ticket);
  assert.equal((await c.get('/api/status')).status, 401);
  // falscher Code, danach richtiger Code (nächstes Zeitfenster, weil das aktuelle beim Einrichten verbraucht wurde)
  assert.equal((await c.post('/api/login/totp', { ticket: step1.json.ticket, code: '123456' })).status, 401);
  const ok = await c.post('/api/login/totp', { ticket: step1.json.ticket, code: totp.code(secret, Date.now() + 30000) });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await c.get('/api/status')).status, 200);
  // derselbe Code funktioniert kein zweites Mal
  const c2 = p.client();
  const t2 = (await c2.post('/api/login', { username: 'anna', password: 'passwort123' })).json.ticket;
  assert.equal((await c2.post('/api/login/totp', { ticket: t2, code: totp.code(secret, Date.now() + 30000) })).status, 401);
  // Wiederherstellungscode: einmal benutzbar
  const rc = en.json.recovery[0];
  assert.equal((await c2.post('/api/login/totp', { ticket: t2, code: rc })).status, 200);
  const c3 = p.client();
  const t3 = (await c3.post('/api/login', { username: 'anna', password: 'passwort123' })).json.ticket;
  assert.equal((await c3.post('/api/login/totp', { ticket: t3, code: rc })).status, 401);
  assert.equal((await u.get('/api/me/2fa')).json.recoveryLeft, 7);
  // Ticket ist nach 5 Fehlversuchen verbraucht
  const c4 = p.client();
  const t4 = (await c4.post('/api/login', { username: 'anna', password: 'passwort123' })).json.ticket;
  for (let i = 0; i < 5; i++) await c4.post('/api/login/totp', { ticket: t4, code: '000000' });
  assert.notEqual((await c4.post('/api/login/totp', { ticket: t4, code: en.json.recovery[1] })).status, 200);

  // Admin sieht den Status und kann zurücksetzen
  assert.equal((await a.get('/api/users')).json.users.find((x) => x.username === 'anna').twofa, true);
  assert.equal((await a.post('/api/users/anna/2fa-reset')).status, 200);
  assert.equal((await a.post('/api/users/anna/2fa-reset')).status, 409);
  // (die vielen Fehlversuche oben haben die Adresse des Tests gesperrt – ein anderer Client ist frei)
  const plain = await raw(p, { username: 'anna', password: 'passwort123' }, { 'x-forwarded-for': '203.0.113.99' });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).totp, undefined);
});

test('Zwei-Faktor deaktivieren braucht Passwort und Code', { timeout: 30000 }, async () => {
  const p = await panel();
  const a = await p.admin();
  const s = (await a.post('/api/me/2fa/setup', { password: 'dev' })).json;
  const secret = s.secret.replace(/\s/g, '');
  const en = (await a.post('/api/me/2fa/enable', { code: totp.code(secret) })).json;
  assert.equal((await a.post('/api/me/2fa/disable', { password: 'dev', code: '000000' })).status, 403);
  assert.equal((await a.post('/api/me/2fa/disable', { password: 'falsch', code: en.recovery[0] })).status, 403);
  assert.equal((await a.post('/api/me/2fa/disable', { password: 'dev', code: en.recovery[0] })).status, 200);
  assert.equal((await a.get('/api/me/2fa')).json.enabled, false);
});
