'use strict';
// Mojang-/Bedrock-Abgleich
const { httpError } = require('./core');

/* ---- Mojang-Abgleich: gibt es den Spieler wirklich? ---- */
const mojangCache = new Map(); // name(lower) -> { t, data }
async function lookupMojang(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { status: 'invalid' };
  const key = name.toLowerCase();
  const hit = mojangCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;
  let data;
  try {
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/lookup/name/' + name, { headers: UA, signal: AbortSignal.timeout(6000) });
    if (r.status === 404 || r.status === 204) data = { status: 'notfound' };
    else if (r.ok) { const j = await r.json(); data = { status: 'found', name: j.name, uuid: j.id }; }
    else data = { status: 'unavailable' };
  } catch { data = { status: 'unavailable' }; }
  if (data.status !== 'unavailable') {
    if (mojangCache.size > 500) mojangCache.clear();
    mojangCache.set(key, { t: Date.now(), data });
  }
  return data;
}

/* ---- Bedrock-Abgleich (Xbox-Gamertag -> XUID über die GeyserMC-API) ---- */
const bedrockCache = new Map();
async function lookupBedrock(name) {
  if (!/^[A-Za-z0-9_ ]{1,16}$/.test(name)) return { status: 'invalid' };
  const key = name.toLowerCase();
  const hit = bedrockCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;
  let data;
  try {
    const r = await fetch('https://api.geysermc.org/v2/xbox/xuid/' + encodeURIComponent(name), { headers: UA, signal: AbortSignal.timeout(6000) });
    if (r.ok) { const j = await r.json(); data = { status: 'found', xuid: String(j.xuid) }; }
    else if ([400, 404, 503].includes(r.status)) data = { status: 'notfound' }; // der Dienst meldet „nicht im Cache“ auch für unbekannte Namen
    else data = { status: 'unavailable' };
  } catch { data = { status: 'unavailable' }; }
  if (data.status !== 'unavailable') {
    if (bedrockCache.size > 500) bedrockCache.clear();
    bedrockCache.set(key, { t: Date.now(), data });
  }
  return data;
}

// Minecraft-Name -> { name, uuid } (geprüft bei Mojang); leer = Verknüpfung entfernen (null)
async function resolveMinecraft(raw) {
  const name = String(raw || '').trim();
  if (!name) return null;
  const r = await lookupMojang(name);
  if (r.status === 'invalid') throw httpError(400, 'Ungültiger Minecraft-Name (3–16 Zeichen: Buchstaben, Ziffern, _)');
  if (r.status === 'notfound') throw httpError(404, 'Diesen Minecraft-Account gibt es nicht');
  if (r.status !== 'found') throw httpError(503, 'Mojang ist gerade nicht erreichbar – bitte später erneut versuchen');
  return { name: r.name, uuid: r.uuid };
}
function setMinecraft(u, mc) { if (mc) u.minecraft = mc; else delete u.minecraft; }

module.exports = { lookupBedrock, lookupMojang, resolveMinecraft, setMinecraft };
