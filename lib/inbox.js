'use strict';
// Posteingang für persönliche Benachrichtigungen im Panel: pro Benutzer die letzten Meldungen, auch wenn er gerade nicht angemeldet war
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./core');

const FILE = path.join(DATA, 'notifications.json');
const MAX_PER_USER = 100;
let store = {};
try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let timer = null;
const save = () => { clearTimeout(timer); timer = setTimeout(() => { try { fs.writeFileSync(FILE, JSON.stringify(store), { mode: 0o600 }); } catch {} }, 1000); };
const box = (u) => (store[u] = store[u] || []);

/** Legt die Meldung bei allen genannten Benutzern ab. Gibt den Eintrag zurück (gleiche ID für alle). */
function add(users, m) {
  const entry = { id: crypto.randomBytes(6).toString('hex'), ts: Date.now(), event: m.event, title: String(m.title || '').slice(0, 200), text: String(m.text || '').slice(0, 500), color: m.color || 'info', read: false };
  for (const u of users) { const b = box(u); b.unshift({ ...entry }); if (b.length > MAX_PER_USER) b.length = MAX_PER_USER; }
  save();
  return entry;
}
const list = (u) => ({ items: box(u), unread: box(u).filter((x) => !x.read).length });
function markRead(u, ids) { const set = ids && new Set(ids); for (const x of box(u)) if (!set || set.has(x.id)) x.read = true; save(); }
function clear(u) { store[u] = []; save(); }
function rename(from, to) { if (store[from]) { store[to] = store[from]; delete store[from]; save(); } }
function drop(u) { delete store[u]; save(); }

module.exports = { add, list, markRead, clear, rename, drop };
