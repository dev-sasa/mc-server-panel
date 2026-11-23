'use strict';
// Minecraft-Prozess, Konsole, Spielererkennung, CPU/RAM
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { notify, setPersonalSink } = require('./notify');
const { touch } = require('./playerStats');
const { DEV, MEM_RE, ROOT, S, audit, config, httpError, parseProps, run, sleep } = require('./core');

/* ------------------------------------------------------------------ */
/* Minecraft-Prozess (siehe unten)                                     */
/* ------------------------------------------------------------------ */
let startedAt = null;
let killTimer = null;
let crashTimes = [];
let stats = { cpu: 0, rss: 0 };
const logBuf = [];
const players = new Set();
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}
// Persönliche Hinweise: nur an die Browser der Benutzer, die das Ereignis angehakt haben
setPersonalSink((users, m) => {
  const data = JSON.stringify({ type: 'notify', ...m });
  for (const ws of clients) if (ws.readyState === 1 && users.has(ws.username)) ws.send(data);
});
function pushLog(line) {
  logBuf.push(line);
  if (logBuf.length > 2000) logBuf.shift();
  broadcast({ type: 'log', line });
}
let mcVersion = '';
let propsCache = {}, propsCacheT = 0;
function serverProps() {
  if (Date.now() - propsCacheT < 5000) return propsCache;
  propsCacheT = Date.now();
  try { propsCache = parseProps(fs.readFileSync(path.join(config.serverDir, 'server.properties'), 'utf8')); } catch { propsCache = {}; }
  return propsCache;
}
function memBytes(v) {
  const m = /^(\d+)([MmGg])$/.exec(String(v));
  return m ? parseInt(m[1], 10) * (m[2].toLowerCase() === 'g' ? 1024 ** 3 : 1024 ** 2) : 0;
}
function statusObj() {
  const p = serverProps();
  return {
    motd: String(p.motd || '').replace(/\\u00[aA]7./g, '').replace(/§./g, ''),
    maxPlayers: parseInt(p['max-players'], 10) || 20,
    levelName: p['level-name'] || 'world',
    version: mcVersion,
    memMax: memBytes(config.memMax),
    nextRestart: nextRestartTs(),
    state: S.state,
    pid: S.proc ? S.proc.pid : null,
    uptime: startedAt && S.state !== 'stopped' ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    cpu: stats.cpu,
    rss: stats.rss,
    players: [...players],
    tps: S.state === 'running' ? metrics.tps : null,
    mspt: S.state === 'running' ? metrics.mspt : null,
    tpsSupported: metrics.mode !== 'none',
    sys: { totalmem: os.totalmem(), freemem: os.freemem(), load: os.loadavg(), cpus: os.cpus().length },
  };
}
function setState(s) {
  S.state = s;
  broadcast({ type: 'status', status: statusObj() });
}

function handleLine(line) {
  const hidden = autoLine(line); // Antworten auf automatische Abfragen (list/tps) nicht im Log zeigen
  if (!hidden) pushLog(line);
  const ver = line.match(/Starting minecraft server version (\S+)/) || line.match(/\(MC: ([\d.]+)\)/);
  if (ver) mcVersion = ver[1];
  if (S.state === 'starting' && /\]: Done \(/.test(line)) { setState('running'); notify('start', '🟢 Server ist online', mcVersion ? `Minecraft ${mcVersion}` : '', 'ok'); setTimeout(() => { autoSend('list', 'list'); setTimeout(pollMetrics, 1200); }, 8000).unref(); }
  trackPlayers(line);
}
// Spieler online/offline erkennen. Je nach Minecraft-/Server-Version sieht die Zeile anders aus:
//   "Name joined the game", "System chat: Name joined the game", "[System] [CHAT] Name joined the game"
// Zusätzlich dienen "Name[/ip:port] logged in with entity id …" und "Name lost connection: …" als Gegenprobe.
const PREFIX = '(?:System chat: |\\[System\\] \\[CHAT\\] |\\[Not Secure\\] )?';
const RE_JOIN = [new RegExp('\\]: ' + PREFIX + '(\\S+) joined the game\\s*$'), /\]: (\S+?)\[\/[^\]]*\] logged in with entity id/];
const RE_LEAVE = [new RegExp('\\]: ' + PREFIX + '(\\S+) left the game\\s*$'), /\]: (\S+) lost connection: /];
function trackPlayers(line) {
  let changed = false;
  for (const re of RE_JOIN) { const m = line.match(re); if (m && !players.has(m[1])) { players.add(m[1]); touch(m[1], 'join'); changed = true; notify('join', `➕ ${m[1]} ist beigetreten`, `${players.size} Spieler online`, 'ok'); break; } }
  for (const re of RE_LEAVE) { const m = line.match(re); if (m && players.delete(m[1])) { touch(m[1], 'leave'); changed = true; notify('join', `➖ ${m[1]} hat den Server verlassen`, `${players.size} Spieler online`, 'info'); break; } }
  if (changed) broadcast({ type: 'status', status: statusObj() });
}

/* ------------------------------------------------------------------ */
/* Automatische Abfragen: Spielerliste (list) und Server-Takt (tps / tick query)  */
/* ------------------------------------------------------------------ */
// Die Antworten stehen im normalen Log. Damit die Konsole nicht alle paar Sekunden zugemüllt wird, werden Zeilen,
// die zu einer gerade gesendeten Abfrage gehören, erkannt und nicht angezeigt. Befehle, die du selbst tippst, bleiben sichtbar.
const SYNC_MS = (parseFloat(process.env.MCPANEL_SYNC_SECONDS) || 90) * 1000; // Spielerliste abgleichen
const METRICS_MS = (parseFloat(process.env.MCPANEL_METRICS_SECONDS) || 30) * 1000; // TPS abfragen
const metrics = { mode: 'unknown', tps: null, mspt: null, at: 0, msptOk: true }; // mode: unknown | tps | tick | none
// Zwei getrennte Kanäle, damit sich eine Spieler- und eine Takt-Abfrage nicht gegenseitig überschreiben:
//   list = Spielerliste, metric = tps / mspt / tick (immer nur eine davon gleichzeitig unterwegs)
const auto = { listUntil: 0, metric: null, metricUntil: 0 };
const resetMetrics = () => { Object.assign(metrics, { mode: 'unknown', tps: null, mspt: null, at: 0, msptOk: true }); auto.listUntil = 0; auto.metric = null; };
const RE_LIST = /\]: (?:System chat: )?There are (\d+) of a max of \d+ players online:?\s*(.*)$/;
const RE_TPS = /\]: TPS from last ([\w, ]+): (.+)$/;
const RE_MSPT = /\]: Server tick times \(avg\/min\/max\) from last [\w, ]+: (.+)$/;
const RE_TICK = /\]: (?:The game is |Target tick rate:|Average time per tick:|Percentiles:|P50:)/;
const RE_UNKNOWN = /\]: Unknown (?:or incomplete )?command/; // Vanilla: "Unknown or incomplete command, see below for error", Paper/Spigot: "Unknown command. Type …"
const RE_HERE = /<--\[HERE\]/;

function syncPlayers(names) {
  const next = new Set(names);
  const same = next.size === players.size && [...next].every((n) => players.has(n));
  if (same) return;
  players.clear();
  next.forEach((n) => players.add(n));
  broadcast({ type: 'status', status: statusObj() });
}
const metricOpen = (kind) => auto.metric === kind && Date.now() < auto.metricUntil;
let lowTps = 0, lagNotified = 0;
const metricUpdate = () => {
  metrics.at = Date.now();
  broadcast({ type: 'status', status: statusObj() });
  // Lag-Meldung: dreimal hintereinander unter 15 TPS, danach höchstens alle 30 Minuten
  lowTps = metrics.tps != null && metrics.tps < 15 ? lowTps + 1 : 0;
  if (lowTps >= 3 && Date.now() - lagNotified > 30 * 60000) {
    lagNotified = Date.now();
    notify('lag', '🟡 Server ruckelt', `Nur ${metrics.tps.toFixed(1)} TPS` + (metrics.mspt != null ? ` (${metrics.mspt.toFixed(1)} ms je Tick)` : '') + ` bei ${players.size} Spielern.`, 'warn');
  }
};
/** Gibt true zurück, wenn die Zeile zu einer automatischen Abfrage gehört (dann nicht ins Log schreiben). */
function autoLine(line) {
  if (auto.hideHere && Date.now() < auto.hideHere && RE_HERE.test(line)) { auto.hideHere = 0; return true; }
  let m = line.match(RE_LIST);
  if (m) {
    // Paper kann nach Gruppen sortieren ("default: A, B"), Namen enthalten keine Leerzeichen oder Doppelpunkte
    const names = m[2].split(/,\s*/).map((s) => s.replace(/^\S+:\s+/, '').trim()).filter((s) => /^\S+$/.test(s));
    syncPlayers(Number(m[1]) === 0 ? [] : names);
    return Date.now() < auto.listUntil; // nur die automatische Abfrage ausblenden, selbst getippte bleiben sichtbar
  }
  if (!auto.metric || Date.now() >= auto.metricUntil) return false;
  if (metricOpen('tps') && (m = line.match(RE_TPS))) {
    const labels = m[1].split(/,\s*/), vals = m[2].split(/,\s*/).map((v) => parseFloat(v.replace(/[^\d.]/g, '')));
    const i = Math.max(0, labels.indexOf('1m'));
    if (Number.isFinite(vals[i])) { metrics.mode = 'tps'; metrics.tps = Math.min(20, vals[i]); metricUpdate(); }
    return true;
  }
  if (metricOpen('mspt') && (m = line.match(RE_MSPT))) {
    const first = m[1].match(/(\d+(?:\.\d+)?)\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/);
    if (first) { metrics.mspt = parseFloat(first[1]); metricUpdate(); }
    return true;
  }
  if (metricOpen('tick') && RE_TICK.test(line)) {
    const a = line.match(/Average time per tick: (\d+(?:\.\d+)?)ms/);
    if (a) { metrics.mode = 'tick'; metrics.mspt = parseFloat(a[1]); metrics.tps = Math.min(20, +(1000 / Math.max(50, metrics.mspt)).toFixed(1)); metricUpdate(); }
    return true;
  }
  if (RE_UNKNOWN.test(line) || RE_HERE.test(line)) {
    if (RE_UNKNOWN.test(line)) { // diesen Befehl gibt es auf dem Server nicht
      if (auto.metric === 'tps') metrics.mode = 'tick'; // Vanilla/Fabric: stattdessen "tick query"
      else if (auto.metric === 'tick') metrics.mode = 'none';
      else if (auto.metric === 'mspt') metrics.msptOk = false;
      auto.metric = null; // weitere Zeilen derselben Fehlermeldung (<--[HERE]) trotzdem noch ausblenden
      auto.hideHere = Date.now() + 1500;
    }
    return true;
  }
  return false;
}
function autoSend(cmd, kind) {
  if (!S.proc || S.state !== 'running') return;
  if (kind === 'list') auto.listUntil = Date.now() + 2500;
  else { auto.metric = kind; auto.metricUntil = Date.now() + 2500; }
  try { sendCommand(cmd, true); } catch {}
}
function pollMetrics() {
  if (metrics.mode === 'none') return;
  if (metrics.mode === 'tick') return autoSend('tick query', 'tick');
  autoSend('tps', 'tps');
  if (metrics.mode === 'tps' && metrics.msptOk) setTimeout(() => autoSend('mspt', 'mspt'), 700).unref();
}
setInterval(() => autoSend('list', 'list'), SYNC_MS).unref();
setInterval(pollMetrics, METRICS_MS).unref();

function pipeLines(stream) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    parts.forEach(handleLine);
  });
  stream.on('end', () => buf && handleLine(buf));
}

async function startServer() {
  if (S.proc) throw httpError(409, 'Server läuft bereits');
  const jar = path.join(config.serverDir, config.jarFile);
  const useArgsFile = !!config.launchArgsFile && fs.existsSync(path.join(config.serverDir, config.launchArgsFile));
  if (!DEV && !useArgsFile && !fs.existsSync(jar)) throw httpError(400, `Server-Datei "${config.jarFile}" fehlt – unter "Installation" herunterladen.`);
  if (!MEM_RE.test(config.memMin) || !MEM_RE.test(config.memMax)) throw httpError(400, 'Ungültige RAM-Angabe (z. B. 2G oder 2048M)');
  const extra = config.extraArgs.trim() ? config.extraArgs.trim().split(/\s+/) : [];
  const args = [`-Xms${config.memMin}`, `-Xmx${config.memMax}`, ...extra, ...(useArgsFile ? ['@' + config.launchArgsFile] : ['-jar', config.jarFile]), 'nogui'];

  S.stopRequested = false;
  S.restartAfterStop = false;
  players.clear();
  resetMetrics();
  pushLog(`[Panel] Starte: ${config.javaPath} ${args.join(' ')}`);
  const [bin, binArgs] = DEV ? [process.execPath, [path.join(ROOT, 'dev', 'fake-mc.js')]] : [config.javaPath, args];
  if (DEV) pushLog('[Panel] DEV-MODUS: simulierter Server statt Java');
  const child = spawn(bin, binArgs, { cwd: config.serverDir, stdio: ['pipe', 'pipe', 'pipe'] });
  S.proc = child;
  startedAt = Date.now();
  setState('starting');
  pipeLines(child.stdout);
  pipeLines(child.stderr);
  child.stdin.on('error', () => {});

  child.on('error', (e) => {
    pushLog(`[Panel] Start fehlgeschlagen: ${e.message} (Ist Java installiert?)`);
  });
  child.on('exit', (code, sig) => {
    pushLog(`[Panel] Server beendet (Code ${code}${sig ? ', Signal ' + sig : ''})`);
    clearTimeout(killTimer);
    const wasRequested = S.stopRequested;
    const wantRestart = S.restartAfterStop;
    S.proc = null;
    startedAt = null;
    stats = { cpu: 0, rss: 0 };
    players.clear();
    setState('stopped');
    if (!wasRequested && !wantRestart && code !== 0) notify('crash', '🔴 Server abgestürzt', `Beendet mit Code ${code}${sig ? ' / ' + sig : ''}.` + (config.autoRestart ? ' Ein automatischer Neustart wird versucht.' : ''), 'bad');
    else if (wasRequested) notify('stop', '⚫ Server gestoppt', '', 'info');
    if (!wasRequested && !wantRestart && code !== 0) audit(null, 'server_crash', `Beendet mit Code ${code}${sig ? ' / ' + sig : ''}`);

    if (wantRestart) {
      setTimeout(() => startServer().catch((e) => pushLog('[Panel] ' + e.message)), 1500);
    } else if (!wasRequested && config.autoRestart && code !== 0) {
      const now = Date.now();
      crashTimes = crashTimes.filter((t) => now - t < 10 * 60 * 1000);
      crashTimes.push(now);
      if (crashTimes.length > 3) {
        pushLog('[Panel] Zu viele Abstürze in kurzer Zeit – Auto-Neustart deaktiviert.');
      } else {
        pushLog('[Panel] Absturz erkannt – Neustart in 5 Sekunden…');
        setTimeout(() => { if (!S.proc) { audit(null, 'server_start', 'Automatischer Neustart nach Absturz'); startServer().catch((e) => pushLog('[Panel] ' + e.message)); } }, 5000);
      }
    }
  });
}

function sendCommand(cmd, fromAuto = false) {
  if (!fromAuto) { // selbst getippte Abfragen sollen im Log sichtbar bleiben
    if (/^\/?list\b/i.test(String(cmd).trim())) auto.listUntil = 0;
    if (/^\/?(tps|mspt|tick)\b/i.test(String(cmd).trim())) auto.metric = null;
  }
  if (!S.proc || !S.proc.stdin.writable) throw httpError(409, 'Server läuft nicht');
  const clean = String(cmd).replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return;
  S.proc.stdin.write(clean + '\n');
}

function stopServer() {
  if (!S.proc) throw httpError(409, 'Server läuft nicht');
  S.stopRequested = true;
  setState('stopping');
  try { sendCommand('stop'); } catch {}
  clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    if (S.proc) { pushLog('[Panel] Server reagiert nicht – wird beendet (SIGKILL).'); S.proc.kill('SIGKILL'); }
  }, 60000);
}

async function waitStopped(ms = 70000) {
  const t0 = Date.now();
  while (S.proc && Date.now() - t0 < ms) await sleep(300);
}

function nextRestartTs() {
  const times = config.restartTimes || [];
  if (!times.length) return null;
  const now = new Date();
  let best = null;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    if (!best || d < best) best = d;
  }
  return best.getTime();
}
// CPU / RAM des Java-Prozesses
// cpu = momentane Auslastung in Prozent EINES Kerns (100 = ein voller Kern, bei 4 Kernen maximal 400).
// Unter Linux aus /proc (Differenz über 3 s). `ps` liefert nur den Durchschnitt seit Prozessstart und dient als Ersatz (z. B. macOS).
let cpuPrev = null; // { pid, ticks, t }
function procCpuPercent(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // ab Feld 3 (state)
    const ticks = Number(f[11]) + Number(f[12]); // utime + stime
    const now = Date.now();
    const prev = cpuPrev && cpuPrev.pid === pid ? cpuPrev : null;
    cpuPrev = { pid, ticks, t: now };
    if (!prev) return null;
    const secs = (now - prev.t) / 1000;
    return secs > 0 ? Math.max(0, ((ticks - prev.ticks) / 100 / secs) * 100) : null; // 100 Ticks pro Sekunde
  } catch { return null; }
}
setInterval(async () => {
  if (!S.proc) { cpuPrev = null; return; }
  try {
    const out = await run('ps', ['-o', '%cpu=,rss=', '-p', String(S.proc.pid)]);
    const [psCpu, rss] = out.trim().split(/\s+/).map(Number);
    const live = procCpuPercent(S.proc.pid);
    stats = { cpu: live !== null ? live : (stats.cpu || psCpu || 0), rss: (rss || 0) * 1024 };
    broadcast({ type: 'status', status: statusObj() });
  } catch {}
}, 3000);

module.exports = { clients, logBuf, players, pushLog, sendCommand, startServer, statusObj, stopServer, waitStopped };
