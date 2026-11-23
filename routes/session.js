'use strict';
// Abmelden, eigenes Konto
const { app } = require('../lib/app');
const { clearSessionCookie, dropSessions, findUser, parseCookies, permsOf, roleDef, sessions } = require('../lib/auth');
const { EVENTS, dmReady, embed, sendDm } = require('../lib/notify');
const { has2fa } = require('../lib/twofa');
const { audit, checkPassword, config, ctxOf, httpError, saveConfig, sleep, wrap } = require('../lib/core');
const { resolveMinecraft, setMinecraft } = require('../lib/mojang');

app.post('/api/logout', (req, res) => {
  audit(ctxOf(req), 'logout');
  sessions.delete(parseCookies(req.headers.cookie).mcp_session);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const me = findUser(req.user);
  res.json({ ok: true, username: req.user, role: req.role, roleName: roleDef(req.role).name, perms: [...permsOf(me)], minecraft: me.minecraft || null });
});
app.put('/api/me/minecraft', wrap(async (req, res) => {
  const mcNew = await resolveMinecraft(req.body.minecraft);
  setMinecraft(findUser(req.user), mcNew);
  saveConfig();
  audit(ctxOf(req), 'user_minecraft', `${req.user}: ${mcNew ? mcNew.name : 'entfernt'}`);
  res.json({ ok: true, minecraft: findUser(req.user).minecraft || null });
}));

/* ---- Einstellungen des eigenen Kontos ---- */
const DEFAULT_NOTIFY = { panel: true, discord: false, events: { crash: true, backupFail: true, lag: false } };
const notifyOf = (u) => {
  const n = (u.prefs && u.prefs.notify) || {};
  const events = {};
  for (const k of Object.keys(EVENTS)) events[k] = k in (n.events || {}) ? !!n.events[k] : !!DEFAULT_NOTIFY.events[k];
  return { panel: n.panel !== undefined ? !!n.panel : DEFAULT_NOTIFY.panel, dm: !!n.dm, events };
};
app.get('/api/me/settings', (req, res) => {
  const me = findUser(req.user);
  const w = config.webhook;
  res.json({
    username: me.username, role: req.role, roleName: roleDef(req.role).name, lastLogin: me.lastLogin || null,
    minecraft: me.minecraft || null, discordId: me.discordId || '', twofa: has2fa(me),
    notify: notifyOf(me), labels: EVENTS,
    webhookActive: !!(w && w.enabled && w.url), botActive: dmReady(), webhookEvents: (w && w.events) || {},
  });
});
app.put('/api/me/notifications', wrap(async (req, res) => {
  const me = findUser(req.user);
  const b = req.body || {};
  const cur = notifyOf(me);
  const events = {};
  for (const k of Object.keys(EVENTS)) events[k] = b.events && k in b.events ? !!b.events[k] : cur.events[k];
  const next = { panel: b.panel !== undefined ? !!b.panel : cur.panel, dm: b.dm !== undefined ? !!b.dm : cur.dm, events };
  if (next.dm && !/^\d{15,25}$/.test(me.discordId || '')) throw httpError(400, 'Dafür brauchst du zuerst eine Discord-ID.');
  if (next.dm && !dmReady()) throw httpError(400, 'Direktnachrichten sind noch nicht eingerichtet: Ein Admin muss unter Panel → Benachrichtigungen einen Discord-Bot eintragen.');
  me.prefs = { ...(me.prefs || {}), notify: next };
  saveConfig();
  audit(ctxOf(req), 'user_notify', Object.keys(events).filter((k) => events[k]).join(', ') || 'keine');
  res.json({ ok: true, notify: next });
}));
// Discord-ID selbst eintragen (mit Passwort, weil die ID zur Anmeldung über Discord berechtigt)
app.put('/api/me/discord', wrap(async (req, res) => {
  const me = findUser(req.user);
  if (!checkPassword(req.body.password, me.passwordHash)) { await sleep(500); throw httpError(403, 'Passwort falsch'); }
  const id = String(req.body.discordId || '').trim();
  if (id && !/^\d{15,25}$/.test(id)) throw httpError(400, 'Discord-ID besteht nur aus Ziffern (17–20 Stellen)');
  if (id && config.users.some((u) => u !== me && u.discordId === id)) throw httpError(409, 'Diese Discord-ID ist bereits einem Benutzer zugeordnet');
  me.discordId = id;
  if (!id && me.prefs && me.prefs.notify) me.prefs.notify.dm = false;
  saveConfig();
  audit(ctxOf(req), 'user_discord', `${me.username}: ${id || 'entfernt'}`);
  res.json({ ok: true, discordId: id });
}));
// Test-Direktnachricht an mich
app.post('/api/me/dm-test', wrap(async (req, res) => {
  const me = findUser(req.user);
  if (!dmReady()) throw httpError(400, 'Direktnachrichten sind noch nicht eingerichtet (Bot-Token fehlt).');
  if (!/^\d{15,25}$/.test(me.discordId || '')) throw httpError(400, 'Trage zuerst deine Discord-ID ein.');
  try { await sendDm(me.discordId, embed('Test erfolgreich', 'Das Panel kann dir Direktnachrichten schicken.', 'ok')); }
  catch (e) { throw httpError(502, 'Senden nicht möglich: ' + e.message); }
  res.json({ ok: true });
}));
// Auf allen Geräten abmelden
app.post('/api/me/logout-all', (req, res) => {
  audit(ctxOf(req), 'logout', 'alle Sitzungen');
  dropSessions(req.user);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});
