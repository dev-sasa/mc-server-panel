'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { startPanel } = require('./helpers');

let p, a;
before(async () => { p = await startPanel(); a = await p.admin(); });
after(async () => { await p.stop(); });

const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('Zeit abgelaufen');
};

test('Simulierten Server starten, Spieler erscheinen, Befehl senden, stoppen', { timeout: 60000 }, async () => {
  assert.equal((await a.get('/api/status')).json.state, 'stopped');
  assert.equal((await a.post('/api/server/start')).status, 200);
  await until(async () => (await a.get('/api/status')).json.state === 'running');
  const st = await until(async () => { const s = (await a.get('/api/status')).json; return s.players && s.players.length ? s : null; });
  assert.ok(st.players.includes('Steve'));
  const pl = await a.get('/api/players');
  assert.equal(pl.status, 200);
  assert.ok(Array.isArray(pl.json.online));
  assert.equal((await a.post('/api/server/command', { cmd: 'say Hallo' })).status, 200);
  await until(async () => (await a.get('/api/log')).json.lines.some((l) => /Hallo/.test(l)));
  // Sicherungen/Installation sind bei laufendem Server gesperrt
  assert.equal((await a.post('/api/install', { type: 'paper', version: '1.21.1' })).status, 409);
  assert.equal((await a.post('/api/server/stop')).status, 200);
  await until(async () => (await a.get('/api/status')).json.state === 'stopped', 40000);
});

test('WebSocket: nur mit Anmeldung, liefert Status', async () => {
  const bad = new WebSocket(p.base.replace('http', 'ws') + '/ws');
  const code = await new Promise((r) => { bad.on('unexpected-response', (_q, res) => r(res.statusCode)); bad.on('error', () => r(0)); });
  assert.ok(code === 401 || code === 0);
  const ws = new WebSocket(p.base.replace('http', 'ws') + '/ws', { headers: { cookie: a.cookie } });
  const first = await new Promise((resolve, reject) => { ws.on('message', (d) => resolve(JSON.parse(d))); ws.on('error', reject); });
  assert.equal(first.type, 'init');
  assert.ok(first.status && 'state' in first.status);
  ws.close();
});

test('Konfiguration lesen und ändern, ungültige Werte abweisen', async () => {
  const c = (await a.get('/api/config')).json;
  assert.equal(c.users, undefined);
  assert.equal((await a.put('/api/config', { ...c, memMax: 'viel' })).status, 400);
  assert.equal((await a.put('/api/config', { ...c, restartTimes: ['25:99'] })).status, 400);
  assert.equal((await a.put('/api/config', { ...c, memMax: '3G' })).status, 200);
  assert.equal((await a.get('/api/config')).json.memMax, '3G');
});

test('Versionsliste und EULA erreichbar', async () => {
  assert.equal((await a.get('/api/eula')).status, 200);
  assert.equal((await a.get('/api/discord')).status, 200);
});

test('Changelog wird gegliedert geliefert', async () => {
  const r = await a.get('/api/changelog');
  assert.equal(r.status, 200);
  assert.ok(r.json.version);
  assert.ok(r.json.entries.length >= 2);
  assert.ok(r.json.entries[0].groups.some((g) => g.items.length));
  assert.ok(r.json.entries.some((e) => e.version === '1.0.0' && e.date === '2026-11-23'));
  const v = await p.client().login('admin', 'dev');
  assert.equal((await v.get('/api/changelog')).status, 200);
});
