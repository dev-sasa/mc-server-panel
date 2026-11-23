'use strict';
// Anmeldung (Passwort und Discord)
const crypto = require('crypto');
const { app } = require('../lib/app');
const { DUMMY_HASH, findUser, loginFails, parseCookies, rateCheck, rateFail, setCookie, startSession } = require('../lib/auth');
const { checkSecondFactor, has2fa } = require('../lib/twofa');
const { UA, audit, checkPassword, config, dc, httpError, sleep, wrap } = require('../lib/core');

app.get('/api/auth-info', (req, res) => res.json({ discord: !!discordReady() }));

// Zwischenstand nach richtigem Passwort, wenn der Benutzer einen zweiten Faktor hat: Ticket (5 Minuten gültig, höchstens 5 Versuche)
const tickets = new Map(); // token -> { username, exp, tries }
setInterval(() => { const n = Date.now(); for (const [k, v] of tickets) if (v.exp < n) tickets.delete(k); }, 60000).unref();

function finishLogin(req, res, username, how) {
  loginFails.delete(req.ip);
  audit({ user: username }, 'login', how || '');
  startSession(res, username);
  res.json({ ok: true });
}

app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip;
  rateCheck(ip);
  const user = findUser(req.body.username);
  const ok = checkPassword(req.body.password, user ? user.passwordHash : DUMMY_HASH) && user;
  if (!ok) {
    audit({ user: String(req.body.username || '').slice(0, 32) || '?' }, 'login_failed', user ? 'Falsches Passwort' : 'Unbekannter Benutzer');
    rateFail(ip);
    await sleep(500);
    throw httpError(401, 'Benutzername oder Passwort falsch');
  }
  if (has2fa(user)) {
    const ticket = crypto.randomBytes(24).toString('hex');
    tickets.set(ticket, { username: user.username, exp: Date.now() + 5 * 60000, tries: 0 });
    return res.json({ ok: true, totp: true, ticket });
  }
  finishLogin(req, res, user.username);
}));
app.post('/api/login/totp', wrap(async (req, res) => {
  const ip = req.ip;
  rateCheck(ip);
  const key = String(req.body.ticket || '');
  const tk = tickets.get(key);
  if (!tk || tk.exp < Date.now()) throw httpError(401, 'Die Anmeldung ist abgelaufen – bitte erneut mit dem Passwort anmelden.');
  const user = findUser(tk.username);
  const how = user && checkSecondFactor(user, req.body.code);
  if (!how) {
    audit({ user: tk.username }, 'login_failed', 'Falscher 2FA-Code');
    rateFail(ip);
    if (++tk.tries >= 5) tickets.delete(key);
    await sleep(500);
    throw httpError(401, 'Code falsch oder schon benutzt');
  }
  tickets.delete(key);
  finishLogin(req, res, user.username, how === 'recovery' ? '2FA (Wiederherstellungscode)' : '2FA');
}));

/* ---- Discord-Login (OAuth2) ---- */
const discordReady = () => { const d = dc(); return d.enabled && d.clientId && d.clientSecret; };
function redirectUri(req) {
  if (dc().redirectUri) return dc().redirectUri;
  return `${req.protocol}://${req.headers.host}/auth/discord/callback`;
}
// Basis-Adresse der Discord-API (nur zum Testen mit einem Mock überschreibbar)
const DISCORD_BASE = process.env.DISCORD_BASE || 'https://discord.com';
const loginRedirect = (res, err) => res.redirect(err ? '/login?error=' + encodeURIComponent(err) : '/');

app.get('/auth/discord', (req, res) => {
  if (!discordReady()) return loginRedirect(res, 'Discord-Login ist nicht aktiviert.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'mcp_oauth', state, { path: '/auth', maxAge: 600 });
  const q = new URLSearchParams({
    client_id: dc().clientId, response_type: 'code', scope: 'identify',
    redirect_uri: redirectUri(req), state,
  });
  // Erst still versuchen (kein Freigabe-Dialog, wenn schon erlaubt). Beim allerersten Mal braucht Discord
  // die Zustimmung des Benutzers: dann kommt interaction_required zurück und wir fragen mit Dialog erneut an.
  if (req.query.consent !== '1') q.set('prompt', 'none');
  res.redirect(DISCORD_BASE + '/oauth2/authorize?' + q);
});
app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!discordReady()) return loginRedirect(res, 'Discord-Login ist nicht aktiviert.');
    const expected = parseCookies(req.headers.cookie).mcp_oauth;
    setCookie(req, res, 'mcp_oauth', '', { path: '/auth' });
    if (req.query.error) {
      const err = String(req.query.error);
      if (['interaction_required', 'consent_required', 'login_required'].includes(err)) return res.redirect('/auth/discord?consent=1');
      const why = err === 'access_denied' ? 'Du hast die Anmeldung bei Discord abgebrochen.' : `Discord meldet einen Fehler: ${req.query.error_description || err}`;
      audit({ user: 'Discord' }, 'login_failed', why);
      return loginRedirect(res, why);
    }
    if (!expected || req.query.state !== expected || !req.query.code) return loginRedirect(res, 'Ungültige Discord-Antwort (State).');
    const tokRes = await fetch(DISCORD_BASE + '/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA },
      body: new URLSearchParams({
        client_id: dc().clientId, client_secret: dc().clientSecret,
        grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(req),
      }),
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) {
      const why = `Discord-Token konnte nicht abgeholt werden: ${tok.error_description || tok.error || 'HTTP ' + tokRes.status}. Client-ID, Client-Secret und Redirect-URI prüfen (Redirect-URI: ${redirectUri(req)}).`;
      console.error('[Discord]', why);
      audit({ user: 'Discord' }, 'login_failed', why);
      return loginRedirect(res, why);
    }
    const meRes = await fetch(DISCORD_BASE + '/api/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token, ...UA } });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.id) return loginRedirect(res, 'Discord-Benutzer konnte nicht gelesen werden (HTTP ' + meRes.status + ').');
    const user = config.users.find((u) => u.discordId && u.discordId === me.id);
    if (!user) { audit({ user: 'Discord ' + me.id }, 'login_failed', 'Discord-Konto keinem Benutzer zugeordnet'); return loginRedirect(res, `Dieses Discord-Konto ist keinem Panel-Benutzer zugeordnet. Deine Discord-ID: ${me.id}`); }
    audit({ user: user.username }, 'login_discord');
    startSession(res, user.username);
    // Zwischenseite statt 302: die Weiterleitung kommt dann von der Panel-Seite selbst (neue Navigation),
    // damit das Sitzungs-Cookie sicher mitgeschickt wird.
    res.status(200).type('html').send('<!doctype html><meta charset="utf-8"><title>Anmeldung …</title><meta http-equiv="refresh" content="0;url=/konsole"><style>body{background:#0f1218;color:#e6eaf2;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}</style><p>Angemeldet – weiter zum Panel …</p><script>location.replace("/konsole")</script>');
  } catch (e) {
    console.error('[Discord]', e);
    loginRedirect(res, 'Discord-Login fehlgeschlagen: ' + e.message);
  }
});
