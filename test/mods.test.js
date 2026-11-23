'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { startPanel } = require('./helpers');

// Ein kleiner Modrinth-Nachbau
const sha = (b) => crypto.createHash('sha512').update(b).digest('hex');
const FILES = { 'plug-a-1.0.jar': Buffer.from('JAR-A-1'), 'plug-a-2.0.jar': Buffer.from('JAR-A-2'), 'lib-b-1.jar': Buffer.from('JAR-B'), 'bad.jar': Buffer.from('JAR-BAD') };
let mock, base, p, a;
const seen = [];

const ver = (id, project, number, file, extra = {}) => ({
  id, project_id: project, version_number: number, name: number, version_type: 'release', date_published: '2025-01-0' + (extra.day || 1) + 'T00:00:00Z',
  game_versions: ['1.21.4'], dependencies: extra.deps || [],
  files: [{ primary: true, filename: extra.filename || file, url: `${base}/files/${file}`, size: FILES[file].length, hashes: { sha512: extra.hash || sha(FILES[file]) } }],
});
const V = () => ({
  AAAA1111: [ver('VA2', 'AAAA1111', '2.0', 'plug-a-2.0.jar', { day: 2, deps: [{ project_id: 'BBBB2222', dependency_type: 'required' }, { project_id: 'OPTIONAL1', dependency_type: 'optional' }] }), ver('VA1', 'AAAA1111', '1.0', 'plug-a-1.0.jar', { deps: [{ project_id: 'BBBB2222', dependency_type: 'required' }] })],
  BBBB2222: [ver('VB1', 'BBBB2222', '1', 'lib-b-1.jar')],
  BADHASH1: [ver('VBAD', 'BADHASH1', '1', 'bad.jar', { hash: 'f'.repeat(128) })],
  EVIL0001: [ver('VEV', 'EVIL0001', '1', 'bad.jar', { filename: '../evil.jar' })],
});

before(async () => {
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(req.url);
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    let m;
    if (u.pathname === '/v2/search') return json({ total_hits: 1, hits: [{ project_id: 'AAAA1111', slug: 'plug-a', title: 'Plugin A', description: 'Tut etwas', icon_url: '', author: 'x', downloads: 42, display_categories: ['paper'] }] });
    if ((m = u.pathname.match(/^\/v2\/project\/(\w+)\/version$/))) return json(V()[m[1]] || []);
    if ((m = u.pathname.match(/^\/v2\/project\/(\w+)$/))) return json({ id: m[1], slug: m[1].toLowerCase(), title: 'Titel ' + m[1] });
    if ((m = u.pathname.match(/^\/v2\/version\/(\w+)$/))) return json(Object.values(V()).flat().find((v) => v.id === m[1]) || {});
    if (u.pathname === '/v2/version_files/update') {
      let b = ''; req.on('data', (d) => { b += d; });
      return req.on('end', () => { const body = JSON.parse(b); const out = {}; for (const h of body.hashes) if (h === sha(FILES['plug-a-1.0.jar'])) out[h] = V().AAAA1111[0]; return json(out); });
    }
    if ((m = u.pathname.match(/^\/files\/(.+)$/)) && FILES[m[1]]) { res.setHeader('content-type', 'application/java-archive'); return res.end(FILES[m[1]]); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${mock.address().port}`;
  p = await startPanel({ MCPANEL_MODRINTH_API: base + '/v2' });
  a = await p.admin();
});
after(async () => { await p.stop(); mock.close(); });

test('Ohne Server-Software oder bei Vanilla gibt es eine klare Meldung', async () => {
  const r = await a.get('/api/mods/search?q=x');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Server-Software/);
  assert.equal((await a.put('/api/mods/info', { type: 'vanilla', version: '1.21.4' })).status, 200);
  assert.match((await a.get('/api/mods/search?q=x')).json.error, /Vanilla/);
  assert.equal((await a.put('/api/mods/info', { type: 'unsinn', version: '1' })).status, 400);
});

test('Suche nutzt Loader und Version des Servers', async () => {
  assert.equal((await a.put('/api/mods/info', { type: 'paper', version: '1.21.4' })).status, 200);
  const info = (await a.get('/api/mods/info')).json;
  assert.equal(info.dir, 'plugins');
  const r = await a.get('/api/mods/search?q=plug');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.hits[0].title, 'Plugin A');
  const last = decodeURIComponent(seen.filter((s) => s.startsWith('/v2/search')).pop());
  assert.match(last, /categories:paper/);
  assert.match(last, /categories:spigot/);
  assert.match(last, /versions:1\.21\.4/);
  assert.match(last, /server_side:required/); // Standard: nur Dinge, die auf dem Server laufen
  assert.doesNotMatch(last, /unsupported/);
  await a.get('/api/mods/search?q=plug&env=client');
  assert.match(decodeURIComponent(seen.filter((s) => s.startsWith('/v2/search')).pop()), /server_side:unsupported/);
  await a.get('/api/mods/search?q=plug&env=all');
  assert.doesNotMatch(decodeURIComponent(seen.filter((s) => s.startsWith('/v2/search')).pop()), /server_side/);
});

test('Installieren: Pflicht-Abhängigkeit kommt mit, optionale nicht, Dateien liegen in plugins/', async () => {
  const r = await a.post('/api/mods/install', { projectId: 'AAAA1111' });
  assert.equal(r.status, 200, r.text);
  const files = fs.readdirSync(path.join(p.serverDir, 'plugins')).sort();
  assert.deepEqual(files, ['lib-b-1.jar', 'plug-a-2.0.jar']);
  assert.equal(r.json.installed.length, 2);
  assert.ok(r.json.installed.find((i) => i.projectId === 'BBBB2222').dependency);
  const list = (await a.get('/api/mods/installed')).json.items;
  assert.equal(list.find((i) => i.file === 'plug-a-2.0.jar').title, 'Titel AAAA1111');
  assert.equal(list.find((i) => i.file === 'lib-b-1.jar').dependency, true);
  assert.ok(!fs.readdirSync(path.join(p.serverDir, 'plugins')).some((f) => f.endsWith('.part')));
});

test('Falsche Prüfsumme und böse Dateinamen werden abgelehnt, nichts bleibt liegen', async () => {
  const bad = await a.post('/api/mods/install', { projectId: 'BADHASH1' });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /Prüfsumme/);
  const evil = await a.post('/api/mods/install', { projectId: 'EVIL0001' });
  assert.equal(evil.status, 502);
  assert.equal(fs.existsSync(path.join(p.serverDir, 'evil.jar')), false);
  assert.equal(fs.existsSync(path.join(p.dir, 'evil.jar')), false);
  assert.ok(!fs.readdirSync(path.join(p.serverDir, 'plugins')).some((f) => /bad|\.part/.test(f)));
  assert.equal((await a.post('/api/mods/install', { projectId: '../etc' })).status, 400);
});

test('Update-Prüfung, Ersetzen durch neue Version und Entfernen', async () => {
  // eine alte Version einspielen: Datei und Eintrag auf 1.0 zurücksetzen
  const dir = path.join(p.serverDir, 'plugins');
  fs.writeFileSync(path.join(dir, 'plug-a-1.0.jar'), FILES['plug-a-1.0.jar']);
  fs.rmSync(path.join(dir, 'plug-a-2.0.jar'));
  const mf = path.join(p.dir, 'mods.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  Object.assign(m.AAAA1111, { file: 'plug-a-1.0.jar', versionNumber: '1.0', versionId: 'VA1' });
  fs.writeFileSync(mf, JSON.stringify(m));
  const up = await a.get('/api/mods/updates');
  assert.equal(up.status, 200, up.text);
  assert.equal(up.json.updates.length, 1);
  assert.equal(up.json.updates[0].to, '2.0');
  const r = await a.post('/api/mods/install', { projectId: 'AAAA1111', versionId: up.json.updates[0].versionId });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['lib-b-1.jar', 'plug-a-2.0.jar']); // alte Datei ist weg
  assert.equal((await a.del('/api/mods/installed?file=' + encodeURIComponent('../../config.json'))).status, 400);
  assert.equal((await a.del('/api/mods/installed?file=lib-b-1.jar')).status, 200);
  assert.deepEqual(fs.readdirSync(dir), ['plug-a-2.0.jar']);
});

test('Rechte: nur mit „Installation“', async () => {
  assert.equal((await a.post('/api/users', { username: 'mod1', password: 'passwort123', role: 'moderator' })).status, 200);
  const m = await p.client().login('mod1', 'passwort123');
  assert.equal((await m.get('/api/mods/info')).status, 403);
  assert.equal((await m.post('/api/mods/install', { projectId: 'AAAA1111' })).status, 403);
});
