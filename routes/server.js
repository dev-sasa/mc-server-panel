'use strict';
// Server-Steuerung, Panel-Konfiguration, Passwort, vorhandenen Server einbinden
const fs = require('fs');
const path = require('path');
const { app } = require('../lib/app');
const { parseTarget } = require('../lib/backupUtil');
const { detect } = require('../lib/detect');
const { clearSessionCookie, dropSessions, findUser } = require('../lib/auth');
const { MEM_RE, S, audit, checkPassword, config, ctxOf, hashPassword, httpError, saveConfig, wrap } = require('../lib/core');
const { logBuf, sendCommand, startServer, statusObj, stopServer } = require('../lib/minecraft');

/* ---- Server-Steuerung ---- */
app.get('/api/status', (req, res) => res.json(statusObj()));
app.get('/api/log', (req, res) => res.json({ lines: logBuf }));
app.post('/api/server/start', wrap(async (req, res) => { await startServer(); audit(ctxOf(req), 'server_start'); res.json({ ok: true }); }));
app.post('/api/server/stop', wrap(async (req, res) => { stopServer(); audit(ctxOf(req), 'server_stop'); res.json({ ok: true }); }));
app.post('/api/server/restart', wrap(async (req, res) => {
  if (!S.proc) { await startServer(); audit(ctxOf(req), 'server_restart', 'Server lief nicht – nur gestartet'); return res.json({ ok: true }); }
  S.restartAfterStop = true;
  stopServer();
  audit(ctxOf(req), 'server_restart');
  res.json({ ok: true });
}));
app.post('/api/server/kill', wrap(async (req, res) => {
  if (!S.proc) throw httpError(409, 'Server läuft nicht');
  S.stopRequested = true;
  S.proc.kill('SIGKILL');
  audit(ctxOf(req), 'server_kill');
  res.json({ ok: true });
}));
app.post('/api/server/command', wrap(async (req, res) => {
  sendCommand(req.body.cmd);
  audit(ctxOf(req), 'command', req.body.cmd);
  res.json({ ok: true });
}));

/* ---- Panel-Konfiguration ---- */
app.get('/api/config', (req, res) => {
  const { users, discord, webhook, ...rest } = config;
  res.json({ ...rest, serverTime: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), serverTz: Intl.DateTimeFormat().resolvedOptions().timeZone });
});
app.put('/api/config', wrap(async (req, res) => {
  const b = req.body;
  if (!MEM_RE.test(b.memMin) || !MEM_RE.test(b.memMax)) throw httpError(400, 'RAM im Format 2G oder 2048M angeben');
  if (!b.jarFile || /[\/\\]/.test(b.jarFile)) throw httpError(400, 'Ungültiger Dateiname für die Server-JAR');
  if (!b.javaPath) throw httpError(400, 'Java-Pfad fehlt');
  const port = parseInt(b.port, 10);
  if (!(port > 0 && port < 65536)) throw httpError(400, 'Ungültiger Panel-Port');
  const times = [...new Set((Array.isArray(b.restartTimes) ? b.restartTimes : []).map(String))];
  if (times.length > 12 || times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw httpError(400, 'Ungültige Neustart-Zeit (Format HH:MM, höchstens 12 Zeiten)');
  times.sort();
  const bTimes = [...new Set((Array.isArray(b.backupTimes) ? b.backupTimes : []).map(String))];
  if (bTimes.length > 12 || bTimes.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw httpError(400, 'Ungültige Backup-Zeit (Format HH:MM, höchstens 12 Zeiten)');
  bTimes.sort();
  const bEx = [...new Set((Array.isArray(b.backupExclude) ? b.backupExclude : []).map((x) => String(x).trim()).filter(Boolean))];
  if (bEx.length > 50 || bEx.some((x) => x.length > 200 || /[\0\r\n]/.test(x) || x.startsWith('/') || x.split('/').includes('..'))) throw httpError(400, 'Ungültiger Eintrag bei „Nicht sichern“ (relativ zum Server-Ordner, kein „..“, höchstens 50 Zeilen)');
  const bCopy = parseTarget(b.backupCopy); // wirft bei ungültigem Ziel
  const before = { ...config };
  Object.assign(config, {
    javaPath: String(b.javaPath),
    jarFile: String(b.jarFile),
    memMin: b.memMin,
    memMax: b.memMax,
    extraArgs: String(b.extraArgs || ''),
    autoRestart: !!b.autoRestart,
    restartTimes: times,
    backupTimes: bTimes,
    backupExclude: bEx,
    backupCopy: bCopy ? bCopy.spec : '',
    restartWarn: b.restartWarn !== false,
    backupIntervalHours: Math.max(0, parseInt(b.backupIntervalHours, 10) || 0),
    backupKeep: Math.max(0, parseInt(b.backupKeep, 10) || 0),
    port,
  });
  saveConfig();
  const changes = ['javaPath', 'jarFile', 'memMin', 'memMax', 'extraArgs', 'autoRestart', 'restartTimes', 'restartWarn', 'backupIntervalHours', 'backupKeep', 'backupTimes', 'backupExclude', 'backupCopy', 'port']
    .filter((k) => String(before[k]) !== String(config[k])).map((k) => `${k}: ${before[k]} → ${config[k]}`);
  audit(ctxOf(req), 'config_save', changes.join(', ') || 'keine Änderung');
  res.json({ ok: true, note: 'Ein geänderter Panel-Port gilt erst nach Neustart des Panels.' });
}));
/* ---- Vorhandenen Server einbinden: erkennen, was im Server-Ordner liegt, und übernehmen ---- */
app.get('/api/server/detect', wrap(async (req, res) => res.json(await detect())));
app.post('/api/server/adopt', wrap(async (req, res) => {
  if (S.proc) throw httpError(409, 'Bitte zuerst den Server stoppen');
  const b = req.body || {};
  const jar = String(b.jarFile || ''), args = String(b.launchArgsFile || '');
  const base = path.resolve(config.serverDir);
  if (!jar && !args) throw httpError(400, 'Bitte eine Server-Datei oder Argumentdatei angeben');
  if (jar && (/[\/\\]/.test(jar) || !/\.jar$/i.test(jar) || !fs.existsSync(path.join(base, jar)))) throw httpError(400, 'Diese .jar-Datei liegt nicht im Server-Ordner');
  if (args) {
    const full = path.resolve(base, args);
    if (!full.startsWith(base + path.sep) || /\.\./.test(args) || !fs.existsSync(full)) throw httpError(400, 'Diese Argumentdatei liegt nicht im Server-Ordner');
  }
  const type = String(b.type || ''), version = String(b.version || '').trim();
  if (type && !['vanilla', 'paper', 'purpur', 'folia', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge'].includes(type)) throw httpError(400, 'Unbekannte Server-Software');
  if (version && !/^[\w.\-]{1,40}$/.test(version)) throw httpError(400, 'Ungültige Minecraft-Version');
  if (jar) config.jarFile = jar;
  config.launchArgsFile = args;
  config.serverType = type; config.serverVersion = version;
  saveConfig();
  audit(ctxOf(req), 'config_save', `Vorhandenen Server eingebunden: ${args || jar} (${type || '?'} ${version})`);
  res.json({ ok: true });
}));
app.post('/api/password', wrap(async (req, res) => {
  const { current, next } = req.body;
  const me = findUser(req.user);
  if (!checkPassword(current, me.passwordHash)) throw httpError(403, 'Aktuelles Passwort falsch');
  if (!next || next.length < 8) throw httpError(400, 'Neues Passwort: mindestens 8 Zeichen');
  me.passwordHash = hashPassword(next);
  saveConfig();
  audit(ctxOf(req), 'password_change');
  dropSessions(me.username);
  clearSessionCookie(req, res);
  res.json({ ok: true });
}));
