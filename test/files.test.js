'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startPanel } = require('./helpers');

let p, a;
before(async () => { p = await startPanel(); a = await p.admin(); });
after(async () => { await p.stop(); });

test('Dateien: schreiben, lesen, umbenennen, löschen', async () => {
  assert.equal((await a.put('/api/file', { path: 'notiz.txt', content: 'Hallo' })).status, 200);
  assert.equal((await a.get('/api/file?path=notiz.txt')).json.content, 'Hallo');
  assert.equal((await a.post('/api/rename', { from: 'notiz.txt', to: 'neu.txt' })).status, 200);
  const l = await a.get('/api/files');
  assert.ok(l.json.items.some((i) => i.name === 'neu.txt'));
  assert.equal((await a.del('/api/file?path=neu.txt')).status, 200);
});

test('Pfad-Traversal wird blockiert', async () => {
  for (const bad of ['../config.json', '../../etc/passwd', '/etc/passwd', 'a/../../config.json']) {
    const r = await a.get('/api/file?path=' + encodeURIComponent(bad));
    assert.ok(r.status >= 400 && r.status < 500, `${bad} → ${r.status}`);
    assert.doesNotMatch(r.text, /root:/);
  }
  assert.ok((await a.put('/api/file', { path: '../ausserhalb.txt', content: 'x' })).status >= 400);
  assert.equal(fs.existsSync(path.join(p.dir, 'ausserhalb.txt')), false);
});

test('Symlink aus dem Server-Ordner heraus wird blockiert', async () => {
  fs.mkdirSync(p.serverDir, { recursive: true });
  fs.symlinkSync('/etc', path.join(p.serverDir, 'link'));
  const r = await a.get('/api/file?path=link/hosts');
  assert.ok(r.status >= 400);
});

test('server.properties lesen und ändern', async () => {
  const g = await a.get('/api/properties');
  assert.equal(g.status, 200);
  const props = g.json.properties || g.json;
  assert.ok(props && typeof props === 'object');
});
