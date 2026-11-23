'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startPanel } = require('./helpers');

let mock, mockBase, p, a;
const got = [];
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('Zeit abgelaufen');
};

before(async () => {
  mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { try { got.push({ url: req.url, body: JSON.parse(b) }); } catch {} res.statusCode = 204; res.end(); });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  p = await startPanel({ MCPANEL_TEST_WEBHOOK: mockBase });
  a = await p.admin();
});
after(async () => { await p.stop(); mock.close(); });

const titles = () => got.map((g) => g.body.embeds[0].title);

test('Nur Discord-Webhook-Adressen werden akzeptiert', async () => {
  for (const bad of ['https://evil.example/api/webhooks/123456789012345678/' + TOKEN, 'http://discord.com/api/webhooks/123456789012345678/' + TOKEN, 'https://discord.com.evil.example/api/webhooks/123456789012345678/' + TOKEN, 'ftp://x']) {
    assert.equal((await a.put('/api/webhook', { enabled: true, url: bad })).status, 400, bad);
  }
  assert.equal((await a.put('/api/webhook', { enabled: true })).status, 400); // ohne Adresse nicht aktivierbar
  assert.equal((await a.post('/api/webhook/test', { url: 'https://evil.example/x' })).status, 400);
});

test('Webhook speichern: Adresse wird nie zurückgegeben', async () => {
  const url = `${mockBase}/api/webhooks/123456789012345678/${TOKEN}`;
  assert.equal((await a.put('/api/webhook', { enabled: true, url, events: { start: true, stop: true, crash: true, backup: true } })).status, 200);
  const g = await a.get('/api/webhook');
  assert.equal(g.json.enabled, true);
  assert.equal(g.json.hasUrl, true);
  assert.doesNotMatch(g.text, new RegExp(TOKEN));
  assert.doesNotMatch((await a.get('/api/config')).text, new RegExp(TOKEN));
});

test('Test-Nachricht, Start, Backup, Absturz und Stopp lösen Meldungen aus', { timeout: 60000 }, async () => {
  assert.equal((await a.post('/api/webhook/test', {})).status, 200);
  await until(() => titles().some((t) => /Test erfolgreich/.test(t)));
  await a.post('/api/server/start');
  await until(() => titles().some((t) => /Server ist online/.test(t)));
  await a.post('/api/backups');
  await until(() => titles().some((t) => /Backup erstellt/.test(t)));
  assert.ok(got.every((g) => g.url.startsWith('/api/webhooks/123456789012345678/')));
  assert.equal(titles().filter((t) => /beigetreten/.test(t)).length, 0, 'Join-Meldungen sind aus');
  await a.post('/api/server/command', { cmd: 'crash' });
  await until(() => titles().some((t) => /abgestürzt/.test(t)));
  assert.match(JSON.stringify(got.find((g) => /abgestürzt/.test(g.body.embeds[0].title)).body), /Code 1/);
});

test('Deaktivieren stoppt die Meldungen', async () => {
  assert.equal((await a.put('/api/webhook', { enabled: false })).status, 200);
  const n = got.length;
  await a.post('/api/backups').catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(got.length, n);
});
