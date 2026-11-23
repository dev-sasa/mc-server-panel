'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startPanel } = require('./helpers');

let p, a, S;
before(async () => { p = await startPanel(); a = await p.admin(); S = p.serverDir; fs.mkdirSync(S, { recursive: true }); });
after(async () => { await p.stop(); });
const w = (f, c = '') => { fs.mkdirSync(path.dirname(path.join(S, f)), { recursive: true }); fs.writeFileSync(path.join(S, f), c); };
const wipe = () => { for (const n of fs.readdirSync(S)) fs.rmSync(path.join(S, n), { recursive: true, force: true }); };

test('Erkennung: Paper-Server', async () => {
  wipe(); w('paper-1.21.4-123.jar', 'x'.repeat(500)); w('config/paper-global.yml', ''); w('server.properties', 'level-name=welt\n'); w('welt/level.dat', 'x');
  const d = (await a.get('/api/server/detect')).json;
  assert.equal(d.suggestion.jarFile, 'paper-1.21.4-123.jar');
  assert.equal(d.suggestion.type, 'paper');
  assert.equal(d.suggestion.version, '1.21.4');
  assert.equal(d.hasWorld, true);
  assert.equal(d.level, 'welt');
});

test('Erkennung: Forge und NeoForge über die Argumentdatei', async () => {
  wipe(); w('libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt', '-x'); w('server.jar', 'x');
  let d = (await a.get('/api/server/detect')).json;
  assert.deepEqual([d.suggestion.type, d.suggestion.version, d.suggestion.launchArgsFile], ['forge', '1.20.1', 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt']);
  wipe(); w('libraries/net/neoforged/neoforge/21.1.65/unix_args.txt', '-x');
  d = (await a.get('/api/server/detect')).json;
  assert.deepEqual([d.suggestion.type, d.suggestion.version], ['neoforge', '1.21.1']);
});

test('Erkennung: Fabric, Installer wird nicht gewählt, leerer Ordner', async () => {
  wipe(); w('.fabric/x', ''); w('fabric-server-launch.jar', 'x'); w('fabric-installer-1.0.jar', 'x'.repeat(9000)); w('server.jar', 'x');
  let d = (await a.get('/api/server/detect')).json;
  assert.deepEqual([d.suggestion.type, d.suggestion.jarFile], ['fabric', 'fabric-server-launch.jar']);
  wipe();
  d = (await a.get('/api/server/detect')).json;
  assert.equal(d.suggestion, null);
  assert.ok(d.notes.length);
});

test('Übernehmen: prüft Dateien, speichert Einstellungen', async () => {
  wipe(); w('mein-server.jar', 'x'); w('libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt', '-x');
  assert.equal((await a.post('/api/server/adopt', { jarFile: 'gibts-nicht.jar' })).status, 400);
  assert.equal((await a.post('/api/server/adopt', { jarFile: '../x.jar' })).status, 400);
  assert.equal((await a.post('/api/server/adopt', { launchArgsFile: '../config.json' })).status, 400);
  assert.equal((await a.post('/api/server/adopt', { jarFile: 'mein-server.jar', type: 'unsinn' })).status, 400);
  assert.equal((await a.post('/api/server/adopt', { jarFile: 'mein-server.jar', type: 'paper', version: '1.21.4' })).status, 200);
  assert.equal((await a.get('/api/config')).json.jarFile, 'mein-server.jar');
  const info = (await a.get('/api/mods/info')).json;
  assert.deepEqual([info.type, info.version], ['paper', '1.21.4']);
  assert.equal((await a.post('/api/server/adopt', { launchArgsFile: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt', type: 'forge', version: '1.20.1' })).status, 200);
  assert.equal((await a.get('/api/config')).json.launchArgsFile, 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt');
  // Rechte: Moderator darf das nicht
  await a.post('/api/users', { username: 'm9', password: 'passwort123', role: 'moderator' });
  const m = await p.client().login('m9', 'passwort123');
  assert.equal((await m.get('/api/server/detect')).status, 403);
});

/* ---- Spielerstatistik rückwirkend ---- */
test('Spielzeit, letzter Besuch, Beitritte und Ban-Verlauf aus vorhandenen Daten', async () => {
  wipe();
  const uuid = '11111111-2222-3333-4444-555555555555';
  w('server.properties', 'level-name=world\n');
  w('usercache.json', JSON.stringify([{ name: 'Steve', uuid, expiresOn: '2099-01-01' }]));
  w(`world/stats/${uuid}.json`, JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 216000, 'minecraft:deaths': 7, 'minecraft:mob_kills': 120 } }, DataVersion: 3955 }));
  w(`world/playerdata/${uuid}.dat`, 'x');
  const old = new Date('2026-11-10T20:00:00Z'); fs.utimesSync(path.join(S, `world/playerdata/${uuid}.dat`), old, old);
  const d = path.join(S, 'logs'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '2026-11-01-1.log.gz'), zlib.gzipSync('[10:00:00] [Server thread/INFO]: Steve joined the game\n[10:05:00] [Server thread/INFO]: Steve left the game\n[11:00:00] [Server thread/INFO]: Banned Steve: Griefing\n'));
  fs.writeFileSync(path.join(d, 'latest.log'), '[12:00:00] [Server thread/INFO]: Steve joined the game\n[12:30:00] [Server thread/INFO]: Unbanned Steve\n');
  w('banned-players.json', JSON.stringify([{ uuid, name: 'Steve', created: '2026-11-02 09:00:00 +0000', source: 'Alex', expires: 'forever', reason: 'Cheating' }]));
  const r = (await a.get('/api/players/stats')).json;
  assert.equal(r.hasStats, true);
  const s = r.players.find((x) => x.name === 'Steve');
  assert.equal(s.playSeconds, 10800); // 216000 Ticks = 3 Stunden
  assert.equal(s.deaths, 7);
  assert.equal(s.mobKills, 120);
  assert.equal(s.joins, 2);
  assert.equal(s.banned, true);
  assert.equal(new Date(s.firstSeen).toISOString().slice(0, 10), '2026-11-01');
  assert.ok(s.lastSeen >= Date.parse('2026-11-10T20:00:00Z')); // playerdata-Datei oder Log, was neuer ist
  const h = (await a.get('/api/players/history?name=Steve')).json.events;
  assert.ok(h.some((e) => e.type === 'ban' && e.reason === 'Griefing'));
  assert.ok(h.some((e) => e.type === 'unban'));
  assert.ok(h.some((e) => e.current && e.reason === 'Cheating' && e.source === 'Alex'));
  assert.equal((await a.get('/api/players/history?name=../x')).status, 400);
});

test('Merkdatei: Besuche bleiben, auch wenn die Logs gelöscht werden', async () => {
  fs.rmSync(path.join(S, 'logs'), { recursive: true, force: true });
  await new Promise((r) => setTimeout(r, 2500)); // Merkdatei wird verzögert geschrieben
  const s = (await a.get('/api/players/stats')).json.players.find((x) => x.name === 'Steve');
  assert.equal(s.joins, 2);
  assert.equal(new Date(s.firstSeen).toISOString().slice(0, 10), '2026-11-01');
});
