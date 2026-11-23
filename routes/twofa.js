'use strict';
// Zwei-Faktor-Anmeldung im eigenen Konto: einrichten, aktivieren, deaktivieren, neue Wiederherstellungscodes
const { app } = require('../lib/app');
const { findUser } = require('../lib/auth');
const { audit, checkPassword, ctxOf, httpError, saveConfig, wrap, sleep } = require('../lib/core');
const totp = require('../lib/totp');
const { checkSecondFactor, has2fa } = require('../lib/twofa');

const pending = new Map(); // Benutzer -> { secret, exp } (erst nach Bestätigung mit einem Code gespeichert)
const attempts = new Map(); // Benutzer -> { n, until } (Fehlversuche bei Passwort/Code in diesem Dialog)

function guardAttempts(name) {
  const a = attempts.get(name);
  if (a && a.until > Date.now()) throw httpError(429, 'Zu viele Versuche – bitte kurz warten.');
}
async function failAttempt(name, msg) {
  const a = attempts.get(name) || { n: 0, until: 0 };
  a.n++;
  if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
  attempts.set(name, a);
  await sleep(400);
  throw httpError(403, msg);
}
const needPassword = async (me, pw) => { guardAttempts(me.username); if (!checkPassword(pw, me.passwordHash)) await failAttempt(me.username, 'Passwort falsch'); };

app.get('/api/me/2fa', (req, res) => {
  const me = findUser(req.user);
  res.json({ enabled: has2fa(me), recoveryLeft: has2fa(me) ? (me.totp.recovery || []).length : 0 });
});

app.post('/api/me/2fa/setup', wrap(async (req, res) => {
  const me = findUser(req.user);
  if (has2fa(me)) throw httpError(409, 'Die Zwei-Faktor-Anmeldung ist schon aktiv.');
  await needPassword(me, req.body.password);
  const secret = totp.newSecret();
  pending.set(me.username, { secret, exp: Date.now() + 15 * 60000 });
  const uri = totp.otpauth(me.username, secret);
  res.json({ secret: secret.match(/.{1,4}/g).join(' '), uri, svg: totp.qrSvg(uri) });
}));

app.post('/api/me/2fa/enable', wrap(async (req, res) => {
  const me = findUser(req.user);
  guardAttempts(me.username);
  const p = pending.get(me.username);
  if (!p || p.exp < Date.now()) throw httpError(400, 'Bitte die Einrichtung neu starten.');
  const c = totp.verify(p.secret, req.body.code);
  if (c === null) await failAttempt(me.username, 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.');
  const rec = totp.newRecoveryCodes();
  me.totp = { enabled: true, secret: p.secret, last: c, recovery: rec.hashes };
  pending.delete(me.username);
  saveConfig();
  audit(ctxOf(req), 'user_2fa_enable', me.username);
  res.json({ ok: true, recovery: rec.plain });
}));

app.post('/api/me/2fa/disable', wrap(async (req, res) => {
  const me = findUser(req.user);
  if (!has2fa(me)) throw httpError(409, 'Die Zwei-Faktor-Anmeldung ist nicht aktiv.');
  await needPassword(me, req.body.password);
  if (!checkSecondFactor(me, req.body.code)) await failAttempt(me.username, 'Code falsch oder schon benutzt');
  delete me.totp;
  saveConfig();
  audit(ctxOf(req), 'user_2fa_disable', me.username);
  res.json({ ok: true });
}));

app.post('/api/me/2fa/recovery', wrap(async (req, res) => {
  const me = findUser(req.user);
  if (!has2fa(me)) throw httpError(409, 'Die Zwei-Faktor-Anmeldung ist nicht aktiv.');
  await needPassword(me, req.body.password);
  if (!checkSecondFactor(me, req.body.code)) await failAttempt(me.username, 'Code falsch oder schon benutzt');
  const rec = totp.newRecoveryCodes();
  me.totp.recovery = rec.hashes;
  saveConfig();
  audit(ctxOf(req), 'user_2fa_recovery', me.username);
  res.json({ ok: true, recovery: rec.plain });
}));
