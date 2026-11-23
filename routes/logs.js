'use strict';
// Server-Logs: alle Logdateien (auch gepackte) lesen, durchsuchen und filtern
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { app } = require('../lib/app');
const { audit, config, ctxOf, httpError, wrap } = require('../lib/core');

const logsDir = () => path.join(path.resolve(config.serverDir), 'logs');
const crashDir = () => path.join(path.resolve(config.serverDir), 'crash-reports');
const NAME_RE = /^[\w.-]{1,120}\.(?:log|log\.gz|txt)$/;
const MAX_SCAN_LINES = 3_000_000; // Obergrenze je Anfrage
const MAX_MATCHES_PER_FILE = 20000;

/** Datei-Angabe der Oberfläche -> echter Pfad. „crash:name“ = Absturzbericht. */
function resolveFile(ref) {
  const crash = String(ref).startsWith('crash:');
  const name = crash ? String(ref).slice(6) : String(ref);
  if (!NAME_RE.test(name)) throw httpError(400, 'Ungültiger Dateiname');
  return { full: path.join(crash ? crashDir() : logsDir(), name), name, crash, ref: (crash ? 'crash:' : '') + name };
}
const dateOfName = (name, mtime) => {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date(mtime).toISOString().slice(0, 10);
};

app.get('/api/logs/files', wrap(async (req, res) => {
  const out = [];
  for (const [dir, crash] of [[logsDir(), false], [crashDir(), true]]) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch { continue; }
    for (const name of names) {
      if (!NAME_RE.test(name)) continue;
      const st = await fsp.stat(path.join(dir, name)).catch(() => null);
      if (!st || !st.isFile()) continue;
      out.push({ ref: (crash ? 'crash:' : '') + name, name, crash, size: st.size, mtime: st.mtimeMs, gz: name.endsWith('.gz'), date: dateOfName(name, st.mtimeMs) });
    }
  }
  out.sort((a, b) => (a.name === 'latest.log' ? -1 : b.name === 'latest.log' ? 1 : b.mtime - a.mtime));
  res.json({ files: out });
}));

// Zeile -> { time, thread, level, text }. Neue Form: [12:00:01] [Server thread/INFO]: Text   Alte Form: [12:00:01 INFO]: Text
const RE_HEAD = /^\[(\d{2}:\d{2}:\d{2})(?: ([A-Z]+))?\]\s*(?:\[([^\]]*?)(?:\/([A-Z]+))?\])?(?:\s*\[[^\]]*\])?:?\s?(.*)$/;
function parseLine(line) {
  const m = line.match(RE_HEAD);
  if (!m) return null;
  const level = (m[2] || m[4] || 'INFO').replace('FATAL', 'ERROR');
  return { time: m[1], thread: m[3] || '', level: ['WARN', 'ERROR', 'INFO', 'DEBUG'].includes(level) ? level : 'INFO', text: m[5] };
}
const RE_CHAT = /^(?:\[Not Secure\] )?(?:\[[^\]]+\] )?<[^>]{1,40}> /;
const RE_JOIN = /(?: joined the game| left the game| logged in with entity id| lost connection: | \(\/[\d.:a-f]+\) lost connection)/;
const RE_CMD = /(?: issued server command: |Server command:|Rcon issued)/;
function typeOf(text) {
  if (RE_CHAT.test(text)) return 'chat';
  if (RE_JOIN.test(text)) return 'join';
  if (RE_CMD.test(text)) return 'command';
  return 'other';
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Liest eine Datei Zeile für Zeile (gepackte werden unterwegs entpackt) und sammelt Treffer. */
async function scanFile(f, st, flt, budget) {
  const date = dateOfName(f.name, st.mtimeMs);
  if (flt.from && date < flt.from && !f.name.startsWith('latest')) return [];
  if (flt.to && date > flt.to) return [];
  const input = fs.createReadStream(f.full);
  const stream = f.name.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
  stream.on('error', () => {}); input.on('error', () => {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const hits = [];
  let cur = null, n = 0;
  const flush = () => {
    if (!cur) return;
    const hay = cur.text.toLowerCase();
    const ok = (!flt.levels || flt.levels.has(cur.level)) && (!flt.types || flt.types.has(cur.type))
      && (!flt.q || hay.includes(flt.q)) && (!flt.playerRe || flt.playerRe.test(cur.text))
      && (!flt.from || cur.date >= flt.from) && (!flt.to || cur.date <= flt.to);
    if (ok && hits.length < MAX_MATCHES_PER_FILE) hits.push(cur);
    cur = null;
  };
  try {
    for await (const line of rl) {
      if (++n > budget.lines) { budget.truncated = true; break; }
      const p = f.crash ? null : parseLine(line);
      if (p) { flush(); cur = { file: f.ref, date, ...p, type: typeOf(p.text), line: n }; }
      else if (cur) { if (cur.text.length < 20000) cur.text += '\n' + line; }
      else cur = { file: f.ref, date, time: '', thread: '', level: /exception|error|crash/i.test(line) ? 'ERROR' : 'INFO', text: line, type: 'other', line: n }; // Absturzberichte: Zeilen einzeln
      if (f.crash && cur) flush();
    }
  } finally { rl.close(); stream.destroy(); }
  flush();
  budget.lines -= Math.min(n, budget.lines);
  return hits;
}

app.get('/api/logs/search', wrap(async (req, res) => {
  const q = req.query;
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 200));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const set = (v, allowed) => { const l = String(v || '').split(',').filter((x) => allowed.includes(x)); return l.length ? new Set(l) : null; };
  const players = String(q.player || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (players.some((p) => !/^[\w.*-]{1,32}$/.test(p))) throw httpError(400, 'Ungültiger Spielername');
  const flt = {
    q: String(q.q || '').toLowerCase().slice(0, 200),
    levels: set(q.level, ['INFO', 'WARN', 'ERROR', 'DEBUG']),
    types: set(q.type, ['chat', 'join', 'command', 'other']),
    playerRe: players.length ? new RegExp('(?<![\\w.])(?:' + players.map(esc).join('|') + ')(?![\\w])', 'i') : null,
    from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : '',
  };
  // welche Dateien?
  let files = [];
  if (!q.file || q.file === 'all') {
    for (const dir of [logsDir()]) {
      for (const name of await fsp.readdir(dir).catch(() => [])) if (NAME_RE.test(name)) files.push({ full: path.join(dir, name), name, crash: false, ref: name });
    }
  } else files = [resolveFile(q.file)];
  const withStat = [];
  for (const f of files) { const st = await fsp.stat(f.full).catch(() => null); if (st && st.isFile()) withStat.push([f, st]); else if (files.length === 1) throw httpError(404, 'Datei nicht gefunden'); }
  withStat.sort((a, b) => (a[0].name === 'latest.log' ? -1 : b[0].name === 'latest.log' ? 1 : b[1].mtimeMs - a[1].mtimeMs));
  const budget = { lines: MAX_SCAN_LINES, truncated: false };
  const items = [];
  let total = 0;
  for (const [f, st] of withStat) {
    if (budget.lines <= 0) { budget.truncated = true; break; }
    const hits = (await scanFile(f, st, flt, budget)).reverse(); // neueste zuerst
    total += hits.length;
    for (const h of hits) items.push(h);
    if (items.length >= offset + limit + 1 && withStat.length > 1) break; // genug für diese Seite
  }
  const page = items.slice(offset, offset + limit);
  res.json({ items: page, more: items.length > offset + limit || budget.truncated, truncated: budget.truncated, scannedFiles: withStat.length });
}));

// Spielernamen, die im aktuellen Log vorkommen (für die Spielerauswahl)
app.get('/api/logs/players', wrap(async (req, res) => {
  const file = path.join(logsDir(), 'latest.log');
  const st = await fsp.stat(file).catch(() => null);
  const names = new Set();
  if (st && st.isFile() && st.size < 40 * 1024 * 1024) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const m = line.match(/\]: (?:System chat: |\[Not Secure\] )?(?:<([\w.]{2,32})> |([\w.]{2,32}) (?:joined|left) the game)/);
      if (m) names.add(m[1] || m[2]);
      if (names.size >= 300) break;
    }
  }
  res.json({ names: [...names].sort((a, b) => a.localeCompare(b)) });
}));

app.get('/api/logs/download', wrap(async (req, res) => {
  const f = resolveFile(req.query.file);
  if (!fs.existsSync(f.full)) throw httpError(404, 'Datei nicht gefunden');
  audit(ctxOf(req), 'log_download', f.ref);
  res.download(f.full, f.name);
}));
