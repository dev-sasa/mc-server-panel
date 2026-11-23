'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPanel } = require('./helpers');

let p, a;
before(async () => {
  p = await startPanel();
  a = await p.admin();
  fs.mkdirSync(path.join(p.serverDir, 'world'), { recursive: true });
  fs.mkdirSync(path.join(p.serverDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(p.serverDir, 'world', 'level.dat'), 'welt-v1');
  fs.writeFileSync(path.join(p.serverDir, 'server.properties'), 'motd=eins\n');
  fs.writeFileSync(path.join(p.serverDir, 'logs', 'latest.log'), 'log');
});
after(async () => { await p.stop(); });

test('Backup anlegen, Ausschlüsse beachten, Inhalt auflisten', async () => {
  const r = await a.post('/api/backups');
  assert.equal(r.status, 200, r.text);
  const name = r.json.name;
  const list = await a.get('/api/backups');
  assert.ok(list.json.items.some((i) => i.name === name));
  const c = await a.get(`/api/backups/${encodeURIComponent(name)}/contents`);
  assert.equal(c.status, 200, c.text);
  const names = JSON.stringify(c.json);
  assert.match(names, /world/);
  assert.doesNotMatch(names, /latest\.log/);
  p.backup = name;
});

test('Teilweise Wiederherstellung: nur die gewählten Einträge', async () => {
  fs.writeFileSync(path.join(p.serverDir, 'world', 'level.dat'), 'welt-v2');
  fs.writeFileSync(path.join(p.serverDir, 'server.properties'), 'motd=zwei\n');
  const r = await a.post(`/api/backups/${encodeURIComponent(p.backup)}/restore`, { paths: ['world'] });
  assert.equal(r.status, 200, r.text);
  assert.equal(fs.readFileSync(path.join(p.serverDir, 'world', 'level.dat'), 'utf8'), 'welt-v1');
  assert.equal(fs.readFileSync(path.join(p.serverDir, 'server.properties'), 'utf8'), 'motd=zwei\n');
  assert.ok(fs.existsSync(path.join(p.dir, 'server.before-restore', 'world', 'level.dat')));
});

test('Wiederherstellung lehnt ungültige Pfade ab', async () => {
  for (const bad of [['../x'], ['/etc'], ['a/../b'], []]) {
    const r = await a.post(`/api/backups/${encodeURIComponent(p.backup)}/restore`, { paths: bad });
    assert.ok([400].includes(r.status) || r.status === 200 && !bad.length, JSON.stringify(bad) + ' → ' + r.status);
  }
});

test('Backup-Name wird geprüft (kein Pfad-Trick)', async () => {
  const r = await a.get('/api/backups/' + encodeURIComponent('../config.json') + '/download');
  assert.ok(r.status >= 400);
});

test('Backup löschen', async () => {
  assert.equal((await a.del(`/api/backups/${encodeURIComponent(p.backup)}`)).status, 200);
});

test('Backup wird geprüft, Speicherinfo und Kopierziel (Ordner) funktionieren', async () => {
  const q = await startPanel();
  try {
    const b = await q.admin();
    fs.mkdirSync(path.join(q.serverDir, 'world'), { recursive: true });
    fs.writeFileSync(path.join(q.serverDir, 'world', 'level.dat'), 'x'.repeat(5000));
    const copyDir = path.join(q.dir, 'zweiter-ort');
    // ungültige Ziele werden abgelehnt
    const cfg = (await b.get('/api/config')).json;
    for (const bad of ['relativ/pfad', '-oProxyCommand=x', '/a/../b', 'user@host:relativ', 'user@host:/a b']) {
      assert.equal((await b.put('/api/config', { ...cfg, backupCopy: bad })).status, 400, bad);
    }
    assert.equal((await b.post('/api/backups/copy-test', { target: copyDir })).status, 200);
    assert.equal((await b.put('/api/config', { ...cfg, backupCopy: copyDir })).status, 200);
    const r = await b.post('/api/backups');
    assert.equal(r.status, 200, r.text);
    assert.ok(fs.existsSync(path.join(copyDir, r.json.name)), 'Kopie fehlt');
    const list = (await b.get('/api/backups')).json;
    assert.ok(list.disk.free > 0 && list.disk.total >= list.disk.free);
    assert.equal(list.copy.target, copyDir);
    assert.equal(list.copy.last.ok, true);
    assert.equal((await b.post(`/api/backups/${encodeURIComponent(r.json.name)}/verify`)).status, 200);
    // beschädigtes Archiv wird erkannt
    const file = path.join(q.backupDir, r.json.name);
    const buf = fs.readFileSync(file);
    fs.writeFileSync(file, buf.subarray(0, Math.floor(buf.length / 2)));
    assert.equal((await b.post(`/api/backups/${encodeURIComponent(r.json.name)}/verify`)).status, 422);
    assert.equal((await b.post('/api/backups/nicht-da.tar.gz/verify')).status, 404);
  } finally { await q.stop(); }
});
