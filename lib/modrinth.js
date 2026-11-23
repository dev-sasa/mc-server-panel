'use strict';
// Mods und Plugins über die Modrinth-API suchen und installieren (https://docs.modrinth.com/api/)
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { httpError } = require('./core');

const API = (process.env.MCPANEL_MODRINTH_API || 'https://api.modrinth.com/v2').replace(/\/+$/, ''); // nur für Tests überschreibbar
const UA = { 'User-Agent': 'MCServerPanel/1.0 (self-hosted panel)' };
const MAX_FILE = 300 * 1024 * 1024;
const ID_RE = /^[\w-]{1,64}$/;

// Server-Software -> Ordner und passende Modrinth-Loader (ein Paper-Server lädt auch Spigot- und Bukkit-Plugins)
const SOFTWARE = {
  paper: { label: 'Paper', dir: 'plugins', loaders: ['paper', 'spigot', 'bukkit'] },
  purpur: { label: 'Purpur', dir: 'plugins', loaders: ['purpur', 'paper', 'spigot', 'bukkit'] },
  folia: { label: 'Folia', dir: 'plugins', loaders: ['folia'] },
  spigot: { label: 'Spigot', dir: 'plugins', loaders: ['spigot', 'bukkit'] },
  fabric: { label: 'Fabric', dir: 'mods', loaders: ['fabric'] },
  quilt: { label: 'Quilt', dir: 'mods', loaders: ['quilt', 'fabric'] },
  forge: { label: 'Forge', dir: 'mods', loaders: ['forge'] },
  neoforge: { label: 'NeoForge', dir: 'mods', loaders: ['neoforge'] },
};

async function call(pathname, opts = {}) {
  let r;
  try { r = await fetch(API + pathname, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) }); }
  catch { throw httpError(502, 'Modrinth ist gerade nicht erreichbar.'); }
  if (r.status === 404) throw httpError(404, 'Nicht bei Modrinth gefunden');
  if (r.status === 429) throw httpError(429, 'Modrinth bremst gerade (zu viele Anfragen) – bitte kurz warten.');
  if (!r.ok) throw httpError(502, `Modrinth antwortet mit Fehler ${r.status}`);
  return r.json();
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');
const checkId = (id) => { if (!ID_RE.test(String(id || ''))) throw httpError(400, 'Ungültige Projekt- oder Versions-ID'); return String(id); };

async function search({ query, sw, version, offset = 0, env = 'server' }) {
  const facets = [['project_type:mod', 'project_type:plugin'], SOFTWARE[sw].loaders.map((l) => 'categories:' + l)];
  if (version) facets.push(['versions:' + version]);
  // Umgebung: „server“ = läuft auf dem Server (benötigt oder optional), „client“ = nur für Spieler-Rechner, „all“ = egal
  if (env === 'server') facets.push(['server_side:required', 'server_side:optional']);
  else if (env === 'client') facets.push(['server_side:unsupported']);
  const j = await call('/search?' + q({ query: String(query || '').slice(0, 100), facets, limit: 20, offset: Math.max(0, parseInt(offset, 10) || 0), index: query ? 'relevance' : 'downloads' }));
  return {
    total: j.total_hits || 0,
    hits: (j.hits || []).map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || '', author: h.author, downloads: h.downloads, type: h.project_type || 'mod', server: h.server_side || '', client: h.client_side || '', categories: h.display_categories || [] })),
  };
}
/** Passende Versionen eines Projekts (neueste zuerst, Releases vor Beta/Alpha). */
async function versions(projectId, sw, version) {
  const list = await call(`/project/${checkId(projectId)}/version?` + q({ loaders: SOFTWARE[sw].loaders, game_versions: version ? [version] : undefined }));
  const rank = { release: 0, beta: 1, alpha: 2 };
  return list.filter((v) => (v.files || []).length).sort((a, b) => (rank[a.version_type] - rank[b.version_type]) || (new Date(b.date_published) - new Date(a.date_published)));
}
const getVersion = (id) => call('/version/' + checkId(id));
const getProject = (id) => call('/project/' + checkId(id));
const primaryFile = (v) => v.files.find((f) => f.primary) || v.files[0];

const cdnOk = (u) => { try { const x = new URL(u); return (x.protocol === 'https:' && x.hostname === 'cdn.modrinth.com') || (process.env.MCPANEL_MODRINTH_API && u.startsWith(new URL(API).origin + '/')); } catch { return false; } };
const fileNameOk = (n) => /^[\w.+() -]{1,150}\.jar$/.test(n) && !n.startsWith('.');

/** Lädt eine Datei, prüft Größe und SHA-512 und legt sie erst bei Erfolg am Ziel ab. */
async function download(file, destDir) {
  if (!fileNameOk(file.filename)) throw httpError(502, 'Unerwarteter Dateiname von Modrinth: ' + String(file.filename).slice(0, 80));
  if (!cdnOk(file.url)) throw httpError(502, 'Der Download liegt nicht bei Modrinth – abgebrochen.');
  if (file.size && file.size > MAX_FILE) throw httpError(413, 'Die Datei ist größer als 300 MB.');
  await fsp.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, file.filename), tmp = dest + '.part';
  const r = await fetch(file.url, { headers: UA, signal: AbortSignal.timeout(10 * 60000) }).catch(() => { throw httpError(502, 'Download fehlgeschlagen'); });
  if (!r.ok) throw httpError(502, 'Download fehlgeschlagen (' + r.status + ')');
  const hash = crypto.createHash('sha512');
  let n = 0;
  const out = fs.createWriteStream(tmp);
  try {
    for await (const chunk of r.body) {
      n += chunk.length;
      if (n > MAX_FILE) throw httpError(413, 'Die Datei ist größer als 300 MB.');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    const got = hash.digest('hex');
    if (file.hashes && file.hashes.sha512 && got !== file.hashes.sha512) throw httpError(502, 'Die heruntergeladene Datei stimmt nicht mit der Prüfsumme von Modrinth überein – verworfen.');
    await fsp.rename(tmp, dest);
    return { dest, sha512: got, size: n };
  } catch (e) { out.destroy(); await fsp.rm(tmp, { force: true }); throw e; }
}
const sha512File = (f) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha512');
  fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const latestFor = (hashes, sw, version) => call('/version_files/update', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ hashes, algorithm: 'sha512', loaders: SOFTWARE[sw].loaders, game_versions: version ? [version] : undefined }),
});

module.exports = { SOFTWARE, search, versions, getVersion, getProject, primaryFile, download, sha512File, latestFor, checkId };
