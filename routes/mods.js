'use strict';
// Mods und Plugins: suchen, mit einem Klick installieren, aktualisieren, entfernen
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('../lib/app');
const { DATA, audit, config, ctxOf, httpError, saveConfig, wrap } = require('../lib/core');
const { pushLog } = require('../lib/minecraft');
const mr = require('../lib/modrinth');

const MANIFEST = path.join(DATA, 'mods.json'); // Welche Datei woher stammt (Projekt, Version, Abhängigkeit)
let busy = false;
const readManifest = () => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; } };
const writeManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2), { mode: 0o600 });

function ctx() {
  const sw = mr.SOFTWARE[config.serverType];
  return { key: config.serverType, sw, version: config.serverVersion || '', dir: sw ? path.join(path.resolve(config.serverDir), sw.dir) : null };
}
function need() {
  const c = ctx();
  if (!c.sw) throw httpError(400, config.serverType === 'vanilla'
    ? 'Ein Vanilla-Server kann keine Mods oder Plugins laden. Installiere Paper (Plugins) oder Fabric/Forge/NeoForge (Mods).'
    : 'Bitte zuerst die Server-Software und die Minecraft-Version angeben.');
  return c;
}

app.get('/api/mods/info', (req, res) => {
  const c = ctx();
  res.json({
    type: config.serverType || '', version: config.serverVersion || '', dir: c.sw ? c.sw.dir : '',
    software: Object.entries(mr.SOFTWARE).map(([id, s]) => ({ id, label: s.label, dir: s.dir })),
  });
});
app.put('/api/mods/info', wrap(async (req, res) => {
  const type = String(req.body.type || '');
  const version = String(req.body.version || '').trim();
  if (type && type !== 'vanilla' && !mr.SOFTWARE[type]) throw httpError(400, 'Unbekannte Server-Software');
  if (version && !/^[\w.\-]{1,40}$/.test(version)) throw httpError(400, 'Ungültige Minecraft-Version');
  config.serverType = type; config.serverVersion = version;
  saveConfig();
  audit(ctxOf(req), 'config_save', `Server-Software für Mods: ${type || '–'} ${version}`);
  res.json({ ok: true });
}));

app.get('/api/mods/search', wrap(async (req, res) => {
  const c = need();
  res.json(await mr.search({ query: req.query.q, sw: c.key, version: c.version, offset: req.query.offset, env: ['server', 'client', 'all'].includes(req.query.env) ? req.query.env : 'server' }));
}));
app.get('/api/mods/project/:id/versions', wrap(async (req, res) => {
  const c = need();
  const list = await mr.versions(req.params.id, c.key, c.version);
  res.json({ versions: list.slice(0, 30).map((v) => ({ id: v.id, number: v.version_number, name: v.name, type: v.version_type, date: v.date_published, game: (v.game_versions || []).slice(-3), file: mr.primaryFile(v).filename, size: mr.primaryFile(v).size })) });
}));

async function installOne(c, manifest, projectId, versionId, isDep, done, depth = 0) {
  if (done.has(projectId)) return;
  done.add(projectId);
  let v;
  if (versionId) v = await mr.getVersion(versionId);
  else {
    v = (await mr.versions(projectId, c.key, c.version))[0];
    if (!v) throw httpError(404, `Für ${c.sw.label}${c.version ? ' ' + c.version : ''} gibt es keine passende Version.`);
  }
  const pid = v.project_id || projectId;
  // Pflicht-Abhängigkeiten zuerst (höchstens zwei Ebenen tief, höchstens zehn Dateien)
  if (depth < 2) {
    for (const d of v.dependencies || []) {
      if (d.dependency_type !== 'required') continue;
      let dp = d.project_id;
      if (!dp && d.version_id) dp = (await mr.getVersion(d.version_id)).project_id;
      if (!dp || done.has(dp) || manifest[dp]) continue;
      if (done.size >= 10) throw httpError(400, 'Zu viele Abhängigkeiten – bitte einzeln installieren.');
      await installOne(c, manifest, dp, d.version_id || undefined, true, done, depth + 1);
    }
  }
  const file = mr.primaryFile(v);
  const old = manifest[pid];
  const target = path.join(c.dir, file.filename);
  if (fs.existsSync(target) && !(old && old.file === file.filename)) throw httpError(409, `Die Datei ${file.filename} gibt es schon (nicht über das Panel installiert) – bitte zuerst im Dateimanager löschen.`);
  const got = await mr.download(file, c.dir);
  if (old && old.file !== file.filename) await fsp.rm(path.join(c.dir, old.file), { force: true }); // alte Version ersetzen
  let title = old ? old.title : '', slug = old ? old.slug : '';
  if (!title) { try { const p = await mr.getProject(pid); title = p.title; slug = p.slug; } catch { title = v.name || file.filename; } }
  manifest[pid] = { projectId: pid, slug, title, versionId: v.id, versionNumber: v.version_number, file: file.filename, dir: c.sw.dir, dependency: old ? old.dependency && isDep : isDep, sha512: got.sha512, installedAt: Date.now() };
  done.installed.push({ projectId: pid, title, file: file.filename, version: v.version_number, dependency: isDep });
}

app.post('/api/mods/install', wrap(async (req, res) => {
  const c = need();
  if (busy) throw httpError(409, 'Es läuft schon eine Installation.');
  const projectId = mr.checkId(req.body.projectId);
  const versionId = req.body.versionId ? mr.checkId(req.body.versionId) : undefined;
  busy = true;
  try {
    const manifest = readManifest();
    const done = new Set(); done.installed = [];
    try { await installOne(c, manifest, projectId, versionId, false, done); }
    finally { writeManifest(manifest); } // auch bei Teilerfolg festhalten, was schon liegt
    for (const i of done.installed) pushLog(`[Panel] ${c.sw.dir === 'mods' ? 'Mod' : 'Plugin'} installiert: ${i.title} ${i.version}`);
    audit(ctxOf(req), 'mod_install', done.installed.map((i) => `${i.title} ${i.version}`).join(', '));
    res.json({ ok: true, installed: done.installed, note: 'Der Server lädt neue Dateien erst nach einem Neustart.' });
  } finally { busy = false; }
}));

app.get('/api/mods/installed', wrap(async (req, res) => {
  const c = need();
  const manifest = readManifest();
  const byFile = Object.fromEntries(Object.values(manifest).filter((m) => m.dir === c.sw.dir).map((m) => [m.file, m]));
  const names = await fsp.readdir(c.dir).catch(() => []);
  const items = [];
  for (const n of names.filter((x) => /\.jar$/i.test(x))) {
    const st = await fsp.stat(path.join(c.dir, n)).catch(() => null);
    if (!st || !st.isFile()) continue;
    const m = byFile[n];
    items.push({ file: n, size: st.size, mtime: st.mtimeMs, projectId: m ? m.projectId : null, title: m ? m.title : '', version: m ? m.versionNumber : '', dependency: !!(m && m.dependency) });
  }
  items.sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file));
  res.json({ dir: c.sw.dir, items });
}));
app.delete('/api/mods/installed', wrap(async (req, res) => {
  const c = need();
  const file = String(req.query.file || '');
  if (!/^[\w.+() -]{1,150}\.jar$/i.test(file)) throw httpError(400, 'Ungültiger Dateiname');
  const full = path.join(c.dir, file);
  if (!fs.existsSync(full)) throw httpError(404, 'Datei nicht gefunden');
  await fsp.rm(full, { force: true });
  const manifest = readManifest();
  for (const [k, m] of Object.entries(manifest)) if (m.file === file && m.dir === c.sw.dir) delete manifest[k];
  writeManifest(manifest);
  audit(ctxOf(req), 'mod_remove', `${c.sw.dir}/${file}`);
  res.json({ ok: true, note: 'Wirkt nach dem nächsten Neustart des Servers.' });
}));

// Gibt es neuere Versionen? (Abgleich über die Prüfsummen der installierten Dateien)
app.get('/api/mods/updates', wrap(async (req, res) => {
  const c = need();
  const manifest = readManifest();
  const mine = Object.values(manifest).filter((m) => m.dir === c.sw.dir && fs.existsSync(path.join(c.dir, m.file)));
  if (!mine.length) return res.json({ updates: [] });
  const hashes = [];
  for (const m of mine) { m.live = await mr.sha512File(path.join(c.dir, m.file)); hashes.push(m.live); }
  const latest = await mr.latestFor(hashes, c.key, c.version);
  const updates = [];
  for (const m of mine) {
    const v = latest[m.live];
    if (v && !(v.files || []).some((f) => f.hashes && f.hashes.sha512 === m.live)) updates.push({ file: m.file, title: m.title, projectId: m.projectId, versionId: v.id, from: m.versionNumber, to: v.version_number });
  }
  res.json({ updates });
}));
