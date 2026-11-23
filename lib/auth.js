'use strict';
// Sitzungen, Rechte, Rollen und Zugriffsprüfung der API
const path = require('path');
const crypto = require('crypto');
const { config, hashPassword, saveConfig } = require('./core');
const { clients } = require('./minecraft');

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // token -> { exp, username }
const SESSION_MS = 12 * 3600 * 1000;
const USER_RE = /^[A-Za-z0-9_.-]{2,32}$/;
// ---- Rechte und Rollen ----
// Jeder angemeldete Benutzer darf immer Status, Konsolen-Log und Spielerlisten ansehen. Alles Weitere ist ein einzelnes Recht.
const PERMS = [
  { k: 'server.control', g: 'Server', label: 'Server starten, stoppen und neu starten', help: 'Start, Stop, Neustart und Kill' },
  { k: 'server.console', g: 'Server', label: 'Konsolenbefehle senden', help: 'Befehle in der Konsole ausführen' },
  { k: 'players.manage', g: 'Spieler', label: 'Spieler verwalten', help: 'Whitelist, OP, Kick und Ban' },
  { k: 'logs', g: 'Server', label: 'Server-Logs durchsuchen', help: 'Alle Logdateien des Servers lesen (enthält auch Chat und Befehle der Spieler)' },
  { k: 'backups.create', g: 'Backups', label: 'Backups sehen und erstellen', help: 'Die Backup-Seite öffnen und neue Backups anlegen' },
  { k: 'backups.manage', g: 'Backups', label: 'Backups herunterladen, löschen und wiederherstellen', help: 'Vorsicht: Wiederherstellen ersetzt Dateien des Servers' },
  { k: 'files', g: 'Verwaltung', label: 'Dateimanager', help: 'Dateien ansehen, bearbeiten, hochladen und löschen. Vorsicht: damit lassen sich auch Plugins austauschen' },
  { k: 'settings', g: 'Verwaltung', label: 'Spiel-Einstellungen ändern', help: 'Die Datei server.properties' },
  { k: 'install', g: 'Verwaltung', label: 'Server-Software installieren', help: 'Installation und EULA' },
  { k: 'panel.config', g: 'System', label: 'Panel-Einstellungen ändern', help: 'RAM, Java, Zeitpläne, Discord-Login. Sehr mächtig, denn damit lässt sich der Startbefehl ändern' },
  { k: 'users', g: 'System', label: 'Benutzer verwalten', help: 'Benutzer anlegen und bearbeiten, aber nur solche mit gleichen oder weniger Rechten' },
  { k: 'audit', g: 'System', label: 'Protokoll ansehen', help: 'Wer hat wann was getan' },
];
const PERM_KEYS = new Set(PERMS.map((p) => p.k));
const BUILTIN = {
  admin: { name: 'Admin', perms: PERMS.map((p) => p.k) },
  moderator: { name: 'Moderator', perms: ['server.control', 'server.console', 'players.manage', 'logs', 'backups.create'] },
  viewer: { name: 'Betrachter', perms: [] },
};
const roleDef = (id) => BUILTIN[id] || config.roles.find((r) => r.id === id) || null;
// alte Benutzer ohne Rolle = Admin; verweist die Rolle ins Leere (gelöscht), gilt der Benutzer als Betrachter
const roleOf = (u) => (!u ? 'viewer' : !u.role ? 'admin' : roleDef(u.role) ? u.role : 'viewer');
const permsOf = (u) => new Set(roleDef(roleOf(u)).perms);
const can = (u, perm) => !!u && permsOf(u).has(perm);
const canAny = (u, list) => list.some((p) => can(u, p));
const isAdminRole = (u) => roleOf(u) === 'admin';
const subset = (a, b) => [...a].every((x) => b.has(x));
const allRoles = () => [
  ...Object.entries(BUILTIN).map(([id, r]) => ({ id, name: r.name, builtin: true, perms: r.perms })),
  ...config.roles.map((r) => ({ id: r.id, name: r.name, builtin: false, perms: r.perms })),
];
const findUser = (name) => config.users.find((u) => u.username.toLowerCase() === String(name || '').toLowerCase());
const DUMMY_HASH = hashPassword('dummy-for-timing');
const loginFails = new Map(); // ip -> {n, until}

function parseCookies(h = '') {
  return Object.fromEntries(
    h.split(';').map((c) => c.trim().split(/=(.*)/s)).filter((p) => p[0]).map((p) => [p[0], decodeURIComponent(p[1] || '')])
  );
}
function isAuthed(req) {
  const t = parseCookies(req.headers.cookie).mcp_session;
  const sess = t && sessions.get(t);
  if (!sess) return null;
  if (sess.exp < Date.now() || !findUser(sess.username)) { sessions.delete(t); return null; }
  return sess;
}
// Cookies: Secure automatisch bei HTTPS (auch hinter einem vertrauenswürdigen Proxy mit X-Forwarded-Proto). MCPANEL_COOKIE_SECURE=1/0 erzwingt es.
function isSecure(req) {
  const f = process.env.MCPANEL_COOKIE_SECURE;
  if (f === '1' || f === 'true') return true;
  if (f === '0' || f === 'false') return false;
  return !!(req && req.secure);
}
function setCookie(req, res, name, value, { path = '/', maxAge = 0 } = {}) {
  res.append('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}` + (isSecure(req) ? '; Secure' : ''));
}
const clearSessionCookie = (req, res) => setCookie(req, res, 'mcp_session', '', { maxAge: 0 });

// Sperre nach zu vielen Fehlversuchen (je Client-Adresse)
function rateCheck(ip) {
  const f = loginFails.get(ip);
  if (f && f.until > Date.now()) throw Object.assign(new Error('Zu viele Versuche – bitte kurz warten.'), { status: 429 });
  return f;
}
function rateFail(ip) {
  const f = loginFails.get(ip);
  const n = (f ? f.n : 0) + 1;
  loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
}
setInterval(() => { const n = Date.now(); for (const [k, f] of loginFails) if (f.until < n && f.n < 5) loginFails.delete(k); }, 15 * 60000).unref();

function startSession(res, username) {
  const u = findUser(username);
  if (u) { u.lastLogin = Date.now(); saveConfig(); }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { exp: Date.now() + SESSION_MS, username });
  // Lax (nicht Strict): nach der Weiterleitung von Discord zurück zum Panel muss das Cookie mitgeschickt werden.
  // Schreibende Endpunkte sind alle POST/PUT/DELETE und damit auch mit Lax gegen CSRF geschützt.
  setCookie(res.req, res, 'mcp_session', token, { maxAge: SESSION_MS / 1000 });
}
function dropSessions(username) {
  for (const [t, s] of sessions) if (s.username === username) sessions.delete(t);
  for (const w of clients) if (w.username === username) w.close();
}
setInterval(() => { const n = Date.now(); for (const [t, s] of sessions) if (s.exp < n) sessions.delete(t); }, 600000);

// Benötigtes Recht je Endpunkt: null = jeder Angemeldete, Liste = eines davon, '__admin__' = nur die feste Rolle „Admin“
function requiredPerm(req) {
  const p = req.path.replace(/\/+$/, ''), m = req.method;
  if (m === 'GET' && ['/me', '/status', '/log', '/players', '/players/stats', '/players/history', '/changelog'].includes(p)) return null;
  if (m === 'POST' && (p === '/logout' || p === '/password')) return null;
  if (m === 'PUT' && p === '/me/minecraft') return null;
  if (p === '/me/2fa' || p.startsWith('/me/2fa/') || p === '/me/settings' || p === '/me/notifications' || p === '/me/discord' || p === '/me/logout-all' || p === '/me/dm-test') return null;
  if (m === 'GET' && (p.startsWith('/mojang/') || p.startsWith('/bedrock/'))) return null;
  if (m === 'POST' && /^\/server\/(start|stop|restart|kill)$/.test(p)) return 'server.control';
  if (m === 'POST' && p === '/server/command') return 'server.console';
  if ((m === 'GET' && p === '/server/detect') || (m === 'POST' && p === '/server/adopt')) return 'panel.config';
  if (m === 'POST' && p === '/players/action') return 'players.manage';
  if (p === '/backups') return m === 'POST' ? 'backups.create' : ['backups.create', 'backups.manage'];
  if (p === '/backups/copy-test') return 'panel.config';
  if (p.startsWith('/backups/')) return 'backups.manage';
  if (p === '/properties') return 'settings';
  if (['/files', '/file', '/mkdir', '/rename', '/download', '/upload'].includes(p) || p.startsWith('/files/')) return 'files';
  if (['/eula', '/versions', '/install'].includes(p) || p.startsWith('/mods/') || p === '/mods') return 'install';
  if (p === '/config' || p === '/discord' || p === '/webhook' || p === '/webhook/test') return 'panel.config';
  if (p === '/users' || p.startsWith('/users/')) return 'users';
  if (p === '/roles' || p.startsWith('/roles/')) return m === 'GET' ? 'users' : '__admin__'; // ändern dürfen nur Admins
  if (p.startsWith('/logs/')) return 'logs';
  if (p === '/audit') return 'audit';
  return '__admin__';
}

const apiGuard = (req, res, next) => {
  const sess = isAuthed(req);
  if (!sess) return res.status(401).json({ error: 'Nicht angemeldet' });
  const me = findUser(sess.username);
  req.user = sess.username;
  req.role = roleOf(me);
  const need = requiredPerm(req);
  const ok = need === null || (need === '__admin__' ? req.role === 'admin' : Array.isArray(need) ? canAny(me, need) : can(me, need));
  if (!ok) return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' });
  next();
};

module.exports = { apiGuard, setCookie, clearSessionCookie, rateCheck, rateFail, BUILTIN, DUMMY_HASH, PERMS, PERM_KEYS, USER_RE, allRoles, can, dropSessions, findUser, isAdminRole, isAuthed, loginFails, parseCookies, permsOf, requiredPerm, roleDef, roleOf, sessions, startSession, subset };
