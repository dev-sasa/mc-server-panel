'use strict';
// Konfiguration, Hilfsfunktionen und Aktivitätsprotokoll
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// .env laden (KEY=Wert, # = Kommentar). Echte Umgebungsvariablen haben Vorrang.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { if (e.code !== 'ENOENT') console.error('.env nicht lesbar:', e.message); }
// Dev-Modus: `npm run dev` – simulierter Minecraft-Server (kein Java nötig), eigene Daten in ./.dev
const DEV = ['1', 'true'].includes(process.env.MCPANEL_DEV);
// Datenordner (config.json, audit.jsonl, server/, backups/): per MCPANEL_DATA frei wählbar (Docker, Tests), sonst ./.dev im Dev-Modus, sonst der Projektordner
const DATA = process.env.MCPANEL_DATA ? path.resolve(process.env.MCPANEL_DATA) : DEV ? path.join(ROOT, '.dev') : ROOT;
fs.mkdirSync(DATA, { recursive: true });
const CONFIG_FILE = process.env.MCPANEL_CONFIG || path.join(DATA, 'config.json');

/* ------------------------------------------------------------------ */
/* Konfiguration                                                       */
/* ------------------------------------------------------------------ */
const DEFAULTS = {
  host: DEV ? '127.0.0.1' : '0.0.0.0',
  port: 8080,
  users: [],
  discord: { enabled: false, clientId: '', clientSecret: '', redirectUri: '' },
  webhook: { enabled: false, url: '', botToken: '', events: { start: true, stop: true, crash: true, backup: false, backupFail: true, lag: true, join: false } }, // Discord-Benachrichtigungen
  serverDir: path.join(DATA, 'server'),
  backupDir: path.join(DATA, 'backups'),
  javaPath: 'java',
  jarFile: 'server.jar',
  roles: [], // eigene Rollen: [{ id, name, perms: [...] }]
  launchArgsFile: '', // Forge/NeoForge: Startdatei (Argumentdatei) statt -jar, relativ zum Server-Ordner
  memMin: '1G',
  memMax: '2G',
  extraArgs: '',
  autoRestart: true,
  restartTimes: [], // geplante tägliche Neustarts, z. B. ["05:00"] (Serverzeit)
  restartWarn: true, // Spieler 5 und 1 Minute vorher im Chat warnen
  backupIntervalHours: 0,
  backupKeep: 7,
  backupTimes: [], // feste Backup-Uhrzeiten (Serverzeit), z. B. ["04:00"]
  serverType: '', // paper | purpur | folia | spigot | fabric | quilt | forge | neoforge | vanilla (für Mods/Plugins)
  serverVersion: '', // Minecraft-Version, z. B. 1.21.4
  backupCopy: '', // optionales zweites Ziel: Ordner (/mnt/nas/backups) oder benutzer@host:/ordner (rsync über ssh)
  backupCopy: '', // optionales zweites Ziel: Ordner (/mnt/nas/backups) oder benutzer@host:/ordner (rsync über ssh)
  backupExclude: ['logs', 'crash-reports', 'cache'], // werden nicht gesichert (relativ zum Server-Ordner, * erlaubt)
};

let config = { ...DEFAULTS };
function loadConfig() {
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('config.json defekt:', e.message);
  }
}
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  const good = Buffer.from(hash, 'hex');
  return good.length === test.length && crypto.timingSafeEqual(good, test);
}

loadConfig();
if (process.env.MCPANEL_PORT) config.port = parseInt(process.env.MCPANEL_PORT, 10);
if (process.env.MCPANEL_HOST) config.host = process.env.MCPANEL_HOST;
config.discord = { ...DEFAULTS.discord, ...(config.discord || {}) };
config.webhook = { ...DEFAULTS.webhook, ...(config.webhook || {}), events: { ...DEFAULTS.webhook.events, ...((config.webhook || {}).events || {}) } };
if (process.env.DISCORD_BOT_TOKEN) config.webhook.botToken = process.env.DISCORD_BOT_TOKEN;
if (process.env.DISCORD_WEBHOOK_URL) { config.webhook.url = process.env.DISCORD_WEBHOOK_URL; config.webhook.enabled = process.env.DISCORD_WEBHOOK_ENABLED !== 'false'; }
config.roles = Array.isArray(config.roles) ? [...config.roles] : [];
// Discord-Werte aus .env überschreiben config.json (und werden nie dorthin geschrieben)
const envDiscord = {};
if (process.env.DISCORD_CLIENT_ID) envDiscord.clientId = process.env.DISCORD_CLIENT_ID;
if (process.env.DISCORD_CLIENT_SECRET) envDiscord.clientSecret = process.env.DISCORD_CLIENT_SECRET;
if (process.env.DISCORD_REDIRECT_URI) envDiscord.redirectUri = process.env.DISCORD_REDIRECT_URI;
if (envDiscord.clientId && envDiscord.clientSecret) envDiscord.enabled = process.env.DISCORD_ENABLED !== 'false';
const dc = () => ({ ...config.discord, ...envDiscord });
if (!Array.isArray(config.users)) config.users = [];
if (config.passwordHash) { // Migration von der alten Ein-Passwort-Version
  config.users.push({ username: 'admin', passwordHash: config.passwordHash, discordId: '' });
  delete config.passwordHash;
  saveConfig();
}
if (!config.users.length) {
  const pw = process.env.MCPANEL_PASSWORD || (DEV ? 'dev' : crypto.randomBytes(9).toString('base64url'));
  config.users.push({ username: 'admin', passwordHash: hashPassword(pw), discordId: '' });
  saveConfig();
  console.log('\n==============================================');
  console.log(' Erster Start – Benutzer: admin');
  console.log(' Passwort: ' + pw);
  console.log(' (Benutzer/Passwörter im Panel unter "Panel" änderbar)');
  console.log('==============================================\n');
}
if (!config.users.some((u) => u.owner)) { config.users[0].owner = true; saveConfig(); } // Hauptbenutzer = erster Benutzer
fs.mkdirSync(config.serverDir, { recursive: true });
fs.mkdirSync(config.backupDir, { recursive: true });

// Dev-Modus: Test-Spieler für Whitelist/OPs/Bans anlegen, falls noch keine Dateien existieren
if (DEV) {
  const fake = (name) => '00000000-0000-4000-8000-' + Buffer.from(name).toString('hex').padEnd(12, '0').slice(0, 12);
  const seed = (file, names, extra = () => ({})) => {
    const f = path.join(config.serverDir, file);
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(names.map((name) => ({ uuid: fake(name), name, ...extra(name) })), null, 2));
  };
  seed('whitelist.json', ['Notch', 'jeb_', 'Dinnerbone', 'Steve', 'Alex']);
  try { // Bedrock-Testspieler (Floodgate-UUID + Präfix ".") ergänzen, falls noch keine vorhanden
    const wl = path.join(config.serverDir, 'whitelist.json');
    const d = JSON.parse(fs.readFileSync(wl, 'utf8'));
    if (!d.some((p) => /^\./.test(p.name))) {
      d.push({ uuid: '00000000-0000-0000-0009-01f1a2b3c4d5', name: '.BedrockSteve' }, { uuid: '00000000-0000-0000-0009-01f1a2b3c4d6', name: '.PocketAlex' });
      fs.writeFileSync(wl, JSON.stringify(d, null, 2));
    }
  } catch {}
  seed('ops.json', ['Notch'], () => ({ level: 4, bypassesPlayerLimit: false }));
  seed('banned-players.json', ['Herobrine'], () => ({ created: new Date().toISOString(), source: 'Server', expires: 'forever', reason: 'Testbann' }));
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */
const UA = { 'User-Agent': 'MCServerPanel/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message });
  });

/** Löst einen relativen Pfad innerhalb des Server-Ordners auf (Schutz vor ../ und Symlinks). */
async function safePath(rel = '') {
  const base = path.resolve(config.serverDir);
  const full = path.resolve(base, '.' + path.sep + String(rel));
  if (full !== base && !full.startsWith(base + path.sep)) throw httpError(400, 'Ungültiger Pfad');
  // Symlink-Check: nächsten existierenden Vorfahren auflösen
  let probe = full;
  while (true) {
    try {
      const real = await fsp.realpath(probe);
      const realBase = await fsp.realpath(base);
      if (real !== realBase && !real.startsWith(realBase + path.sep)) throw httpError(400, 'Pfad außerhalb des Server-Ordners');
      break;
    } catch (e) {
      if (e.status) throw e;
      if (e.code !== 'ENOENT') throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return full;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 24, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout)
    );
  });
}

const MEM_RE = /^\d+[MmGg]$/;

/* ------------------------------------------------------------------ */
/* Aktivitätsprotokoll (Audit-Log): wer hat wann was getan             */
/* ------------------------------------------------------------------ */
const AUDIT_FILE = path.join(path.dirname(CONFIG_FILE), 'audit.jsonl');
const AUDIT_MAX = 5 * 1024 * 1024;
const ctxOf = (req) => ({ user: req.user || '' });
function auditCat(a) {
  if (/^(login|logout)/.test(a)) return 'auth';
  if (/^server_/.test(a)) return 'server';
  if (a === 'command') return 'console';
  if (/^player_/.test(a)) return 'players';
  if (/^file_/.test(a)) return 'files';
  if (/^backup_/.test(a)) return 'backups';
  if (/^(user_|role_|password_change)/.test(a)) return 'users';
  return 'settings';
}
function audit(ctx, action, detail = '') {
  try {
    const e = { t: Date.now(), user: (ctx && ctx.user) || 'System', action, cat: auditCat(action), detail: String(detail).replace(/[\r\n]+/g, ' ').slice(0, 500) };
    try { if (fs.statSync(AUDIT_FILE).size > AUDIT_MAX) fs.renameSync(AUDIT_FILE, AUDIT_FILE + '.1'); } catch {}
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(e) + '\n', { mode: 0o600 });
  } catch (err) { console.error('Audit-Log:', err.message); }
}
function readAudit() {
  const out = [];
  for (const f of [AUDIT_FILE + '.1', AUDIT_FILE]) {
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) { if (!line) continue; try { const e = JSON.parse(line); delete e.ip; out.push(e); } catch {} }
  }
  return out.reverse(); // neueste zuerst
}
// Datenschutz: IP-Adressen werden nicht protokolliert. Früher gespeicherte Einträge werden einmalig bereinigt.
(function scrubAuditIps() {
  for (const f of [AUDIT_FILE, AUDIT_FILE + '.1']) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      if (!txt.includes('"ip":')) continue;
      const out = txt.split('\n').filter(Boolean).map((l) => { try { const e = JSON.parse(l); delete e.ip; return JSON.stringify(e); } catch { return l; } });
      fs.writeFileSync(f, out.join('\n') + '\n', { mode: 0o600 });
    } catch {}
  }
})();


// Gemeinsamer, veränderlicher Laufzeitzustand (von mehreren Modulen genutzt)
// state: stopped | starting | running | stopping
const S = { proc: null, state: 'stopped', stopRequested: false, restartAfterStop: false, backupBusy: false, installBusy: false };

function parseProps(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

module.exports = { DATA, DEV, MEM_RE, ROOT, S, UA, audit, checkPassword, config, ctxOf, dc, envDiscord, hashPassword, httpError, parseProps, readAudit, run, safePath, saveConfig, sleep, wrap };
