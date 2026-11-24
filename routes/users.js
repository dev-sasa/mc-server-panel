'use strict';
// Benutzer, Rollen, Protokoll
const crypto = require('crypto');
const { app } = require('../lib/app');
const inbox = require('../lib/inbox');
const { BUILTIN, PERMS, PERM_KEYS, USER_RE, allRoles, dropSessions, findUser, isAdminRole, permsOf, requiredPerm, roleDef, roleOf, sessions, subset } = require('../lib/auth');
const { audit, config, ctxOf, hashPassword, httpError, readAudit, saveConfig, wrap } = require('../lib/core');
const { clients } = require('../lib/minecraft');
const { resolveMinecraft, setMinecraft } = require('../lib/mojang');

/* ---- Benutzerverwaltung ---- */
const DISCORD_ID_RE = /^\d{15,25}$/;
const pubUser = (u) => ({ username: u.username, role: roleOf(u), roleName: roleDef(roleOf(u)).name, discordId: u.discordId || '', lastLogin: u.lastLogin || null, minecraft: u.minecraft || null, owner: !!u.owner, twofa: !!(u.totp && u.totp.enabled) });
// Nur der Hauptbenutzer darf den Hauptbenutzer bearbeiten
function ownerGuard(req, u) {
  const me = findUser(req.user);
  if (u.owner && !(me && me.owner)) {
    audit(ctxOf(req), 'user_denied', `Zugriff auf den Hauptbenutzer „${u.username}“ verweigert`);
    throw httpError(403, 'Nur der Hauptbenutzer kann den Hauptbenutzer bearbeiten.');
  }
}
const checkRole = (r) => { if (!roleDef(r)) throw httpError(400, 'Ungültige Rolle'); return r; };
// Wer „Benutzer verwalten“ darf, aber kein Admin ist, kann nur Rollen vergeben und Benutzer bearbeiten, deren Rechte er selbst hat (sonst Rechte-Ausweitung)
const assignable = (actor, roleId) => isAdminRole(actor) || (roleId !== 'admin' && subset(new Set(roleDef(roleId).perms), permsOf(actor)));
const manageable = (actor, target) => isAdminRole(actor) || actor === target || (!isAdminRole(target) && subset(permsOf(target), permsOf(actor)));
const assertAssign = (req, roleId) => { if (!assignable(findUser(req.user), roleId)) throw httpError(403, 'Du kannst nur Rollen vergeben, deren Rechte du selbst hast.'); };
const assertManage = (req, target) => { if (!manageable(findUser(req.user), target)) throw httpError(403, 'Dieser Benutzer hat mehr Rechte als du und lässt sich nicht von dir bearbeiten.'); };
function checkDiscordId(id) {
  if (id && !DISCORD_ID_RE.test(id)) throw httpError(400, 'Discord-ID besteht nur aus Ziffern (17–20 Stellen)');
  if (id && config.users.some((u) => u.discordId === id)) throw httpError(409, 'Diese Discord-ID ist bereits einem Benutzer zugeordnet');
}
app.get('/api/users', (req, res) => {
  const me = findUser(req.user);
  res.json({
    me: req.user,
    myRole: roleOf(me),
    perms: PERMS,
    roles: allRoles().map((r) => ({ ...r, assignable: assignable(me, r.id), users: config.users.filter((u) => roleOf(u) === r.id).length })),
    users: config.users.map((u) => ({ ...pubUser(u), canEdit: manageable(me, u) })),
  });
});
app.post('/api/users', wrap(async (req, res) => {
  const { username, password } = req.body;
  const role = checkRole(req.body.role || 'moderator');
  assertAssign(req, role);
  const discordId = String(req.body.discordId || '').trim();
  if (!USER_RE.test(username || '')) throw httpError(400, 'Benutzername: 2–32 Zeichen (Buchstaben, Ziffern, _ . -)');
  if (findUser(username)) throw httpError(409, 'Benutzer existiert bereits');
  if (!password || password.length < 8) throw httpError(400, 'Passwort: mindestens 8 Zeichen');
  checkDiscordId(discordId);
  const mc = await resolveMinecraft(req.body.minecraft);
  config.users.push({ username, role, passwordHash: hashPassword(password), discordId, ...(mc ? { minecraft: mc } : {}) });
  saveConfig();
  audit(ctxOf(req), 'user_create', `${username} (${roleDef(role).name})`);
  res.json({ ok: true });
}));
app.put('/api/users/:name', wrap(async (req, res) => {
  const u = findUser(req.params.name);
  if (!u) throw httpError(404, 'Benutzer nicht gefunden');
  ownerGuard(req, u);
  assertManage(req, u);
  if (req.body.username !== undefined && String(req.body.username).trim() !== u.username) {
    const nn = String(req.body.username).trim();
    if (!USER_RE.test(nn)) throw httpError(400, 'Benutzername: 2–32 Zeichen (Buchstaben, Ziffern, _ . -)');
    const clash = findUser(nn);
    if (clash && clash !== u) throw httpError(409, 'Dieser Benutzername ist schon vergeben');
    const old = u.username;
    audit(ctxOf(req), 'user_rename', `${old} → ${nn}`);
    u.username = nn;
    inbox.rename(old, nn);
    // laufende Sitzungen und Live-Verbindungen auf den neuen Namen umstellen (sonst würde man abgemeldet)
    for (const sess of sessions.values()) if (sess.username === old) sess.username = nn;
    for (const w of clients) if (w.username === old) w.username = nn;
    if (req.user === old) req.user = nn;
  }
  if (req.body.discordId !== undefined) {
    const id = String(req.body.discordId).trim();
    if (id !== (u.discordId || '')) { checkDiscordId(id); u.discordId = id; audit(ctxOf(req), 'user_discord', `${u.username}: ${id || 'entfernt'}`); }
  }
  if (req.body.minecraft !== undefined) {
    const mcNew = await resolveMinecraft(req.body.minecraft);
    setMinecraft(u, mcNew);
    audit(ctxOf(req), 'user_minecraft', `${u.username}: ${mcNew ? mcNew.name : 'entfernt'}`);
  }
  if (req.body.role !== undefined && req.body.role !== roleOf(u)) {
    if (u.username === req.user) throw httpError(400, 'Du kannst deine eigene Rolle nicht ändern');
    checkRole(req.body.role);
    assertAssign(req, req.body.role);
    const oldRole = roleOf(u);
    u.role = req.body.role;
    audit(ctxOf(req), 'user_role', `${u.username}: ${roleDef(oldRole).name} → ${roleDef(u.role).name}`);
  }
  if (req.body.password) {
    if (req.body.password.length < 8) throw httpError(400, 'Passwort: mindestens 8 Zeichen');
    u.passwordHash = hashPassword(req.body.password);
    audit(ctxOf(req), 'user_password', u.username);
    if (u.username !== req.user) dropSessions(u.username);
  }
  saveConfig();
  res.json({ ok: true });
}));
app.delete('/api/users/:name', wrap(async (req, res) => {
  const u = findUser(req.params.name);
  if (!u) throw httpError(404, 'Benutzer nicht gefunden');
  ownerGuard(req, u);
  assertManage(req, u);
  if (u.owner) throw httpError(400, 'Der Hauptbenutzer kann nicht gelöscht werden');
  if (config.users.length <= 1) throw httpError(400, 'Der letzte Benutzer kann nicht gelöscht werden');
  if (u.username === req.user) throw httpError(400, 'Du kannst dich nicht selbst löschen');
  config.users = config.users.filter((x) => x !== u);
  inbox.drop(u.username);
  dropSessions(u.username);
  saveConfig();
  audit(ctxOf(req), 'user_delete', u.username);
  res.json({ ok: true });
}));

/* ---- Eigene Rollen (nur Admin) ---- */
const ROLE_NAME_RE = /^[^\r\n\t\0]{2,32}$/;
function cleanPerms(list) {
  const out = [...new Set((Array.isArray(list) ? list : []).map(String))];
  if (out.some((p) => !PERM_KEYS.has(p))) throw httpError(400, 'Unbekanntes Recht in der Auswahl');
  return out;
}
function checkRoleName(name, exceptId) {
  const n = String(name || '').trim();
  if (!ROLE_NAME_RE.test(n)) throw httpError(400, 'Name der Rolle: 2–32 Zeichen');
  const low = n.toLowerCase();
  if (Object.values(BUILTIN).some((r) => r.name.toLowerCase() === low) || config.roles.some((r) => r.id !== exceptId && r.name.toLowerCase() === low)) throw httpError(409, 'Eine Rolle mit diesem Namen gibt es schon');
  return n;
}
app.get('/api/roles', (req, res) => res.json({ perms: PERMS, roles: allRoles().map((r) => ({ ...r, users: config.users.filter((u) => roleOf(u) === r.id).length })) }));
app.post('/api/roles', wrap(async (req, res) => {
  if (config.roles.length >= 30) throw httpError(400, 'Es sind höchstens 30 eigene Rollen möglich');
  const role = { id: 'r_' + crypto.randomBytes(4).toString('hex'), name: checkRoleName(req.body.name), perms: cleanPerms(req.body.perms) };
  config.roles.push(role);
  saveConfig();
  audit(ctxOf(req), 'role_create', `${role.name}: ${role.perms.join(', ') || 'nur ansehen'}`);
  res.json({ ok: true, role });
}));
app.put('/api/roles/:id', wrap(async (req, res) => {
  const role = config.roles.find((r) => r.id === req.params.id);
  if (!role) throw httpError(BUILTIN[req.params.id] ? 400 : 404, BUILTIN[req.params.id] ? 'Die eingebauten Rollen lassen sich nicht ändern' : 'Rolle nicht gefunden');
  const before = `${role.name}: ${role.perms.join(', ') || 'nur ansehen'}`;
  if (req.body.name !== undefined) role.name = checkRoleName(req.body.name, role.id);
  if (req.body.perms !== undefined) role.perms = cleanPerms(req.body.perms);
  saveConfig();
  audit(ctxOf(req), 'role_update', `${before} → ${role.name}: ${role.perms.join(', ') || 'nur ansehen'}`);
  res.json({ ok: true, role });
}));
app.delete('/api/roles/:id', wrap(async (req, res) => {
  const role = config.roles.find((r) => r.id === req.params.id);
  if (!role) throw httpError(BUILTIN[req.params.id] ? 400 : 404, BUILTIN[req.params.id] ? 'Die eingebauten Rollen lassen sich nicht löschen' : 'Rolle nicht gefunden');
  const used = config.users.filter((u) => u.role === role.id).map((u) => u.username);
  if (used.length) throw httpError(409, `Die Rolle wird noch verwendet von: ${used.join(', ')}. Weise diesen Benutzern zuerst eine andere Rolle zu.`);
  config.roles = config.roles.filter((r) => r !== role);
  saveConfig();
  audit(ctxOf(req), 'role_delete', role.name);
  res.json({ ok: true });
}));

/* ---- Aktivitätsprotokoll (Recht „audit“, siehe requiredPerm) ---- */
app.get('/api/audit', wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const cat = String(req.query.cat || ''), q = String(req.query.q || '').toLowerCase().trim();
  const items = readAudit().filter((e) => (!cat || e.cat === cat)
    && (!q || `${e.user} ${e.action} ${e.detail}`.toLowerCase().includes(q)));
  res.json({ total: items.length, items: items.slice(offset, offset + limit) });
}));

// Verlorenes Handy: 2FA eines Benutzers zurücksetzen (nur für Benutzer, die man verwalten darf)
app.post('/api/users/:name/2fa-reset', wrap(async (req, res) => {
  const u = findUser(req.params.name);
  if (!u) throw httpError(404, 'Benutzer nicht gefunden');
  ownerGuard(req, u);
  assertManage(req, u);
  if (!(u.totp && u.totp.enabled)) throw httpError(409, 'Bei diesem Benutzer ist keine Zwei-Faktor-Anmeldung aktiv');
  delete u.totp;
  saveConfig();
  dropSessions(u.username);
  audit(ctxOf(req), 'user_2fa_reset', u.username);
  res.json({ ok: true });
}));
