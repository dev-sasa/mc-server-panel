'use strict';
// Simulierter Minecraft-Server für den Dev-Modus (kein Java nötig).
const fs = require('fs');
const readline = require('readline');

const pad = (n) => String(n).padStart(2, '0');
// Wie ein echter Server: logs/latest.log schreiben; das alte latest.log wird beim Start als gepackte Datei abgelegt
const zlib = require('zlib');
fs.mkdirSync('logs', { recursive: true });
if (fs.existsSync('logs/latest.log') && fs.statSync('logs/latest.log').size > 0) {
  const day = new Date(fs.statSync('logs/latest.log').mtimeMs).toISOString().slice(0, 10);
  let n = 1; while (fs.existsSync(`logs/${day}-${n}.log.gz`)) n++;
  fs.writeFileSync(`logs/${day}-${n}.log.gz`, zlib.gzipSync(fs.readFileSync('logs/latest.log')));
}
fs.writeFileSync('logs/latest.log', '');
const log = (msg, lvl = 'INFO', thread = 'Server thread') => {
  const d = new Date();
  const line = `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}] [${thread}/${lvl}]: ${msg}`;
  console.log(line);
  try { fs.appendFileSync('logs/latest.log', line + '\n'); } catch {}
};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const writeJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const uuid = (n) => '00000000-0000-4000-8000-' + Buffer.from(n).toString('hex').padEnd(12, '0').slice(0, 12);

if (!fs.existsSync('eula.txt')) fs.writeFileSync('eula.txt', 'eula=true\n');
if (!fs.existsSync('server.properties')) {
  fs.writeFileSync('server.properties', [
    '#Minecraft server properties', 'motd=Dev-Server', 'server-port=25565', 'max-players=20',
    'gamemode=survival', 'difficulty=easy', 'pvp=true', 'online-mode=true', 'white-list=false',
    'view-distance=10', 'level-name=world', 'level-seed=', '',
  ].join('\n'));
}

// Test-Spieler für den Spieler-Tab (nur anlegen, wenn die Dateien noch fehlen)
const seed = (file, names, extra = () => ({})) => {
  if (!fs.existsSync(file)) writeJson(file, names.map((name) => ({ uuid: uuid(name), name, ...extra(name) })));
};
seed('whitelist.json', ['Notch', 'jeb_', 'Dinnerbone', 'Steve', 'Alex']);
seed('ops.json', ['Notch'], () => ({ level: 4, bypassesPlayerLimit: false }));
seed('banned-players.json', ['Herobrine'], () => ({ created: new Date().toISOString(), source: 'Server', expires: 'forever', reason: 'Testbann' }));

const online = new Set();
// FAKE_MC_FLAVOR=vanilla: kein /tps, dafür /tick query (wie Vanilla/Fabric). Standard: Paper-Verhalten (/tps und /mspt).
const FLAVOR = process.env.FAKE_MC_FLAVOR || 'paper';
const wobble = () => 18.5 + Math.random() * 1.5; // schwankende, aber gesunde Werte
const bots = ['Dinnerbone', 'Grian']; // joinen/leaven zufällig; Steve, Notch, jeb_, Alex bleiben online
let timers = [];

log('Starting minecraft server version 1.21.4 (DEV-SIMULATION)');
log('Loading properties');
setTimeout(() => log('Preparing level "world"'), 600);
setTimeout(() => log('Preparing spawn area: 42%', 'INFO', 'Worker-Main-1'), 1200);
setTimeout(() => {
  log('Done (2.4s)! For help, type "help"');
  // Vier Test-Spieler sind direkt online und bleiben es
  ['Steve', 'Notch', 'jeb_', 'Alex', '.BedrockSteve'].forEach((n, i) => timers.push(setTimeout(() => {
    online.add(n);
    if (n === 'jeb_') { // neues Format neuerer Minecraft-Versionen
      log(`${n}[/192.168.1.20:5${i}000] logged in with entity id ${40 + i} at (5.5, 68.0, 9.5)`);
      log(`System chat: ${n} joined the game`);
    } else log(`${n} joined the game`);
  }, 800 * (i + 1))));
  // Zufällige Spieler-Joins/-Leaves zum Testen
  timers.push(setInterval(() => {
    const n = bots[Math.floor(Math.random() * bots.length)];
    if (online.has(n)) { online.delete(n); log(`${n} left the game`); }
    else { online.add(n); log(`${n} joined the game`); }
  }, 12000));
  const chatter = [['Steve', 'Hat jemand Diamanten gesehen?'], ['Alex', 'Bin gleich beim Spawn'], ['Notch', 'gg'], ['jeb_', 'Wer kommt mit in den Nether?']];
  timers.push(setInterval(() => { const [n, m] = chatter[Math.floor(Math.random() * chatter.length)]; if (online.has(n)) log(`<${n}> ${m}`); }, 9000));
  timers.push(setInterval(() => log(`[Dev] Tick-Heartbeat, ${online.size} Spieler online`, 'DEBUG'), 45000));
}, 2400);

function shutdown(code = 0) {
  log('Stopping the server');
  timers.forEach(clearInterval);
  setTimeout(() => { log('Saving worlds'); }, 300);
  setTimeout(() => process.exit(code), 900);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, ...a] = line.trim().replace(/^\//, '').split(/\s+/);
  const name = a[0];
  switch (cmd) {
    case 'stop': return shutdown(0);
    case 'crash': log('Simulierter Absturz!', 'ERROR'); return process.exit(1);
    case 'list': return log(`There are ${online.size} of a max of 20 players online: ${[...online].join(', ')}`);
    case 'tps': if (FLAVOR !== 'paper') { log('Unknown or incomplete command, see below for error', 'WARN'); return log('tps<--[HERE]', 'WARN'); }
      return log(`TPS from last 1m, 5m, 15m: ${wobble().toFixed(2)}, 19.98, *20.0`);
    case 'mspt': if (FLAVOR !== 'paper') { log('Unknown or incomplete command, see below for error', 'WARN'); return log('mspt<--[HERE]', 'WARN'); }
      return log('Server tick times (avg/min/max) from last 5s, 10s, 1m: ◴ 11.4/8.2/27.1, ◴ 10.9/8.2/27.1, ◴ 11.0/7.9/31.8');
    case 'tick': if (a[0] !== 'query' || FLAVOR === 'paper') { log('Unknown or incomplete command, see below for error', 'WARN'); return log('tick<--[HERE]', 'WARN'); }
      log('The game is running normally'); log('Target tick rate: 20.0 per second.');
      log('Average time per tick: 12.3ms (Target: 50.0ms)'); return log('Percentiles: P50: 11.2ms P95: 19.8ms P99: 25.1ms, based on 100 samples');
    case 'dev-silent-join': online.add(name); return; // simuliert einen Spieler, dessen Join-Zeile nicht erkannt wurde
    case 'say': return log(`[Server] ${a.join(' ')}`);
    case 'save-all': return log('Saved the game');
    case 'save-off': return log('Automatic saving is now disabled');
    case 'save-on': return log('Automatic saving is now enabled');
    case 'help': return log('Dev-Befehle: list, say, op, deop, whitelist add|remove, kick, ban, pardon, save-all, crash, stop');
    case 'fwhitelist': { // simuliertes Floodgate: Bedrock-Spieler mit Präfix "." und Floodgate-UUID
      const f = 'whitelist.json'; const raw = a.slice(1).join(' ').trim(); const n = '.' + raw.replace(/ /g, '_');
      let d = readJson(f).filter((p) => p.name !== n);
      if (a[0] === 'add') {
        const hex = Buffer.from(raw).toString('hex').padEnd(12, '0').slice(0, 12);
        d.push({ uuid: '00000000-0000-0000-0009-' + hex, name: n });
      }
      writeJson(f, d); return log(a[0] === 'add' ? `[Floodgate] Added ${n} to the whitelist` : `[Floodgate] Removed ${n} from the whitelist`);
    }
    case 'op': case 'deop': {
      const f = 'ops.json'; let d = readJson(f).filter((p) => p.name !== name);
      if (cmd === 'op') d.push({ uuid: uuid(name), name, level: 4, bypassesPlayerLimit: false });
      writeJson(f, d); return log(cmd === 'op' ? `Made ${name} a server operator` : `Made ${name} no longer a server operator`);
    }
    case 'whitelist': {
      const f = 'whitelist.json'; const n = a[1]; let d = readJson(f).filter((p) => p.name !== n);
      if (a[0] === 'add') d.push({ uuid: uuid(n), name: n });
      writeJson(f, d); return log(a[0] === 'add' ? `Added ${n} to the whitelist` : `Removed ${n} from the whitelist`);
    }
    case 'ban': {
      const f = 'banned-players.json'; let d = readJson(f).filter((p) => p.name !== name);
      d.push({ uuid: uuid(name), name, created: new Date().toISOString(), source: 'Server', expires: 'forever', reason: a.slice(1).join(' ') || 'Banned by an operator.' });
      writeJson(f, d); log(`Banned ${name}: ${a.slice(1).join(' ') || 'Banned by an operator.'}`); if (online.delete(name)) log(`${name} left the game`); return;
    }
    case 'pardon': {
      const f = 'banned-players.json'; writeJson(f, readJson(f).filter((p) => p.name !== name)); return log(`Unbanned ${name}`);
    }
    case 'kick': log(`Kicked ${name}: ${a.slice(1).join(' ') || 'Kicked by an operator'}`); if (online.delete(name)) log(`${name} left the game`); return;
    default: return log(`Unknown or incomplete command, see below for error`, 'WARN');
  }
});
rl.on('close', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
