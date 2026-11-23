'use strict';
// Installation von Server-Software
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { app } = require('../lib/app');
const { DEV, S, UA, audit, config, ctxOf, httpError, saveConfig, wrap } = require('../lib/core');
const { pushLog } = require('../lib/minecraft');

/* ---- Installation (Vanilla / Paper) ---- */
async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw httpError(502, `Anfrage fehlgeschlagen (${r.status}): ${url}`);
  return r.json();
}
// Unterstützte Server-Software und woher Versionen / Downloads kommen
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const firstStable = (list) => (list.find((x) => x.stable) || list[0] || {}).version;
const verKey = (v) => String(v).split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = verKey(a), y = verKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

// Forge: Minecraft-Version -> Forge-Version (empfohlene, sonst neueste); nur ab 1.17.1 (moderne Startdatei)
async function forgeMap() {
  const promos = (await getJson(FORGE_PROMOS)).promos || {};
  const latest = {}, rec = {};
  for (const [k, v] of Object.entries(promos)) {
    const m = k.match(/^(.+)-(latest|recommended)$/);
    if (!m || cmpVer(m[1], '1.17.1') < 0) continue;
    (m[2] === 'recommended' ? rec : latest)[m[1]] = v;
  }
  return { ...latest, ...rec };
}
// NeoForge: Minecraft-Version -> NeoForge-Version (neueste Release, sonst neueste Beta)
async function neoForgeMap() {
  const versions = (await getJson(NEOFORGE_VERSIONS)).versions || [];
  const best = {};
  for (const v of versions) {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-beta)?$/);
    if (!m) continue;
    const [, a, b2, c, , beta] = m;
    const mc = Number(a) >= 26 ? `${a}.${b2}${c !== '0' ? '.' + c : ''}` : `1.${a}${b2 !== '0' ? '.' + b2 : ''}`;
    const cur = best[mc];
    if (!cur || (cur.beta && !beta) || (!!cur.beta === !!beta && cmpVer(v, cur.v) > 0)) best[mc] = { v, beta: !!beta };
  }
  return Object.fromEntries(Object.entries(best).map(([mc, o]) => [mc, o.v]));
}
const mapToOptions = (map, name) => Object.keys(map).sort((a, b) => cmpVer(b, a)).map((mc) => ({ value: mc, label: `${mc} · ${name} ${map[mc]}` }));

async function listVersions(type) {
  if (type === 'paper' || type === 'folia') {
    const d = await getJson('https://fill.papermc.io/v3/projects/' + type);
    return Object.values(d.versions).flat().filter((v) => !/rc|pre/i.test(v));
  }
  if (type === 'purpur') return (await getJson('https://api.purpurmc.org/v2/purpur')).versions.slice().reverse();
  if (type === 'fabric') return (await getJson(FABRIC_META + '/game')).filter((v) => v.stable).map((v) => v.version);
  if (type === 'forge') return mapToOptions(await forgeMap(), 'Forge');
  if (type === 'neoforge') return mapToOptions(await neoForgeMap(), 'NeoForge');
  if (type === 'vanilla') return (await getJson(MOJANG_MANIFEST)).versions.filter((v) => v.type === 'release').map((v) => v.id);
  throw httpError(400, 'Unbekannter Typ');
}
// Ergebnis: Download-URL (direkt lauffähige JAR) oder { url, installer: true, argsFile } (Forge/NeoForge brauchen ein Installationsprogramm)
async function resolveDownload(type, version) {
  if (type === 'paper' || type === 'folia') {
    const b = await getJson(`https://fill.papermc.io/v3/projects/${type}/versions/${version}/builds/latest`);
    return b.downloads && b.downloads['server:default'] && b.downloads['server:default'].url;
  }
  if (type === 'purpur') {
    const d = await getJson(`https://api.purpurmc.org/v2/purpur/${version}`);
    return d.builds && d.builds.latest ? `https://api.purpurmc.org/v2/purpur/${version}/${d.builds.latest}/download` : null;
  }
  if (type === 'fabric') { // Fabric-Server-Launcher: lädt beim ersten Start Minecraft und Bibliotheken nach
    const [loaders, installers] = await Promise.all([getJson(FABRIC_META + '/loader'), getJson(FABRIC_META + '/installer')]);
    return `${FABRIC_META}/loader/${version}/${firstStable(loaders)}/${firstStable(installers)}/server/jar`;
  }
  if (type === 'forge') {
    const fv = (await forgeMap())[version];
    if (!fv) return null;
    return { installer: true, url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${fv}/forge-${version}-${fv}-installer.jar`, argsFile: `libraries/net/minecraftforge/forge/${version}-${fv}/unix_args.txt` };
  }
  if (type === 'neoforge') {
    const nv = (await neoForgeMap())[version];
    if (!nv) return null;
    return { installer: true, url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${nv}/neoforge-${nv}-installer.jar`, argsFile: `libraries/net/neoforged/neoforge/${nv}/unix_args.txt` };
  }
  if (type === 'vanilla') {
    const m = await getJson(MOJANG_MANIFEST);
    const v = m.versions.find((x) => x.id === version);
    if (!v) throw httpError(404, 'Version nicht gefunden');
    const j = await getJson(v.url);
    return j.downloads && j.downloads.server && j.downloads.server.url;
  }
  throw httpError(400, 'Unbekannter Typ');
}
async function downloadTo(url, dest) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw httpError(502, 'Download fehlgeschlagen (' + r.status + ')');
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
}
// Installationsprogramm (Forge/NeoForge) ausführen; Ausgabe landet live in der Konsole
function runInstaller(installerJar) {
  return new Promise((resolve, reject) => {
    const tail = [];
    const child = spawn(config.javaPath, ['-jar', path.basename(installerJar), '--installServer'], { cwd: config.serverDir });
    const feed = (stream) => {
      let buf = '';
      stream.on('data', (d) => { buf += d.toString('utf8'); const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach((l) => { if (l.trim()) { tail.push(l); if (tail.length > 12) tail.shift(); pushLog('[Installer] ' + l); } }); });
    };
    feed(child.stdout); feed(child.stderr);
    child.on('error', (e) => reject(httpError(500, `Java konnte nicht gestartet werden: ${e.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(httpError(500, `Das Installationsprogramm ist fehlgeschlagen (Code ${code}). Letzte Ausgabe: ${tail.slice(-4).join(' | ')}`))));
  });
}
app.get('/api/versions', wrap(async (req, res) => res.json({ versions: await listVersions(req.query.type) })));
app.post('/api/install', wrap(async (req, res) => {
  const { type, version } = req.body;
  if (S.proc) throw httpError(409, 'Bitte zuerst den Server stoppen');
  if (S.installBusy) throw httpError(409, 'Es läuft bereits eine Installation');
  if (!/^[\w.\-]+$/.test(version || '')) throw httpError(400, 'Ungültige Version');
  const target = await resolveDownload(type, version);
  if (!target) throw httpError(404, 'Kein Server-Download für diese Version');
  S.installBusy = true;
  try {
    if (target.installer) {
      const installerJar = path.join(config.serverDir, `.installer-${type}.jar`);
      pushLog(`[Panel] Lade ${type}-Installer für ${version} …`);
      await downloadTo(target.url, installerJar);
      if (DEV) { // Dev-Modus: ohne Java nur simulieren
        pushLog('[Installer] DEV-MODUS: Installationsprogramm wird nicht ausgeführt (nur simuliert).');
        await fsp.mkdir(path.dirname(path.join(config.serverDir, target.argsFile)), { recursive: true });
        await fsp.writeFile(path.join(config.serverDir, target.argsFile), '# dev-simulation\n');
      } else {
        pushLog(`[Panel] Führe das ${type}-Installationsprogramm aus – das dauert ein bis drei Minuten …`);
        try { await runInstaller(installerJar); } finally { await fsp.rm(installerJar, { force: true }); }
      }
      if (DEV) await fsp.rm(installerJar, { force: true });
      if (!fs.existsSync(path.join(config.serverDir, target.argsFile))) throw httpError(500, 'Das Installationsprogramm lief, hat aber keine Startdatei erzeugt (passt die Java-Version?).');
      config.launchArgsFile = target.argsFile;
      config.serverType = type; config.serverVersion = version;
      saveConfig();
      pushLog(`[Panel] ${type} ${version} installiert.`);
      audit(ctxOf(req), 'install', `${type} ${version}`);
      return res.json({ ok: true });
    }
    const url = target;
    config.launchArgsFile = ''; // zurück zum normalen Start mit -jar
    config.serverType = type; config.serverVersion = version;
    saveConfig();

  const dest = path.join(config.serverDir, config.jarFile);
  const tmp = dest + '.part';
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw httpError(502, 'Download fehlgeschlagen (' + r.status + ')');
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, dest);
  pushLog(`[Panel] ${type} ${version} installiert (${config.jarFile}).`);
  audit(ctxOf(req), 'install', `${type} ${version}`);
  res.json({ ok: true });
  } finally { S.installBusy = false; }
}));
