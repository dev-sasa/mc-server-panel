'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startPanel } = require('./helpers');

let mock, base, p, a;
const calls = [];
const TOKEN = 'abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwxyz0';
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(b); } catch {}
      calls.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/v10/users/@me/channels') return res.end(JSON.stringify({ id: 'DM-' + body.recipient_id }));
      res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${mock.address().port}`;
  p = await startPanel({ MCPANEL_TEST_WEBHOOK: base });
  a = await p.admin();
});
after(async () => { await p.stop(); mock.close(); });

test('DM nur mit Bot-Token und Discord-ID', async () => {
  assert.equal((await a.put('/api/me/discord', { discordId: '123456789012345678', password: 'dev' })).status, 200);
  assert.equal((await a.put('/api/me/notifications', { dm: true })).status, 400); // Bot fehlt
  assert.equal((await a.post('/api/me/dm-test')).status, 400);
  assert.equal((await a.put('/api/webhook', { enabled: false, botToken: 'quatsch' })).status, 400);
  assert.equal((await a.put('/api/webhook', { enabled: false, botToken: TOKEN })).status, 200);
  const g = await a.get('/api/webhook');
  assert.equal(g.json.hasBot, true);
  assert.doesNotMatch(g.text, /abcdefghijklmnopqrstuvwx/); // Token wird nie zurückgegeben
  assert.doesNotMatch((await a.get('/api/config')).text, /abcdefghijklmnopqrstuvwx/);
  assert.equal((await a.get('/api/me/settings')).json.botActive, true);
});

test('Test-DM und Ereignis-DM gehen an die Discord-ID des Benutzers', { timeout: 40000 }, async () => {
  assert.equal((await a.post('/api/me/dm-test')).status, 200);
  const ch = calls.find((c) => c.url === '/api/v10/users/@me/channels');
  assert.equal(ch.auth, 'Bot ' + TOKEN);
  assert.equal(ch.body.recipient_id, '123456789012345678');
  assert.ok(calls.some((c) => c.url === '/api/v10/channels/DM-123456789012345678/messages' && /Test erfolgreich/.test(JSON.stringify(c.body))));
  assert.equal((await a.put('/api/me/notifications', { dm: true, events: { start: true } })).status, 200);
  const n = calls.length;
  await a.post('/api/server/start');
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && !calls.slice(n).some((c) => /Server ist online/.test(JSON.stringify(c.body)))) await new Promise((r) => setTimeout(r, 200));
  assert.ok(calls.slice(n).some((c) => /Server ist online/.test(JSON.stringify(c.body))));
  await a.post('/api/server/stop');
});

test('Ohne Discord-ID wird keine DM geschickt, Bot-Token lässt sich löschen', async () => {
  assert.equal((await a.put('/api/me/discord', { discordId: '', password: 'dev' })).status, 200);
  assert.equal((await a.get('/api/me/settings')).json.notify.dm, false);
  assert.equal((await a.put('/api/webhook', { enabled: false, removeBot: true })).status, 200);
  assert.equal((await a.get('/api/webhook')).json.hasBot, false);
});
