'use strict';
// Backups
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('../lib/app');
const { S, audit, config, ctxOf, httpError, run, sleep, wrap } = require('../lib/core');
const { pushLog, sendCommand } = require('../lib/minecraft');
const { notify } = require('../lib/notify');
const { assertSpace, copyToTarget, diskInfo, testTarget, verifyArchive } = require('../lib/backupUtil');

const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' MB' : Math.round(n / 1024) + ' KB');
const copyState = { last: null }; // Ergebnis der letzten Kopie an den zweiten Ort

/* ---- Backups ---- */
const BACKUP_RE = /^[\w.\-]+\.tar\.gz$/;

async function createBackup(prefix = 'backup') {
  if (S.backupBusy) throw httpError(409, 'Backup läuft bereits');
  S.backupBusy = true;
  try {
    await fsp.mkdir(config.backupDir, { recursive: true });
    await assertSpace(config.serverDir, config.backupDir, fmtBytes); // vor dem Sichern: ist genug Platz da?
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `${prefix}-${stamp}.tar.gz`;
    const file = path.join(config.backupDir, name);
    const wasRunning = !!S.proc && S.state === 'running';
    if (wasRunning) { try { sendCommand('save-off'); sendCommand('save-all flush'); } catch {} await sleep(4000); }
    try {
      const base = path.resolve(config.serverDir);
      const baseName = path.basename(base);
      const excludes = (config.backupExclude || []).map((p) => `--exclude=${baseName}/${p}`);
      await run('tar', ['-czf', file, ...excludes, '-C', path.dirname(base), baseName]);
    } catch (e) {
      await fsp.unlink(file).catch(() => {}); // halbfertige Datei nicht liegen lassen
      throw e;
    } finally {
      if (wasRunning && S.proc) { try { sendCommand('save-on'); } catch {} }
    }
    try { await verifyArchive(file); } catch (e) { // ein defektes Backup ist schlimmer als keins: sofort melden und entfernen
      await fsp.unlink(file).catch(() => {});
      throw httpError(500, `Backup ${name} ist beim Prüfen durchgefallen und wurde verworfen. ${e.message}`);
    }
    pushLog(`[Panel] Backup erstellt und geprüft: ${name}`);
    notify('backup', '📦 Backup erstellt', `${name} (${fmtBytes((await fsp.stat(file)).size)})`, 'ok');
    if (config.backupCopy) { // zweiter Ort: ein Fehler macht das Backup selbst nicht ungültig
      try { await copyToTarget(file, config.backupCopy); copyState.last = { t: Date.now(), name, ok: true }; pushLog(`[Panel] Backup kopiert nach ${config.backupCopy}`); }
      catch (e) { const msg = String(e.message).trim().split('\n').pop(); copyState.last = { t: Date.now(), name, ok: false, msg }; pushLog(`[Panel] Kopie an ${config.backupCopy} fehlgeschlagen: ${msg}`); audit(null, 'backup_copy_failed', `${name}: ${msg}`); }
    }
    return name;
  } catch (e) {
    notify('backupFail', '⚠️ Backup fehlgeschlagen', String(e.message).slice(0, 500), 'bad');
    throw e;
  } finally { S.backupBusy = false; }
}
async function listBackups() {
  const names = (await fsp.readdir(config.backupDir)).filter((n) => BACKUP_RE.test(n));
  const items = await Promise.all(names.map(async (n) => {
    const st = await fsp.stat(path.join(config.backupDir, n));
    return { name: n, size: st.size, mtime: st.mtimeMs };
  }));
  return items.sort((a, b) => b.mtime - a.mtime);
}
async function pruneBackups() {
  if (!config.backupKeep) return;
  const auto = (await listBackups()).filter((b) => b.name.startsWith('auto-'));
  for (const b of auto.slice(config.backupKeep)) await fsp.unlink(path.join(config.backupDir, b.name)).catch(() => {});
}
function backupName(req) {
  const n = req.params.name;
  if (!BACKUP_RE.test(n)) throw httpError(400, 'Ungültiger Backup-Name');
  return path.join(config.backupDir, n);
}
app.get('/api/backups', wrap(async (req, res) => {
  const items = await listBackups();
  const disk = await diskInfo(config.backupDir).catch(() => null);
  res.json({ items, busy: S.backupBusy, disk: disk && { ...disk, used: items.reduce((a, b) => a + b.size, 0) }, copy: { target: config.backupCopy || '', last: copyState.last } });
}));
// Kopierziel (Ordner oder benutzer@host:/pfad) ausprobieren
app.post('/api/backups/copy-test', wrap(async (req, res) => {
  const spec = await testTarget(req.body.target);
  audit(ctxOf(req), 'backup_copy_test', spec);
  res.json({ ok: true });
}));
// Archiv eines vorhandenen Backups erneut prüfen
app.post('/api/backups/:name/verify', wrap(async (req, res) => {
  const f = backupName(req);
  if (!fs.existsSync(f)) throw httpError(404, 'Backup nicht gefunden');
  try { await verifyArchive(f); } catch (e) { throw httpError(422, e.message); }
  audit(ctxOf(req), 'backup_verify', path.basename(f));
  res.json({ ok: true });
}));
app.post('/api/backups', wrap(async (req, res) => {
  const name = await createBackup('backup');
  audit(ctxOf(req), 'backup_create', name);
  res.json({ ok: true, name });
}));
app.get('/api/backups/:name/download', wrap(async (req, res) => res.download(backupName(req))));
app.delete('/api/backups/:name', wrap(async (req, res) => {
  const f = backupName(req);
  await fsp.unlink(f);
  audit(ctxOf(req), 'backup_delete', path.basename(f));
  res.json({ ok: true });
}));
// Inhalt eines Backups (oberste zwei Ebenen) für die Auswahl beim Wiederherstellen
const backupTreeCache = new Map();
function listBackupTree(file, mtime) {
  const key = file + ':' + mtime;
  if (backupTreeCache.has(key)) return Promise.resolve(backupTreeCache.get(key));
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', file]);
    const tops = new Map();
    let buf = '', base = null, err = '';
    const addLine = (line) => {
      if (!line) return;
      const isDir = line.endsWith('/');
      const parts = line.replace(/\/+$/, '').split('/');
      if (base === null) base = parts[0];
      if (parts[0] !== base || parts.length < 2) return; // der Wurzelordner selbst
      const rest = parts.slice(1);
      let t = tops.get(rest[0]);
      if (!t) { t = { dir: false, files: 0, kids: new Map(), more: false }; tops.set(rest[0], t); }
      if (rest.length > 1 || isDir) t.dir = true;
      if (!isDir) t.files++;
      if (rest.length >= 2) {
        let k = t.kids.get(rest[1]);
        if (!k) { if (t.kids.size >= 300) { t.more = true; return; } k = { dir: false, files: 0 }; t.kids.set(rest[1], k); }
        if (rest.length > 2 || isDir) k.dir = true;
        if (!isDir) k.files++;
      }
    };
    child.stdout.on('data', (d) => { buf += d.toString('utf8'); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(addLine); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || 'Backup konnte nicht gelesen werden'));
      addLine(buf);
      const sort = (a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name);
      const entries = [...tops].map(([name, t]) => ({
        name, path: name, dir: t.dir, files: t.files, more: t.more,
        kids: [...t.kids].map(([kn, k]) => ({ name: kn, path: name + '/' + kn, dir: k.dir, files: k.files })).sort(sort),
      })).sort(sort);
      const result = { entries };
      if (backupTreeCache.size > 20) backupTreeCache.clear();
      backupTreeCache.set(key, result);
      resolve(result);
    });
  });
}
app.get('/api/backups/:name/contents', wrap(async (req, res) => {
  const file = backupName(req);
  const st = await fsp.stat(file).catch(() => { throw httpError(404, 'Backup nicht gefunden'); });
  try { res.json(await listBackupTree(file, st.mtimeMs)); } catch (e) { throw httpError(500, e.message); }
}));

function cleanRestorePaths(list) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Keine Auswahl getroffen');
  if (list.length > 300) throw httpError(400, 'Zu viele Einträge ausgewählt');
  const out = [...new Set(list.map((p) => String(p).replace(/\/+$/, '')))];
  for (const p of out) {
    if (!p || p.length > 300 || p.startsWith('/') || /\\|\0/.test(p) || p.split('/').some((x) => !x || x === '.' || x === '..')) throw httpError(400, 'Ungültiger Pfad: ' + p);
  }
  return out.filter((p) => !out.some((q) => q !== p && p.startsWith(q + '/'))); // Unterpunkte entfallen, wenn der Ordner schon gewählt ist
}
app.post('/api/backups/:name/restore', wrap(async (req, res) => {
  if (S.proc) throw httpError(409, 'Bitte zuerst den Server stoppen');
  const file = backupName(req);
  if (Array.isArray(req.body.paths) && req.body.paths.length) { // nur ausgewählte Ordner/Dateien zurückspielen
    const paths = cleanRestorePaths(req.body.paths);
    const base = path.resolve(config.serverDir);
    const baseName = path.basename(base);
    const old = base + '.before-restore';
    await fsp.rm(old, { recursive: true, force: true });
    await fsp.mkdir(old, { recursive: true });
    const moved = [];
    try {
      for (const p of paths) { // aktuellen Stand der gewählten Einträge beiseitelegen
        const src = path.join(base, p);
        if (!fs.existsSync(src)) continue;
        const dst = path.join(old, p);
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.rename(src, dst);
        moved.push([src, dst]);
      }
      await run('tar', ['-xzf', file, '-C', path.dirname(base), ...paths.map((p) => `${baseName}/${p}`)]);
    } catch (e) { // bei Fehler alles zurücklegen
      for (const [src, dst] of moved.reverse()) {
        await fsp.rm(src, { recursive: true, force: true }).catch(() => {});
        await fsp.mkdir(path.dirname(src), { recursive: true }).catch(() => {});
        await fsp.rename(dst, src).catch(() => {});
      }
      throw e;
    }
    audit(ctxOf(req), 'backup_restore', `${path.basename(file)} (Auswahl: ${paths.join(', ').slice(0, 300)})`);
    return res.json({ ok: true, note: `${paths.length} Eintrag/Einträge wiederhergestellt. Der vorherige Stand liegt unter ${old}.` });
  }
  const base = path.resolve(config.serverDir);
  const old = base + '.before-restore';
  await fsp.rm(old, { recursive: true, force: true });
  await fsp.rename(base, old);
  try {
    await run('tar', ['-xzf', file, '-C', path.dirname(base)]);
  } catch (e) {
    await fsp.rm(base, { recursive: true, force: true });
    await fsp.rename(old, base);
    throw e;
  }
  audit(ctxOf(req), 'backup_restore', path.basename(file));
  res.json({ ok: true, note: `Wiederhergestellt. Der vorherige Stand liegt unter ${old}.` });
}));

module.exports = { createBackup, listBackups, pruneBackups };
