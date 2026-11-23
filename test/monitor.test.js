'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { startPanel } = require('./helpers');

const panels = [];
const FAST = { MCPANEL_SYNC_SECONDS: '2', MCPANEL_METRICS_SECONDS: '2' };
after(async () => { for (const p of panels) await p.stop(); });

const until = async (fn, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('Zeit abgelaufen');
};
async function running(env) {
  const p = await startPanel({ ...FAST, ...env });
  panels.push(p);
  const a = await p.admin();
  await a.post('/api/server/start');
  await until(async () => (await a.get('/api/status')).json.state === 'running');
  return { p, a };
}

test('Paper-Verhalten: TPS und MSPT erscheinen, die Abfragen bleiben aus dem Log', { timeout: 60000 }, async () => {
  const { a } = await running({});
  const s = await until(async () => { const j = (await a.get('/api/status')).json; return j.tps != null && j.mspt != null ? j : null; });
  assert.equal(s.tpsSupported, true);
  assert.ok(s.tps > 15 && s.tps <= 20, 'tps ' + s.tps);
  assert.ok(Math.abs(s.mspt - 11.4) < 0.01, 'mspt ' + s.mspt);
  await new Promise((r) => setTimeout(r, 5000)); // mehrere Abfragerunden
  const log = (await a.get('/api/log')).json.lines.join('\n');
  assert.doesNotMatch(log, /TPS from last|Server tick times|There are \d+ of a max/);
});

test('Spielerliste wird mit „list“ abgeglichen, wenn eine Join-Zeile fehlt', { timeout: 60000 }, async () => {
  const { a } = await running({});
  await until(async () => (await a.get('/api/status')).json.players.includes('Steve'));
  await a.post('/api/server/command', { cmd: 'dev-silent-join Zed' });
  assert.ok(!(await a.get('/api/status')).json.players.includes('Zed'));
  await until(async () => (await a.get('/api/status')).json.players.includes('Zed'), 15000);
  // ein selbst getippter Befehl bleibt im Log sichtbar
  await a.post('/api/server/command', { cmd: 'list' });
  await until(async () => (await a.get('/api/log')).json.lines.some((l) => /There are \d+ of a max/.test(l)), 10000);
});

test('Vanilla-Verhalten: Rückfall auf „tick query“, keine „Unknown command“-Zeilen im Log', { timeout: 60000 }, async () => {
  const { a } = await running({ FAKE_MC_FLAVOR: 'vanilla' });
  const s = await until(async () => { const j = (await a.get('/api/status')).json; return j.mspt != null ? j : null; });
  assert.equal(s.tpsSupported, true);
  assert.ok(Math.abs(s.mspt - 12.3) < 0.01);
  assert.equal(s.tps, 20);
  await new Promise((r) => setTimeout(r, 4000));
  const log = (await a.get('/api/log')).json.lines.join('\n');
  assert.doesNotMatch(log, /Unknown or incomplete|<--\[HERE\]|Average time per tick/);
});
