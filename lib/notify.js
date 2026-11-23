'use strict';
// Benachrichtigungen per Discord-Webhook (Server gestartet/gestoppt/abgestürzt, Backups, Lag, Spieler)
const { UA, config } = require('./core');

const DISCORD_ID_RE = /^\d{15,25}$/;
let personalSink = () => {}; // wird vom Minecraft-Modul gesetzt: (Benutzernamen, Nachricht) -> Hinweis im Panel
const setPersonalSink = (fn) => { personalSink = fn; };
/** Benutzer, die dieses Ereignis in ihren Einstellungen angehakt haben. channel: 'panel' | 'discord' */
function subscribers(event, channel) {
  return config.users.filter((u) => { const n = u.prefs && u.prefs.notify; return n && n[channel] && n.events && n.events[event]; });
}

// Nur echte Discord-Webhook-Adressen sind erlaubt (kein Missbrauch als Weiterleitung an beliebige Server).
const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[\w-]{20,200}$/;
const TEST_BASE = process.env.MCPANEL_TEST_WEBHOOK || '';
const API_BASE = TEST_BASE ? TEST_BASE + '/api/v10' : 'https://discord.com/api/v10';
const BOT_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/; // nur für die automatischen Tests (lokaler Mock)
const validUrl = (u) => HOOK_RE.test(u) || (!!TEST_BASE && String(u).startsWith(TEST_BASE + '/api/webhooks/'));

const EVENTS = {
  start: 'Server ist online',
  stop: 'Server wurde gestoppt',
  crash: 'Server abgestürzt',
  backup: 'Backup erstellt',
  backupFail: 'Backup fehlgeschlagen',
  lag: 'Server ruckelt (niedrige TPS)',
  join: 'Spieler betritt oder verlässt den Server',
};
const DEFAULT_EVENTS = { start: true, stop: true, crash: true, backup: false, backupFail: true, lag: true, join: false };
const COLOR = { ok: 0x57f287, bad: 0xed4245, info: 0x5865f2, warn: 0xfee75c };

const last = new Map(); // Ereignis -> Zeitpunkt (gegen Flut)
let chain = Promise.resolve();

// Discord verlangt einen erkennbaren User-Agent der Form „DiscordBot (Adresse, Version)“, sonst antwortet es teils mit 403
const DUA = { 'User-Agent': 'DiscordBot (MCServerPanel, 1.0)' };
const CODE_HINT = {
  50007: 'Der Benutzer erlaubt keine Direktnachrichten von diesem Bot. Er muss mit dem Bot einen Server teilen und in den Datenschutz-Einstellungen dieses Servers „Direktnachrichten von Servermitgliedern“ erlauben.',
  50001: 'Dem Bot fehlt der Zugriff.', 50013: 'Dem Bot fehlen Rechte.', 10015: 'Der Webhook existiert nicht mehr (gelöscht?). Bitte einen neuen anlegen.',
  10013: 'Dieser Discord-Benutzer existiert nicht (Discord-ID prüfen).', 40333: 'Discord hat die Anfrage abgelehnt (interner Fehler), bitte später noch einmal versuchen.',
};
async function discordError(r) {
  const j = await r.json().catch(() => ({}));
  const hint = CODE_HINT[j.code] || (r.status === 401 ? 'Token ungültig.' : r.status === 429 ? 'Discord bremst gerade, bitte kurz warten.' : j.message || '');
  return new Error(`Discord antwortet mit ${r.status}${j.code ? ' (Code ' + j.code + ')' : ''}${hint ? ': ' + hint : ''}`);
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { ...DUA, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!r.ok && r.status !== 204) throw await discordError(r);
}
const embed = (title, text, color, fields) => ({
  username: 'MC Server Panel',
  embeds: [{ title, description: text || undefined, color: COLOR[color] || COLOR.info, timestamp: new Date().toISOString(), fields: fields || undefined, footer: { text: 'MC Server Panel' } }],
});

/** Sendet eine Nachricht, wenn Webhooks an sind und das Ereignis gewünscht ist. Fehler werden nur protokolliert, nie geworfen. */
function notify(event, title, text, color = 'info', fields) {
  const now = Date.now();
  if (event !== 'join' && now - (last.get(event) || 0) < 3000) return;
  last.set(event, now);
  // 1) persönliche Hinweise im Panel
  const panelUsers = subscribers(event, 'panel').map((u) => u.username);
  if (panelUsers.length) personalSink(new Set(panelUsers), { event, title, text, color });
  // 2) Direktnachricht per Bot
  if (dmReady()) {
    const body = embed(title, text, color, fields);
    for (const u of subscribers(event, 'dm')) {
      if (!DISCORD_ID_RE.test(u.discordId || '')) continue;
      chain = chain.then(() => sendDm(u.discordId, body)).catch((e) => console.error('Discord-DM:', e.message));
    }
  }
  // 3) Discord-Kanal (Webhook)
  const w = config.webhook;
  if (!w || !w.enabled || !w.url || !(w.events || {})[event]) return;
  const body = embed(title, text, color, fields);
  chain = chain.then(() => post(w.url, body)).catch((e) => console.error('Discord-Webhook:', e.message));
}
/* ---- Direktnachrichten (DM) über einen Discord-Bot ---- */
// Ein Webhook kann keine privaten Nachrichten schicken. Dafür braucht es einen Bot (nur Token, keine Dauerverbindung).
const dmChannels = new Map(); // Discord-ID -> Kanal-ID
async function botCall(path, body) {
  const r = await fetch(API_BASE + path, { method: 'POST', headers: { ...DUA, 'Content-Type': 'application/json', Authorization: 'Bot ' + config.webhook.botToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw await discordError(r);
  return r.json().catch(() => ({}));
}
async function sendDm(discordId, payload) {
  if (!config.webhook.botToken) throw new Error('Kein Bot-Token eingetragen');
  let ch = dmChannels.get(discordId);
  if (!ch) { ch = (await botCall('/users/@me/channels', { recipient_id: discordId })).id; dmChannels.set(discordId, ch); }
  await botCall(`/channels/${ch}/messages`, { embeds: payload.embeds });
}
const dmReady = () => !!(config.webhook && config.webhook.botToken);

/** Für die Schaltfläche „Test“: wirft Fehler, damit die Oberfläche sie anzeigen kann. */
const sendTest = (url) => post(url, embed('Test erfolgreich', 'Das Panel kann Nachrichten an diesen Discord-Kanal senden.', 'ok'));

module.exports = { BOT_RE, dmReady, sendDm, embed, setPersonalSink, HOOK_RE, validUrl, EVENTS, DEFAULT_EVENTS, notify, sendTest };
