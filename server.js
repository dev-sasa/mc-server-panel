'use strict';
// HTTP- und WebSocket-Server
const { WebSocketServer } = require('ws');
const { app } = require('./lib/app');
const { apiGuard, can, findUser, isAuthed } = require('./lib/auth');
const { DEV, S, audit, config, httpError } = require('./lib/core');
const { clients, logBuf, sendCommand, startServer, statusObj, waitStopped } = require('./lib/minecraft');

// ---- Module in der richtigen Reihenfolge einbinden (Reihenfolge der Routen ist wichtig) ----
require('./lib/minecraft');
require('./routes/login'); // öffentlich: Anmeldung
app.use('/api', apiGuard); // ab hier nur mit Sitzung und passendem Recht
require('./routes/session');
require('./routes/twofa');
require('./routes/server');
require('./routes/users');
require('./routes/settings');
require('./routes/files');
require('./routes/players');
require('./routes/install');
require('./routes/mods');
require('./routes/logs');
require('./routes/changelog');
require('./routes/backups');
require('./lib/schedule');


/* ------------------------------------------------------------------ */
/* HTTP + WebSocket                                                    */
/* ------------------------------------------------------------------ */
const server = app.listen(config.port, config.host, () => {
  console.log(`MC Server Panel läuft auf http://${config.host}:${config.port}` + (DEV ? '  [DEV-MODUS, Passwort: dev]' : ''));
});

// Dev-Modus: simulierten Server automatisch starten, damit direkt Spieler online sind (abschaltbar: MCPANEL_DEV_AUTOSTART=0)
if (DEV && process.env.MCPANEL_DEV_AUTOSTART !== '0') startServer().catch((e) => console.error('Autostart:', e.message));

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const okOrigin = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  if (req.url !== '/ws' || !isAuthed(req) || !okOrigin) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  const sess = isAuthed(req);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.username = sess.username;
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'init', lines: logBuf, status: statusObj() }));
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw);
        if (m.type === 'command') {
          if (!can(findUser(ws.username), 'server.console')) throw httpError(403, 'Keine Berechtigung für Befehle');
          sendCommand(m.cmd);
          audit({ user: ws.username }, 'command', m.cmd);
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'log', line: '[Panel] ' + e.message }));
      }
    });
    ws.on('close', () => clients.delete(ws));
  });
});

function shutdown() {
  console.log('Panel wird beendet…');
  if (S.proc) {
    S.stopRequested = true;
    try { sendCommand('stop'); } catch {}
    waitStopped(30000).then(() => process.exit(0));
  } else process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
