'use strict';
// Spielerstatistik, auch rückwirkend: aus den Statistikdateien der Welt (Spielzeit, Tode, Kills), den Logs (erster/letzter Besuch,
// Beitritte, Banns) und einer kleinen Merkdatei, die auch dann bleibt, wenn alte Logs gelöscht werden.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { DATA, config, parseProps, readAudit } = require('./core');

const STORE = path.join(DATA, 'playerlog.json');
let store = {};
try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch {}
let saveTimer = null;
const saveStore = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(STORE, JSON.stringify(store), { mode: 0o600 }); } catch {} }, 1500); };
const entry = (name) => (store[name.toLowerCase()] = store[name.toLowerCase()] || { name, firstSeen: 0, lastSeen: 0, joins: 0 });

/** Live vom Panel gemeldet (Beitritt oder Verlassen). */
function touch(name, kind) {
  const e = entry(name); e.name = name;
  const now = Date.now();
  if (!e.firstSeen) e.firstSeen = now;
  e.lastSeen = now;
  if (kind === 'join') e.joins = (e.joins || 0) + 1;
  saveStore();
}

const levelName = () => { try { return parseProps(fs.readFileSync(path.join(config.serverDir, 'server.properties'), 'utf8'))['level-name'] || 'world'; } catch { return 'world'; } };
const readJson = async (f, dflt) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return dflt; } };

/* ---- Logs lesen (zwischengespeichert, bis sich eine Logdatei ändert) ---- */
const dateOfName = (name, mtime) => { const m = name.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : new Date(mtime).toISOString().slice(0, 10); };
const RE_JOIN = /^\[(\d{2}:\d{2}:\d{2})[^\]]*\](?: \[[^\]]*\])?:? ?(?:System chat: |\[Not Secure\] )?([\w.]{2,32}) joined the game\s*$/;
const RE_BAN = /^\[(\d{2}:\d{2}:\d{2})[^\]]*\](?: \[[^\]]*\])?:? ?(?:\[[^\]]*\]: )?Banned ([\w.]{2,32})(?:: (.*))?\s*$/;
const RE_UNBAN = /^\[(\d{2}:\d{2}:\d{2})[^\]]*\](?: \[[^\]]*\])?:? ?Unbanned ([\w.]{2,32})\s*$/;
let logCache = { key: '', data: null };
async function scanLogs() {
  const dir = path.join(path.resolve(config.serverDir), 'logs');
  let names = [];
  try { names = (await fsp.readdir(dir)).filter((n) => /\.log(\.gz)?$/.test(n)); } catch { return { players: {}, bans: {} }; }
  const stats = await Promise.all(names.map(async (n) => ({ n, st: await fsp.stat(path.join(dir, n)).catch(() => null) })));
  const files = stats.filter((x) => x.st && x.st.isFile());
  const key = files.map((f) => `${f.n}:${f.st.size}:${Math.round(f.st.mtimeMs)}`).sort().join('|');
  if (logCache.key === key && logCache.data) return logCache.data;
  const players = {}, bans = {};
  let budget = 3_000_000;
  for (const f of files) {
    const date = dateOfName(f.n, f.st.mtimeMs);
    const input = fs.createReadStream(path.join(dir, f.n));
    const stream = f.n.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
    stream.on('error', () => {}); input.on('error', () => {});
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (--budget <= 0) break;
        let m;
        if (line.indexOf('joined the game') > 0 && (m = line.match(RE_JOIN))) {
          const ts = Date.parse(`${date}T${m[1]}`);
          const p = (players[m[2].toLowerCase()] = players[m[2].toLowerCase()] || { name: m[2], firstSeen: ts, lastSeen: ts, joins: 0 });
          p.joins++; p.firstSeen = Math.min(p.firstSeen, ts); p.lastSeen = Math.max(p.lastSeen, ts);
        } else if (line.indexOf('Banned ') > 0 && (m = line.match(RE_BAN))) {
          (bans[m[2].toLowerCase()] = bans[m[2].toLowerCase()] || []).push({ ts: Date.parse(`${date}T${m[1]}`), type: 'ban', reason: m[3] || '', source: 'log' });
        } else if (line.indexOf('Unbanned ') > 0 && (m = line.match(RE_UNBAN))) {
          (bans[m[2].toLowerCase()] = bans[m[2].toLowerCase()] || []).push({ ts: Date.parse(`${date}T${m[1]}`), type: 'unban', source: 'log' });
        }
      }
    } finally { rl.close(); stream.destroy(); }
    if (budget <= 0) break;
  }
  logCache = { key, data: { players, bans } };
  // in die Merkdatei übernehmen, damit es auch nach dem Löschen alter Logs bleibt
  for (const [k, p] of Object.entries(players)) {
    const e = entry(p.name); e.name = p.name; void k;
    e.firstSeen = e.firstSeen ? Math.min(e.firstSeen, p.firstSeen) : p.firstSeen;
    e.lastSeen = Math.max(e.lastSeen || 0, p.lastSeen);
    e.joins = Math.max(e.joins || 0, p.joins);
  }
  saveStore();
  return logCache.data;
}

/* ---- Statistikdateien der Welt ---- */
function readStats(j) {
  const s = j.stats || j; // neu: { stats: {...} }, alt (vor 1.13): flach
  const c = s['minecraft:custom'] || {};
  const ticks = c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? j['stat.playOneMinute'] ?? 0;
  return { playSeconds: Math.round(ticks / 20), deaths: c['minecraft:deaths'] ?? j['stat.deaths'] ?? 0, mobKills: c['minecraft:mob_kills'] ?? j['stat.mobKills'] ?? 0 };
}

async function allPlayers(onlineNames, flags) {
  const base = path.resolve(config.serverDir), level = path.join(base, levelName());
  const byUuid = new Map(), byName = new Map();
  const add = (name, uuid) => { if (!name) return null; const k = name.toLowerCase(); const p = byName.get(k) || { name, uuid: uuid || '' }; if (uuid && !p.uuid) p.uuid = uuid; byName.set(k, p); if (p.uuid) byUuid.set(p.uuid.toLowerCase(), p); return p; };
  for (const u of await readJson(path.join(base, 'usercache.json'), [])) add(u.name, u.uuid);
  for (const list of [flags.whitelist, flags.ops, flags.banned]) for (const u of list) add(u.name, u.uuid);
  (onlineNames || []).forEach((n) => add(n));
  Object.values(store).forEach((e) => add(e.name));
  let hasStats = false;
  // Statistik- und Spielerdaten-Dateien: Dateiname = UUID
  let files = []; try { files = await fsp.readdir(path.join(level, 'stats')); } catch {}
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const uuid = f.slice(0, -5);
    const j = await readJson(path.join(level, 'stats', f), null);
    if (!j) continue;
    hasStats = true;
    const p = byUuid.get(uuid.toLowerCase()) || add('…' + uuid.slice(0, 8), uuid);
    Object.assign(p, readStats(j), { hasStats: true });
  }
  for (const p of byName.values()) {
    if (!p.uuid) continue;
    const st = await fsp.stat(path.join(level, 'playerdata', p.uuid + '.dat')).catch(() => null);
    if (st) p.dataSeen = st.mtimeMs;
  }
  const { players: logP, bans } = await scanLogs();
  const out = [];
  for (const [k, p] of byName) {
    const st = store[k] || {}, lg = logP[k] || {};
    const online = (onlineNames || []).some((n) => n.toLowerCase() === k);
    const seen = [st.lastSeen, lg.lastSeen, p.dataSeen].filter(Boolean);
    const first = [st.firstSeen, lg.firstSeen].filter(Boolean);
    out.push({
      name: p.name, uuid: p.uuid || '', online,
      playSeconds: p.playSeconds ?? null, deaths: p.deaths ?? null, mobKills: p.mobKills ?? null,
      firstSeen: first.length ? Math.min(...first) : null, lastSeen: online ? Date.now() : (seen.length ? Math.max(...seen) : null),
      joins: Math.max(st.joins || 0, lg.joins || 0) || null,
      banEvents: (bans[k] || []).length,
    });
  }
  return { players: out, hasStats, hasLogs: Object.keys(logP).length > 0 };
}

async function history(name) {
  const k = name.toLowerCase();
  const { bans } = await scanLogs();
  const ev = [...(bans[k] || [])];
  const base = path.resolve(config.serverDir);
  const cur = (await readJson(path.join(base, 'banned-players.json'), [])).find((b) => (b.name || '').toLowerCase() === k);
  if (cur) ev.push({ ts: Date.parse(cur.created) || 0, type: 'ban', reason: cur.reason || '', source: cur.source || '', current: true, expires: cur.expires || 'forever' });
  for (const a of readAudit()) {
    if (!/^player_(ban|pardon|kick)$/.test(a.action)) continue;
    const [n, ...rest] = String(a.detail).split(' – ');
    if (n.toLowerCase() !== k) continue;
    ev.push({ ts: a.t, type: a.action === 'player_pardon' ? 'unban' : a.action === 'player_kick' ? 'kick' : 'ban', reason: rest.join(' – '), source: 'Panel: ' + a.user, panel: true });
  }
  // doppelte Einträge (Log + Panel + Datei zur selben Zeit) zusammenfassen
  ev.sort((a, b) => b.ts - a.ts);
  const out = [];
  for (const e of ev) {
    const dup = out.find((o) => o.type === e.type && Math.abs(o.ts - e.ts) < 120000);
    if (dup) { dup.reason = dup.reason || e.reason; dup.source = [dup.source, e.source].filter((x, i, arr) => x && arr.indexOf(x) === i).join(', '); dup.current = dup.current || e.current; dup.expires = dup.expires || e.expires; } else out.push({ ...e });
  }
  return out;
}

module.exports = { touch, allPlayers, history };
