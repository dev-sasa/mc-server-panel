'use strict';
// Änderungsverlauf: liest CHANGELOG.md und gibt ihn gegliedert zurück
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('../lib/app');
const { ROOT, wrap } = require('../lib/core');

function parse(md) {
  const entries = [];
  let cur = null, grp = null;
  for (const raw of md.split(/\r?\n/)) {
    let m;
    if ((m = raw.match(/^## \[?([^\]\s]+)\]?(?:\s+–\s+(\S+))?/))) { cur = { version: m[1], date: m[2] || '', notes: [], groups: [] }; entries.push(cur); grp = null; }
    else if (!cur) continue;
    else if ((m = raw.match(/^### (.+)/))) { grp = { title: m[1].trim(), items: [] }; cur.groups.push(grp); }
    else if ((m = raw.match(/^- (.+)/))) { (grp || (grp = { title: '', items: [] }, cur.groups.push(grp), grp)).items.push(m[1]); }
    else if (raw.trim() && !raw.startsWith('[') && !raw.startsWith('#')) { if (grp && grp.items.length && /^\s+\S/.test(raw)) grp.items[grp.items.length - 1] += ' ' + raw.trim(); else if (!grp) cur.notes.push(raw.trim()); }
  }
  return entries.filter((e) => e.groups.some((g) => g.items.length) || e.notes.length); // leere Abschnitte (z. B. „Unveröffentlicht“ ohne Einträge) auslassen
}

app.get('/api/changelog', wrap(async (req, res) => {
  let md = '', version = '';
  try { md = await fsp.readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8'); } catch {}
  try { version = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8')).version; } catch {}
  res.json({ version, entries: parse(md) });
}));

module.exports = { parse };
