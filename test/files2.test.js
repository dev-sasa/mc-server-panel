'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { startPanel } = require('./helpers');

let p, a;
before(async () => { p = await startPanel(); a = await p.admin(); fs.mkdirSync(p.serverDir, { recursive: true }); });
after(async () => { await p.stop(); });
const have = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

test('Mehrere Einträge auf einmal löschen', async () => {
  for (const n of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(p.serverDir, n), n);
  fs.mkdirSync(path.join(p.serverDir, 'ordner/unter'), { recursive: true });
  const r = await a.post('/api/files/delete', { path: '', names: ['a.txt', 'b.txt', 'ordner'] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.count, 3);
  assert.deepEqual(fs.readdirSync(p.serverDir).filter((x) => /txt|ordner/.test(x)), ['c.txt']);
  for (const bad of [['../x'], ['a/b'], ['..'], []]) assert.equal((await a.post('/api/files/delete', { path: '', names: bad })).status, 400, JSON.stringify(bad));
  assert.ok((await a.post('/api/files/delete', { path: '../', names: ['config.json'] })).status >= 400);
  assert.ok(fs.existsSync(path.join(p.dir, 'config.json')));
});

test('Auswahl als tar.gz laden', async () => {
  fs.mkdirSync(path.join(p.serverDir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(p.serverDir, 'plugins/x.yml'), 'x: 1');
  fs.writeFileSync(path.join(p.serverDir, 'motd.txt'), 'hi');
  const res = await fetch(p.base + '/api/files/archive?path=&name=plugins&name=motd.txt', { headers: { cookie: a.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /\.tar\.gz/);
  const out = path.join(p.dir, 'dl.tar.gz');
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  const list = execFileSync('tar', ['-tzf', out]).toString();
  assert.match(list, /plugins\/x\.yml/);
  assert.match(list, /motd\.txt/);
  assert.equal((await fetch(p.base + '/api/files/archive?path=&name=..%2Fconfig.json', { headers: { cookie: a.cookie } })).status, 400);
  assert.equal((await fetch(p.base + '/api/files/archive?path=&name=gibtsnicht', { headers: { cookie: a.cookie } })).status, 404);
});

test('tar.gz entpacken, unsichere Archive werden abgelehnt', async () => {
  const work = path.join(p.dir, 'work');
  fs.mkdirSync(path.join(work, 'inhalt'), { recursive: true });
  fs.writeFileSync(path.join(work, 'inhalt/datei.txt'), 'drin');
  execFileSync('tar', ['-czf', path.join(p.serverDir, 'paket.tar.gz'), '-C', work, 'inhalt']);
  const r = await a.post('/api/files/extract', { path: 'paket.tar.gz' });
  assert.equal(r.status, 200, r.text);
  assert.equal(fs.readFileSync(path.join(p.serverDir, 'inhalt/datei.txt'), 'utf8'), 'drin');
  // Archiv mit Symlink
  fs.symlinkSync('/etc', path.join(work, 'inhalt/link'));
  execFileSync('tar', ['-czf', path.join(p.serverDir, 'link.tar.gz'), '-C', work, 'inhalt']);
  const bad = await a.post('/api/files/extract', { path: 'link.tar.gz', to: 'ziel' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Verknüpfungen/);
  assert.equal((await a.post('/api/files/extract', { path: 'motd.txt' })).status, 400);
  assert.ok((await a.post('/api/files/extract', { path: 'paket.tar.gz', to: '../draussen' })).status >= 400);
});

test('zip entpacken (wenn unzip und zip vorhanden sind)', { skip: !(have('unzip') && have('zip')) }, async () => {
  const work = path.join(p.dir, 'zwork');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'z.txt'), 'zip-inhalt');
  execFileSync('zip', ['-q', path.join(p.serverDir, 'a.zip'), 'z.txt'], { cwd: work });
  const r = await a.post('/api/files/extract', { path: 'a.zip', to: 'entpackt' });
  assert.equal(r.status, 200, r.text);
  assert.equal(fs.readFileSync(path.join(p.serverDir, 'entpackt/z.txt'), 'utf8'), 'zip-inhalt');
});
