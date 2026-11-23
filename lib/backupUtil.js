'use strict';
// Hilfen für Backups: Speicherplatz, Prüfung des Archivs, Kopie an einen zweiten Ort
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { httpError, run } = require('./core');

/** Freier und gesamter Speicher des Datenträgers, auf dem `dir` liegt. */
async function diskInfo(dir) {
  if (typeof fsp.statfs === 'function') {
    const s = await fsp.statfs(dir);
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  }
  const out = await run('df', ['-Pk', dir]); // Ersatz für ältere Node-Versionen
  const f = out.trim().split('\n').pop().split(/\s+/);
  return { total: Number(f[1]) * 1024, free: Number(f[3]) * 1024 };
}
/** Belegter Platz eines Ordners in Bytes (du -sk). */
async function dirSize(dir) {
  try { return parseInt((await run('du', ['-sk', dir])).split(/\s+/)[0], 10) * 1024 || 0; } catch { return 0; }
}
/** Prüft vor dem Sichern, ob genug Platz da ist. Der Server-Ordner gilt als Obergrenze (gepackt ist es meist deutlich weniger). */
async function assertSpace(serverDir, backupDir, fmt) {
  const [need, disk] = await Promise.all([dirSize(serverDir), diskInfo(backupDir)]);
  if (need && disk.free < need * 1.05) {
    throw httpError(507, `Zu wenig Speicherplatz für ein Backup: frei ${fmt(disk.free)}, der Server-Ordner ist ${fmt(need)} groß. Ältere Backups löschen oder mehr Platz schaffen.`);
  }
  return { need, ...disk };
}

/** Liest das ganze Archiv (gzip-Prüfsumme und tar-Struktur). Wirft einen Fehler, wenn es defekt ist. */
function verifyArchive(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    child.on('error', (e) => reject(new Error('tar nicht ausführbar: ' + e.message)));
    child.on('close', (code) => (code === 0 ? resolve(true) : reject(new Error('Das Archiv ist defekt: ' + (err.trim().split('\n')[0] || 'Code ' + code)))));
  });
}

/* ---- Kopie an einen zweiten Ort ---- */
const REMOTE_RE = /^([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+):(\/[A-Za-z0-9_./-]*)$/; // benutzer@host:/pfad (kein Leerzeichen, keine Shell-Zeichen)
/** Prüft das Kopierziel. Gibt { kind: 'local'|'ssh', ... } zurück oder null (leer = keine Kopie). */
function parseTarget(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.length > 300 || /[\0\r\n]/.test(v)) throw httpError(400, 'Ungültiges Kopierziel');
  const m = v.match(REMOTE_RE);
  if (m) {
    if (m[3].split('/').includes('..')) throw httpError(400, 'Kopierziel: „..“ ist nicht erlaubt');
    return { kind: 'ssh', user: m[1], host: m[2], dir: m[3].replace(/\/+$/, '') || '/', spec: v };
  }
  if (!v.startsWith('/')) throw httpError(400, 'Kopierziel: entweder ein absoluter Ordner (/mnt/nas/backups) oder benutzer@host:/ordner');
  if (v.split('/').includes('..')) throw httpError(400, 'Kopierziel: „..“ ist nicht erlaubt');
  return { kind: 'local', dir: path.resolve(v), spec: v };
}
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']; // nie nach Passwort fragen; Server-Schlüssel muss schon bekannt sein
const sshArgs = (t) => [...SSH_OPTS, `${t.user}@${t.host}`];

async function copyToTarget(file, target) {
  const t = parseTarget(target);
  if (!t) return null;
  if (t.kind === 'local') {
    await fsp.mkdir(t.dir, { recursive: true });
    const dest = path.join(t.dir, path.basename(file));
    await fsp.copyFile(file, dest + '.part');
    await fsp.rename(dest + '.part', dest);
    return t.spec;
  }
  await run('ssh', [...sshArgs(t), 'mkdir', '-p', '--', t.dir], { timeout: 30000 });
  await run('rsync', ['-t', '--partial', '-e', ['ssh', ...SSH_OPTS].join(' '), '--', file, `${t.spec.replace(/\/+$/, '')}/`], { timeout: 6 * 3600 * 1000 });
  return t.spec;
}
/** Prüft, ob das Ziel erreichbar und beschreibbar ist (für die Schaltfläche „Testen“). */
async function testTarget(target) {
  const t = parseTarget(target);
  if (!t) throw httpError(400, 'Kein Kopierziel eingetragen');
  try {
    if (t.kind === 'local') {
      await fsp.mkdir(t.dir, { recursive: true });
      const probe = path.join(t.dir, `.panel-test-${process.pid}`);
      await fsp.writeFile(probe, 'ok');
      await fsp.unlink(probe);
    } else {
      await run('ssh', [...sshArgs(t), 'mkdir', '-p', '--', t.dir, '&&', 'test', '-w', t.dir], { timeout: 30000 });
    }
  } catch (e) {
    const msg = String(e.message).trim().split('\n').slice(-2).join(' ');
    throw httpError(400, 'Ziel nicht nutzbar: ' + msg + (t.kind === 'ssh' ? ' (Der Dienstbenutzer braucht einen SSH-Schlüssel ohne Passwort und muss den Server einmal per ssh bestätigt haben.)' : ''));
  }
  return t.spec;
}

module.exports = { diskInfo, dirSize, assertSpace, verifyArchive, parseTarget, copyToTarget, testTarget };
