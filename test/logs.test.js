'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { WebSocket } = require('ws');
const { startPanel } = require('./helpers');

let p, a;
before(async () => {
  p = await startPanel(); a = await p.admin();
  const d = path.join(p.serverDir, 'logs');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'latest.log'), [
    '[10:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.4',
    '[10:01:00] [Server thread/INFO]: Steve joined the game',
    '[10:01:30] [Server thread/INFO]: <Steve> hallo zusammen',
    '[10:02:00] [Server thread/WARN]: Can\'t keep up! Is the server overloaded?',
    '[10:03:00] [Server thread/ERROR]: Fehler im Plugin Foo',
    'java.lang.NullPointerException: x',
    '\tat foo.Bar.baz(Bar.java:1)',
    '[10:04:00] [Server thread/INFO]: Alex issued server command: /gamemode creative',
    '[10:05:00] [Server thread/INFO]: Steves left the game',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(d, '2026-01-01-1.log.gz'), zlib.gzipSync('[09:00:00] [Server thread/INFO]: <Notch> altes gespräch\n[09:01:00] [Server thread/INFO]: Notch left the game\n'));
  fs.mkdirSync(path.join(p.serverDir, 'crash-reports'), { recursive: true });
  fs.writeFileSync(path.join(p.serverDir, 'crash-reports/crash-1.txt'), 'Description: Ticking entity\njava.lang.Error\n');
});
after(async () => { await p.stop(); });
const S = (qs) => a.get('/api/logs/search?' + qs);

test('Dateiliste enthält aktuelles Log, gepackte Logs und Absturzberichte', async () => {
  const f = (await a.get('/api/logs/files')).json.files;
  assert.equal(f[0].name, 'latest.log');
  assert.ok(f.some((x) => x.gz && x.date === '2026-01-01'));
  assert.ok(f.some((x) => x.crash && x.ref === 'crash:crash-1.txt'));
});

test('Suche, Spielerfilter, Ebene, Typ und Stapelspuren', async () => {
  let r = (await S('file=latest.log')).json.items;
  assert.equal(r.length, 7);
  assert.equal(r[0].time, '10:05:00'); // neueste zuerst
  const err = (await S('file=latest.log&level=ERROR')).json.items;
  assert.equal(err.length, 1);
  assert.match(err[0].text, /NullPointerException/); // Fortsetzungszeilen gehören dazu
  r = (await S('file=latest.log&player=Steve')).json.items;
  assert.deepEqual(r.map((x) => x.time).sort(), ['10:01:00', '10:01:30']); // „Steves“ passt nicht
  r = (await S('file=latest.log&type=chat')).json.items;
  assert.equal(r.length, 1);
  r = (await S('file=latest.log&type=join')).json.items;
  assert.equal(r.length, 2);
  r = (await S('file=latest.log&type=command')).json.items;
  assert.equal(r[0].text.includes('gamemode'), true);
  r = (await S('file=latest.log&q=OVERLOADED')).json.items;
  assert.equal(r.length, 1);
  assert.equal(r[0].level, 'WARN');
});

test('Alle Dateien gleichzeitig (auch gepackte), Datumsfilter, Seiten', async () => {
  let r = (await S('file=all&player=Notch')).json.items;
  assert.equal(r.length, 2);
  assert.equal(r[0].file, '2026-01-01-1.log.gz');
  r = (await S('file=all&to=2026-01-02')).json.items;
  assert.ok(r.every((x) => x.date <= '2026-01-02'));
  const page1 = (await S('file=all&limit=3')).json;
  assert.equal(page1.items.length, 3);
  assert.equal(page1.more, true);
  const page2 = (await S('file=all&limit=3&offset=3')).json;
  assert.ok(page2.items.length > 0);
  const c = (await S('file=crash:crash-1.txt')).json.items;
  assert.ok(c.length >= 2);
});

test('Spielernamen aus dem Log für die Auswahl', async () => {
  const n = (await a.get('/api/logs/players')).json.names;
  assert.ok(n.includes('Steve'));
});

test('Ungültige Angaben und Pfad-Tricks', async () => {
  for (const f of ['../config.json', '..%2Fconfig.json', 'crash:..%2F..%2Fconfig.json', 'a/b.log', 'x.exe']) assert.ok((await S('file=' + f)).status >= 400, f);
  assert.equal((await S('file=nichtda.log')).status, 404);
  assert.equal((await S('file=all&player=' + encodeURIComponent('a|b'))).status, 400);
  assert.equal((await a.get('/api/logs/download?file=..%2Fconfig.json')).status, 400);
  assert.equal((await a.get('/api/logs/download?file=latest.log')).status, 200);
});

test('Rechte: Betrachter nein, Moderator ja', async () => {
  await a.post('/api/users', { username: 'v1', password: 'passwort123', role: 'viewer' });
  await a.post('/api/users', { username: 'm1', password: 'passwort123', role: 'moderator' });
  assert.equal((await (await p.client().login('v1', 'passwort123')).get('/api/logs/files')).status, 403);
  assert.equal((await (await p.client().login('m1', 'passwort123')).get('/api/logs/files')).status, 200);
});

/* ---- Einstellungen des eigenen Kontos ---- */
test('Konto: Discord-ID mit Passwort, Eindeutigkeit, Benachrichtigungen', async () => {
  const s = (await a.get('/api/me/settings')).json;
  assert.equal(s.username, 'admin');
  assert.equal(s.notify.events.crash, true);
  assert.equal((await a.put('/api/me/notifications', { dm: true })).status, 400); // ohne Discord-ID nicht möglich
  assert.equal((await a.put('/api/me/discord', { discordId: '123456789012345678', password: 'falsch' })).status, 403);
  assert.equal((await a.put('/api/me/discord', { discordId: 'abc', password: 'dev' })).status, 400);
  assert.equal((await a.put('/api/me/discord', { discordId: '123456789012345678', password: 'dev' })).status, 200);
  const m = await p.client().login('m1', 'passwort123');
  assert.equal((await m.put('/api/me/discord', { discordId: '123456789012345678', password: 'passwort123' })).status, 409);
  assert.equal((await a.put('/api/me/notifications', { events: { start: true } })).status, 200);
  const n = (await a.get('/api/me/settings')).json.notify;
  assert.deepEqual([n.events.start, n.events.crash], [true, true]);
  assert.equal((await a.put('/api/me/discord', { discordId: '', password: 'dev' })).status, 200);
  assert.equal((await a.get('/api/me/settings')).json.notify.dm, false);
});

test('Persönlicher Hinweis im Panel kommt per WebSocket an, wenn das Ereignis angehakt ist', { timeout: 40000 }, async () => {
  await a.put('/api/me/notifications', { panel: true, events: { start: true, stop: false } });
  const ws = new WebSocket(p.base.replace('http', 'ws') + '/ws', { headers: { cookie: a.cookie } });
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'notify') got.push(m); });
  await new Promise((r) => ws.on('open', r));
  await a.post('/api/server/start');
  const t0 = Date.now();
  while (!got.length && Date.now() - t0 < 25000) await new Promise((r) => setTimeout(r, 200));
  assert.equal(got[0].event, 'start');
  await a.post('/api/server/stop');
  ws.close();
});

test('Überall abmelden beendet alle Sitzungen', async () => {
  const x = await p.client().login('m1', 'passwort123');
  const y = await p.client().login('m1', 'passwort123');
  assert.equal((await x.post('/api/me/logout-all')).status, 200);
  assert.equal((await y.get('/api/status')).status, 401);
});

test('Posteingang: Meldungen werden gespeichert, gelesen und geleert', { timeout: 40000 }, async () => {
  const q = await startPanel();
  try {
    const u = await q.admin();
    assert.equal((await u.put('/api/me/notifications', { panel: true, events: { start: true } })).status, 200);
    assert.deepEqual((await u.get('/api/me/inbox')).json, { items: [], unread: 0 });
    await u.post('/api/server/start'); // der Benutzer ist per HTTP, nicht per WebSocket verbunden – die Meldung muss trotzdem im Posteingang landen
    const t0 = Date.now();
    let box;
    while (Date.now() - t0 < 25000) { box = (await u.get('/api/me/inbox')).json; if (box.items.length) break; await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(box.items[0].event, 'start');
    assert.equal(box.unread, 1);
    assert.equal(box.items[0].read, false);
    assert.equal((await u.post('/api/me/inbox/read', { ids: [box.items[0].id] })).status, 200);
    assert.equal((await u.get('/api/me/inbox')).json.unread, 0);
    // fremde Posteingänge sind getrennt
    await u.post('/api/users', { username: 'zz', password: 'passwort123', role: 'viewer' });
    const z = await q.client().login('zz', 'passwort123');
    assert.deepEqual((await z.get('/api/me/inbox')).json.items, []);
    assert.equal((await u.del('/api/me/inbox')).status, 200);
    assert.equal((await u.get('/api/me/inbox')).json.items.length, 0);
    await u.post('/api/server/stop');
  } finally { await q.stop(); }
});
