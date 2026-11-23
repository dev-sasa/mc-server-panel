'use strict';
// Spielerverwaltung
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('../lib/app');
const { audit, config, ctxOf, httpError, wrap } = require('../lib/core');
const { players, sendCommand } = require('../lib/minecraft');
const { lookupBedrock, lookupMojang } = require('../lib/mojang');
const { allPlayers, history } = require('../lib/playerStats');

/* ---- Spieler ---- */
async function readJson(name) {
  try { return JSON.parse(await fsp.readFile(path.join(config.serverDir, name), 'utf8')); } catch { return []; }
}
app.get('/api/players', wrap(async (req, res) => {
  res.json({
    online: [...players],
    whitelist: await readJson('whitelist.json'),
    ops: await readJson('ops.json'),
    banned: await readJson('banned-players.json'),
    bannedIps: await readJson('banned-ips.json'),
  });
}));
// Alle bekannten Spieler mit Spielzeit, letztem Besuch usw. – auch rückwirkend aus den Daten, die der Server schon hat
app.get('/api/players/stats', wrap(async (req, res) => {
  const flags = { whitelist: await readJson('whitelist.json'), ops: await readJson('ops.json'), banned: await readJson('banned-players.json') };
  const r = await allPlayers([...players], flags);
  const has = (list, n) => list.some((p) => (p.name || '').toLowerCase() === n.toLowerCase());
  r.players = r.players.map((p) => ({ ...p, whitelisted: has(flags.whitelist, p.name), op: has(flags.ops, p.name), banned: has(flags.banned, p.name) }));
  res.json(r);
}));
app.get('/api/players/history', wrap(async (req, res) => {
  const name = String(req.query.name || '');
  if (!/^[\w.]{1,32}$/.test(name)) throw httpError(400, 'Ungültiger Spielername');
  res.json({ events: await history(name) });
}));
app.post('/api/players/action', wrap(async (req, res) => {
  const { action, name, reason } = req.body;
  const isIp = action === 'ban-ip' || action === 'pardon-ip';
  const isF = action === 'fwhitelist-add' || action === 'fwhitelist-remove'; // Bedrock-Spieler über Floodgate
  const fname = isF ? String(name || '').replace(/^\./, '').trim() : name;
  if (isF && !/^([A-Za-z0-9_ ]{1,16}|\d{15,20})$/.test(fname)) throw httpError(400, 'Ungültiger Bedrock-Name (Gamertag, max. 16 Zeichen: Buchstaben, Ziffern, _ und Leerzeichen)');
  if (!isIp && !isF && !/^[A-Za-z0-9_.]{1,16}$/.test(name || '')) throw httpError(400, 'Ungültiger Spielername');
  if (isIp && !/^[0-9a-fA-F:.]{3,45}$/.test(name || '')) throw httpError(400, 'Ungültige IP');
  const map = {
    'whitelist-add': `whitelist add ${name}`,
    'whitelist-remove': `whitelist remove ${name}`,
    'fwhitelist-add': `fwhitelist add ${fname}`,
    'fwhitelist-remove': `fwhitelist remove ${fname}`,
    op: `op ${name}`,
    deop: `deop ${name}`,
    kick: `kick ${name} ${reason || ''}`,
    ban: `ban ${name} ${reason || ''}`,
    pardon: `pardon ${name}`,
    'ban-ip': `ban-ip ${name} ${reason || ''}`,
    'pardon-ip': `pardon-ip ${name}`,
  };
  if (!map[action]) throw httpError(400, 'Unbekannte Aktion');
  sendCommand(map[action]);
  audit(ctxOf(req), 'player_' + action.replace(/-/g, '_'), (isF ? fname : name) + (reason ? ` – ${reason}` : ''));
  res.json({ ok: true });
}));


app.get('/api/mojang/:name', wrap(async (req, res) => res.json(await lookupMojang(req.params.name))));
app.get('/api/bedrock/:name', wrap(async (req, res) => res.json(await lookupBedrock(req.params.name))));
