'use strict';
// Discord-Einstellungen, server.properties, EULA
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('../lib/app');
const { BOT_RE, EVENTS, sendTest, validUrl } = require('../lib/notify');
const { S, audit, config, ctxOf, dc, envDiscord, httpError, parseProps, saveConfig, wrap } = require('../lib/core');

/* ---- Discord-Einstellungen ---- */
app.get('/api/discord', (req, res) => {
  const d = dc();
  res.json({
    fromEnv: Object.keys(envDiscord).length > 0,
    enabled: d.enabled, clientId: d.clientId, hasSecret: !!d.clientSecret, redirectUri: d.redirectUri,
    suggestedRedirect: `${req.protocol}://${req.headers.host}/auth/discord/callback`,
  });
});
app.put('/api/discord', wrap(async (req, res) => {
  if (Object.keys(envDiscord).length) throw httpError(400, 'Discord ist über die .env-Datei konfiguriert – dort ändern und Panel neu starten.');
  const b = req.body, d = config.discord;
  if (b.clientId !== undefined && b.clientId && !/^\d{15,25}$/.test(String(b.clientId).trim())) throw httpError(400, 'Client-ID besteht nur aus Ziffern');
  if (b.redirectUri && !/^https?:\/\/[^\s]+$/.test(b.redirectUri)) throw httpError(400, 'Ungültige Redirect-URI');
  d.clientId = String(b.clientId || '').trim();
  d.redirectUri = String(b.redirectUri || '').trim();
  if (b.clientSecret) d.clientSecret = String(b.clientSecret).trim(); // leer = unverändert
  d.enabled = !!b.enabled;
  if (d.enabled && (!d.clientId || !d.clientSecret)) { d.enabled = false; saveConfig(); throw httpError(400, 'Zum Aktivieren Client-ID und Client-Secret angeben'); }
  saveConfig();
  audit(ctxOf(req), 'discord_config', d.enabled ? 'aktiviert' : 'deaktiviert');
  res.json({ ok: true });
}));

/* ---- Discord-Benachrichtigungen (Webhook) ---- */
// Die Webhook-Adresse ist ein Geheimnis (wer sie kennt, kann in den Kanal schreiben): sie wird nie zurückgegeben.
app.get('/api/webhook', (req, res) => {
  const w = config.webhook;
  res.json({ enabled: w.enabled, hasBot: !!w.botToken, botFromEnv: !!process.env.DISCORD_BOT_TOKEN, hasUrl: !!w.url, urlHint: w.url ? '…' + w.url.slice(-6) : '', fromEnv: !!process.env.DISCORD_WEBHOOK_URL, events: w.events, labels: EVENTS });
});
app.put('/api/webhook', wrap(async (req, res) => {
  if (process.env.DISCORD_WEBHOOK_URL) throw httpError(400, 'Der Webhook ist über die .env-Datei konfiguriert – dort ändern und Panel neu starten.');
  const b = req.body, w = config.webhook;
  if (b.url !== undefined && b.url !== '') {
    const u = String(b.url).trim();
    if (!validUrl(u)) throw httpError(400, 'Das ist keine Discord-Webhook-Adresse (https://discord.com/api/webhooks/…)');
    w.url = u;
  }
  if (b.removeUrl) w.url = '';
  if (!process.env.DISCORD_BOT_TOKEN) {
    if (b.botToken) {
      const bt = String(b.botToken).trim();
      if (!BOT_RE.test(bt)) throw httpError(400, 'Das sieht nicht wie ein Discord-Bot-Token aus.');
      w.botToken = bt;
    }
    if (b.removeBot) w.botToken = '';
  }
  const ev = {};
  for (const k of Object.keys(EVENTS)) ev[k] = b.events && k in b.events ? !!b.events[k] : !!w.events[k];
  w.events = ev;
  w.enabled = !!b.enabled;
  if (w.enabled && !w.url) { w.enabled = false; saveConfig(); throw httpError(400, 'Zum Aktivieren eine Webhook-Adresse eintragen'); }
  saveConfig();
  audit(ctxOf(req), 'webhook_config', w.enabled ? 'aktiviert: ' + Object.keys(ev).filter((k) => ev[k]).join(', ') : 'deaktiviert');
  res.json({ ok: true });
}));
app.post('/api/webhook/test', wrap(async (req, res) => {
  const u = req.body.url ? String(req.body.url).trim() : config.webhook.url;
  if (!u) throw httpError(400, 'Keine Webhook-Adresse eingetragen');
  if (!validUrl(u)) throw httpError(400, 'Das ist keine Discord-Webhook-Adresse (https://discord.com/api/webhooks/…)');
  try { await sendTest(u); } catch (e) { throw httpError(502, 'Senden nicht möglich: ' + e.message); }
  audit(ctxOf(req), 'webhook_test', '');
  res.json({ ok: true });
}));

/* ---- server.properties ---- */
const PROPS = () => path.join(config.serverDir, 'server.properties');
app.get('/api/properties', wrap(async (req, res) => {
  try {
    res.json({ exists: true, props: parseProps(await fsp.readFile(PROPS(), 'utf8')) });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ exists: false, props: {} });
    throw e;
  }
}));
app.put('/api/properties', wrap(async (req, res) => {
  const incoming = req.body.props || {};
  let text = '';
  try { text = await fsp.readFile(PROPS(), 'utf8'); } catch {}
  const beforeProps = text ? parseProps(text) : {};
  const lines = text ? text.split(/\r?\n/) : ['#Minecraft server properties'];
  const seen = new Set();
  const clean = (v) => String(v).replace(/[\r\n]+/g, ' ');
  const result = lines.map((line) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return line;
    const i = line.indexOf('=');
    if (i < 0) return line;
    const key = line.slice(0, i).trim();
    if (key in incoming) { seen.add(key); return `${key}=${clean(incoming[key])}`; }
    return line;
  });
  while (result.length && !result[result.length - 1].trim()) result.pop();
  for (const [k, v] of Object.entries(incoming)) {
    if (!seen.has(k) && /^[\w.\-]+$/.test(k)) result.push(`${k}=${clean(v)}`);
  }
  await fsp.writeFile(PROPS(), result.join('\n').replace(/\n*$/, '\n'));
  propsCacheT = 0;
  const changed = Object.keys(incoming).filter((k) => String(beforeProps[k] ?? '') !== clean(incoming[k]))
    .map((k) => `${k}: ${beforeProps[k] ?? '–'} → ${clean(incoming[k])}`);
  audit(ctxOf(req), 'props_save', changed.join(', ') || 'keine Änderung');
  res.json({ ok: true, running: !!S.proc });
}));

/* ---- EULA ---- */
app.get('/api/eula', wrap(async (req, res) => {
  try {
    res.json({ accepted: /eula\s*=\s*true/i.test(await fsp.readFile(path.join(config.serverDir, 'eula.txt'), 'utf8')) });
  } catch { res.json({ accepted: false }); }
}));
app.post('/api/eula', wrap(async (req, res) => {
  if (!req.body.accept) throw httpError(400, 'EULA muss akzeptiert werden');
  await fsp.writeFile(
    path.join(config.serverDir, 'eula.txt'),
    '# https://aka.ms/MinecraftEULA – akzeptiert über MC Server Panel\neula=true\n'
  );
  audit(ctxOf(req), 'eula_accept');
  res.json({ ok: true });
}));
