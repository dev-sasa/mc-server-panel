'use strict';
// Express-App (Header, Seiten, statische Dateien)
const express = require('express');
const path = require('path');
const { isAuthed } = require('./auth');
const { ROOT } = require('./core');

/* ------------------------------------------------------------------ */
/* Express                                                             */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
// Hinter einem Reverse-Proxy (nginx, Caddy, Traefik …) kommt die echte Client-Adresse aus X-Forwarded-For.
// MCPANEL_TRUST_PROXY: loopback (Standard: nur Proxys auf demselben Rechner), 1/2/… (Anzahl Proxys), eine IP/ein Netz oder false.
// Wichtig: nur Proxys vertrauen, die den Header selbst setzen – sonst kann ein Angreifer die Adresse fälschen und die Sperre umgehen.
function trustProxy() {
  const v = String(process.env.MCPANEL_TRUST_PROXY ?? 'loopback').trim();
  if (/^(false|off|no|0)?$/i.test(v)) return false;
  if (/^(true|on|yes)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}
app.set('trust proxy', trustProxy());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '10mb' }));
// Seiten: das Panel selbst nur mit Anmeldung, sonst /login
const sendPage = (file) => (req, res) => res.sendFile(path.join(ROOT, 'public', file));
// Jeder Menüpunkt hat eine eigene Adresse: /konsole, /einstellungen, /dateien, ...
const PAGES = ['konsole', 'einstellungen', 'dateien', 'spieler', 'backups', 'installation', 'mods', 'logs', 'konto', 'changelog', 'panel', 'benutzer', 'protokoll'];
app.get('/', (req, res) => res.redirect(isAuthed(req) ? '/konsole' : '/login'));
app.get(['/index.html', ...PAGES.map((p) => '/' + p)], (req, res) => (isAuthed(req) ? sendPage('index.html')(req, res) : res.redirect('/login')));
app.get(['/login', '/login.html'], (req, res) => (isAuthed(req) ? res.redirect('/') : sendPage('login.html')(req, res)));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

module.exports = { app };
