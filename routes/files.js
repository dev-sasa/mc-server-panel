'use strict';
// Dateimanager
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { app } = require('../lib/app');
const { audit, config, ctxOf, httpError, run, safePath, wrap } = require('../lib/core');

/* ---- Dateien ---- */
const upload = multer({ dest: path.join(os.tmpdir(), 'mcpanel-uploads'), limits: { fileSize: 4 * 1024 ** 3 } });

app.get('/api/files', wrap(async (req, res) => {
  const dir = await safePath(req.query.path || '');
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch((e) => {
    throw httpError(e.code === 'ENOENT' ? 404 : 400, 'Ordner nicht lesbar');
  });
  const items = await Promise.all(entries.map(async (e) => {
    const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
    return { name: e.name, dir: e.isDirectory() || !!(st && st.isDirectory()), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
  }));
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  res.json({ items });
}));
app.get('/api/file', wrap(async (req, res) => {
  const p = await safePath(req.query.path);
  const st = await fsp.stat(p).catch((e) => { throw httpError(e.code === 'ENOENT' ? 404 : 400, 'Datei nicht gefunden'); });
  if (!st.isFile()) throw httpError(400, 'Keine Datei');
  if (st.size > 2 * 1024 * 1024) throw httpError(413, 'Datei zu groß zum Bearbeiten (max. 2 MB) – bitte herunterladen.');
  const buf = await fsp.readFile(p);
  if (buf.includes(0)) throw httpError(415, 'Binärdatei – kann nicht bearbeitet werden.');
  res.json({ content: buf.toString('utf8') });
}));
app.put('/api/file', wrap(async (req, res) => {
  const p = await safePath(req.body.path);
  if (typeof req.body.content !== 'string') throw httpError(400, 'Inhalt fehlt');
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, req.body.content);
  audit(ctxOf(req), 'file_save', '/' + req.body.path);
  res.json({ ok: true });
}));
app.delete('/api/file', wrap(async (req, res) => {
  const p = await safePath(req.query.path);
  if (p === path.resolve(config.serverDir)) throw httpError(400, 'Server-Ordner kann nicht gelöscht werden');
  await fsp.rm(p, { recursive: true, force: true });
  audit(ctxOf(req), 'file_delete', '/' + req.query.path);
  res.json({ ok: true });
}));
app.post('/api/mkdir', wrap(async (req, res) => {
  await fsp.mkdir(await safePath(req.body.path), { recursive: true });
  audit(ctxOf(req), 'file_mkdir', '/' + req.body.path);
  res.json({ ok: true });
}));
app.post('/api/rename', wrap(async (req, res) => {
  const from = await safePath(req.body.from);
  const to = await safePath(req.body.to);
  if (fs.existsSync(to)) throw httpError(409, 'Ziel existiert bereits');
  await fsp.rename(from, to);
  audit(ctxOf(req), 'file_rename', `/${req.body.from} → /${req.body.to}`);
  res.json({ ok: true });
}));
app.get('/api/download', wrap(async (req, res) => {
  const p = await safePath(req.query.path);
  const st = await fsp.stat(p);
  if (!st.isFile()) throw httpError(400, 'Keine Datei');
  res.download(p);
}));
app.post('/api/upload', upload.array('files', 50), wrap(async (req, res) => {
  const dir = await safePath(req.query.path || '');
  await fsp.mkdir(dir, { recursive: true });
  for (const f of req.files) {
    const target = path.join(dir, path.basename(f.originalname));
    try { await fsp.rename(f.path, target); }
    catch { await fsp.copyFile(f.path, target); await fsp.unlink(f.path); }
  }
  audit(ctxOf(req), 'file_upload', `${req.files.map((f) => path.basename(f.originalname)).join(', ')} → /${req.query.path || ''}`);
  res.json({ ok: true, count: req.files.length });
}));

/* ---- Mehrfachauswahl: löschen, als Archiv laden, Archive entpacken ---- */
const cleanNames = (v) => {
  const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
  if (!list.length) throw httpError(400, 'Nichts ausgewählt');
  if (list.length > 500) throw httpError(400, 'Zu viele Einträge auf einmal (höchstens 500)');
  for (const n of list) if (!n || n === '.' || n === '..' || /[\/\\\0]/.test(n)) throw httpError(400, 'Ungültiger Name: ' + n);
  return [...new Set(list)];
};
app.post('/api/files/delete', wrap(async (req, res) => {
  const dir = req.body.path || '';
  const names = cleanNames(req.body.names);
  const root = path.resolve(config.serverDir);
  let n = 0;
  for (const name of names) {
    const p = await safePath(path.posix.join(dir, name));
    if (p === root) continue;
    await fsp.rm(p, { recursive: true, force: true });
    n++;
  }
  audit(ctxOf(req), 'file_delete', `${n} Einträge in /${dir}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' …' : ''}`);
  res.json({ ok: true, count: n });
}));
// Auswahl als .tar.gz herunterladen (wird direkt gestreamt, es entsteht keine Zwischendatei)
app.get('/api/files/archive', wrap(async (req, res) => {
  const dir = await safePath(req.query.path || '');
  const names = cleanNames(req.query.name);
  for (const n of names) { await safePath(path.posix.join(req.query.path || '', n)); if (!fs.existsSync(path.join(dir, n))) throw httpError(404, 'Nicht gefunden: ' + n); }
  const label = names.length === 1 ? names[0] : (path.basename(dir) || 'server');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${label.replace(/[^\w.-]+/g, '_')}.tar.gz"`);
  const child = spawn('tar', ['-czf', '-', '-C', dir, '--', ...names], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.pipe(res);
  child.on('error', () => res.destroy());
  res.on('close', () => { if (child.exitCode === null) child.kill(); });
  audit(ctxOf(req), 'file_archive', `${names.length} Einträge aus /${req.query.path || ''}`);
}));

const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i;
const lines = (s) => s.split('\n').filter(Boolean);
const unsafeEntry = (n) => n.startsWith('/') || n.split('/').includes('..') || /\0/.test(n);
app.post('/api/files/extract', wrap(async (req, res) => {
  const file = await safePath(req.body.path);
  if (!ARCHIVE_RE.test(file)) throw httpError(400, 'Nur .zip, .tar.gz, .tgz und .tar können entpackt werden');
  if (!(await fsp.stat(file).catch(() => null))?.isFile()) throw httpError(404, 'Archiv nicht gefunden');
  const destRel = req.body.to !== undefined ? String(req.body.to) : path.posix.dirname(String(req.body.path));
  const dest = await safePath(destRel === '.' ? '' : destRel);
  await fsp.mkdir(dest, { recursive: true });
  const isZip = /\.zip$/i.test(file);
  try {
    if (isZip) {
      // Vorher prüfen: keine Pfade nach draußen, keine Verknüpfungen (Symlinks)
      const names = lines(await run('unzip', ['-Z1', file]));
      if (names.length > 100000) throw httpError(400, 'Das Archiv enthält zu viele Dateien');
      if (names.some(unsafeEntry)) throw httpError(400, 'Das Archiv enthält unsichere Pfade und wird nicht entpackt');
      if (lines(await run('unzip', ['-Z', file])).some((l) => /^l/.test(l))) throw httpError(400, 'Das Archiv enthält Verknüpfungen (Symlinks) und wird aus Sicherheitsgründen nicht entpackt');
      await run('unzip', ['-o', '-q', file, '-d', dest]);
    } else {
      const names = lines(await run('tar', ['-tf', file]));
      if (names.length > 100000) throw httpError(400, 'Das Archiv enthält zu viele Dateien');
      if (names.some(unsafeEntry)) throw httpError(400, 'Das Archiv enthält unsichere Pfade und wird nicht entpackt');
      if (lines(await run('tar', ['-tvf', file])).some((l) => /^[lh]/.test(l))) throw httpError(400, 'Das Archiv enthält Verknüpfungen (Symlinks) und wird aus Sicherheitsgründen nicht entpackt');
      await run('tar', ['-xf', file, '-C', dest, '--no-same-owner']);
    }
  } catch (e) {
    if (e.status) throw e;
    if (e.code === 'ENOENT' || /ENOENT/.test(e.message)) throw httpError(501, `Dafür fehlt das Programm „${isZip ? 'unzip' : 'tar'}“ auf dem Server (zum Beispiel: sudo apt install unzip).`);
    throw httpError(500, 'Entpacken fehlgeschlagen: ' + String(e.message).trim().split('\n')[0]);
  }
  audit(ctxOf(req), 'file_extract', `/${req.body.path} → /${destRel === '.' ? '' : destRel}`);
  res.json({ ok: true });
}));
