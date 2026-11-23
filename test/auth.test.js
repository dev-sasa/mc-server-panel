'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPanel } = require('./helpers');

let p;
before(async () => { p = await startPanel(); });
after(async () => { await p.stop(); });

test('API ohne Anmeldung ist gesperrt, Seiten leiten zum Login', async () => {
  const c = p.client();
  assert.equal((await c.get('/api/status')).status, 401);
  assert.equal((await c.get('/api/files')).status, 401);
  const r = await c.get('/konsole');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /login/);
});

test('Login: richtige und falsche Zugangsdaten', async () => {
  const c = p.client();
  assert.equal((await c.post('/api/login', { username: 'admin', password: 'falsch' })).status, 401);
  assert.equal((await c.post('/api/login', { username: 'gibtsnicht', password: 'x' })).status, 401);
  await c.login('admin', 'dev');
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.role, 'admin');
  assert.equal((await c.post('/api/logout')).status, 200);
  assert.equal((await c.get('/api/status')).status, 401);
});

test('Sitzungs-Cookie ist HttpOnly und SameSite', async () => {
  const r = await p.client().post('/api/login', { username: 'admin', password: 'dev' });
  const c = r.setCookie.find((x) => x.startsWith('mcp_session='));
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
});

test('Protokoll enthält keine IP-Adressen', async () => {
  const a = await p.admin();
  const r = await a.get('/api/audit?limit=500');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length > 0);
  assert.doesNotMatch(JSON.stringify(r.json.items), /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|::1/);
});

test('Rate-Limit nach fünf Fehlversuchen', { timeout: 20000 }, async () => {
  const q = await startPanel();
  try {
    const c = q.client();
    let last;
    for (let i = 0; i < 6; i++) last = await c.post('/api/login', { username: 'admin', password: 'falsch' });
    assert.equal(last.status, 429);
    // auch das richtige Passwort wird jetzt kurz abgewiesen
    assert.equal((await c.post('/api/login', { username: 'admin', password: 'dev' })).status, 429);
  } finally { await q.stop(); }
});
