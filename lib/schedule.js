'use strict';
// Zeitplaner (Neustarts, Backups)
const { S, audit, config } = require('./core');
const { pushLog, sendCommand, stopServer } = require('./minecraft');
const { createBackup, listBackups, pruneBackups } = require('../routes/backups');

const schedFired = new Set(); // bereits ausgelöste Warnungen/Neustarts (Schlüssel: Tag + Zeit + Art)
function scheduleTick() {
  const now = new Date();
  if (schedFired.size > 200) schedFired.clear();
  for (const t of config.backupTimes || []) { // feste Backup-Zeiten
    const [bh, bm] = t.split(':').map(Number);
    const target = new Date(now);
    target.setHours(bh, bm, 0, 0);
    const diff = (target - now) / 60000;
    const key = target.toDateString() + ' ' + t + 'bk';
    if (diff <= 0 && diff > -2 && !schedFired.has(key)) {
      schedFired.add(key);
      createBackup('auto')
        .then((name) => { audit(null, 'backup_create', `${name} (zeitgesteuert ${t})`); return pruneBackups(); })
        .catch((e) => pushLog('[Panel] Zeitgesteuertes Backup fehlgeschlagen: ' + e.message));
    }
  }
  const times = config.restartTimes || [];
  if (!times.length) return;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    for (const dayOffset of [0, 1]) { // „morgen früh“ schon vor Mitternacht vorwarnen
      const target = new Date(now);
      target.setDate(target.getDate() + dayOffset);
      target.setHours(h, m, 0, 0);
      const diff = (target - now) / 60000; // Minuten bis zum Neustart
      const day = target.toDateString() + ' ' + t;
      if (config.restartWarn && S.proc && S.state === 'running' && diff > 0 && diff <= 5) {
        for (const [w, key] of [[5, 'w5'], [1, 'w1']]) {
          if (diff <= w && !schedFired.has(day + key)) {
            schedFired.add(day + key);
            if (w === 5 && diff <= 1) schedFired.add(day + 'w1'); // kurz vor knapp: nur eine Meldung
            const mins = Math.max(1, Math.ceil(diff));
            try { sendCommand(`say Der Server startet in ${mins} Minute${mins === 1 ? '' : 'n'} neu.`); } catch {}
          }
        }
      }
      if (dayOffset === 0 && diff <= 0 && diff > -2 && !S.backupBusy && !schedFired.has(day + 'go')) {
        schedFired.add(day + 'go');
        if (S.proc && S.state === 'running') { // nur wenn der Server läuft (ein gestoppter Server wird nicht gestartet)
          audit(null, 'server_restart', `Geplanter Neustart (${t})`);
          pushLog(`[Panel] Geplanter Neustart um ${t}.`);
          S.restartAfterStop = true;
          stopServer();
        }
      }
    }
  }
}
setInterval(scheduleTick, 15000);


// Automatische Backups (stündlicher Check)
setInterval(async () => {
  const h = config.backupIntervalHours;
  if (!h) return;
  try {
    const last = (await listBackups()).find((b) => b.name.startsWith('auto-'));
    if (!last || Date.now() - last.mtime >= h * 3600 * 1000 - 60000) {
      const autoName = await createBackup('auto');
      audit(null, 'backup_create', autoName + ' (automatisch)');
      await pruneBackups();
    }
  } catch (e) { pushLog('[Panel] Auto-Backup fehlgeschlagen: ' + e.message); }
}, 15 * 60 * 1000);
