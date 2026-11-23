'use strict';
/**
 * Sammelt alle deutschen Texte der Oberfläche und der Server-Meldungen, die noch keine englische Übersetzung haben.
 *
 *   node dev/i18n-extract.js            zeigt, was fehlt (Anzahl + Liste)
 *   node dev/i18n-extract.js --json     gibt die fehlenden Texte als JSON aus (zum Übersetzen)
 *   node dev/i18n-extract.js --all      alle gefundenen Texte, auch die schon übersetzten
 *
 * Platzhalter in Texten mit Variablen heißen {0}, {1}, … (aus `…${x}…` in Vorlagen-Zeichenketten).
 * Die Übersetzungen stehen in public/i18n-en.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---- Zeichenketten aus JavaScript lesen (einfacher Scanner: Kommentare, '…', "…", `…` mit ${…}) ---- */
function jsStrings(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevSig = () => { let j = i - 1; while (j >= 0 && /\s/.test(src[j])) j--; return src[j] || ''; };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '/' && /[=(,:;!&|?{}\[]|^$|return|typeof/.test(prevSig())) { // Regex-Literal überspringen
      i++; let inCls = false;
      while (i < n && (src[i] !== '/' || inCls)) { if (src[i] === '\\') i++; else if (src[i] === '[') inCls = true; else if (src[i] === ']') inCls = false; i++; }
      i++; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; } else s += src[j++]; }
      out.push(unescapeJs(s)); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '', k = 0;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; }
        else if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1; j += 2;
          const start = j;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          const inner = src.slice(start, j - 1);
          out.push(...jsStrings(inner)); // Zeichenketten innerhalb von ${…} gesondert erfassen
          s += `{${k++}}`;
        } else s += src[j++];
      }
      out.push(unescapeJs(s)); i = j + 1; continue;
    }
    i++;
  }
  return out;
}
const unescapeJs = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, g) => {
  if (g[0] === 'u' && g.length === 5) return String.fromCharCode(parseInt(g.slice(1), 16));
  if (g[0] === 'x' && g.length === 3) return String.fromCharCode(parseInt(g.slice(1), 16));
  return { n: '\n', t: '\t', r: '\r' }[g] ?? g;
});

/* ---- Texte aus HTML ---- */
function htmlStrings(src) {
  const out = [];
  src = src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of src.matchAll(/>([^<>]+)</g)) out.push(decodeEntities(m[1]));
  for (const m of src.matchAll(/\s(?:placeholder|title|aria-label|alt|data-tip|label)="([^"]*)"/g)) out.push(decodeEntities(m[1]));
  return out;
}
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'");

/* ---- Was sieht nach einem deutschen Anzeigetext aus? ---- */
const GERMAN_WORD = /\b(der|die|das|den|dem|des|und|oder|nicht|kein|keine|ist|sind|wird|werden|wurde|für|mit|von|zu|zum|zur|auf|bei|nach|vor|aus|ein|eine|einen|einem|bitte|noch|nur|alle|dein|deine|deinen|im|am|als|wenn|dann|auch|wie|was|hier|neu|neue|neuer|fehlt|fehler|datei|dateien|ordner|server|spieler|benutzer|passwort|backup|backups|zeit|ändern|löschen|speichern|abbrechen|starten|stoppen|installieren|aktiv|läuft|gestoppt|gesendet|gespeichert|hinzufügen|entfernen|erstellt|ungültig\w*|zugriff|rolle|rollen|recht|rechte|konto|anmelden|abmelden|version|größe|geändert|name|text|code|test)\b/i;
const NON_TEXT = /^(?:[\w.-]+\/[\w./-]*|\/[\w./?=&:%{}-]*|#[\w-]+|\.[\w-]+|[\w-]+:[\w-]+|(?:fa-(?:solid|regular|brands)|fi)(?: [\w-]+)*|[a-z]+(?:-[a-z0-9]+)+|[a-z][a-zA-Z0-9]*|[A-Z_]{2,}|\d[\d.,:%\s]*|https?:\/\/\S+|[{}\d\s.,:;/·–—+*()[\]<>=!?%&|-]*)$/;
function wanted(s, strict = true) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 600) return false;
  if (!strict) return /[A-Za-zÄÖÜäöü]{2}/.test(t) && !/^https?:/.test(t); // HTML-Texte sind immer sichtbar
  if (/^[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-Za-zäöüß]+)?$/.test(t)) return true; // einzelne Wörter wie „Konsole“
  if (/^(?:application|text|image)\//.test(t)) return false;
  if (/^[\w.:/#-]+$/.test(t) && !/[äöüß]/i.test(t) && !GERMAN_WORD.test(t)) return false;
  if (NON_TEXT.test(t) && !/[äöüÄÖÜß]/.test(t)) return false;
  if (/[äöüÄÖÜß]/.test(t)) return true;
  return GERMAN_WORD.test(t) || /^[A-ZÄÖÜ][a-zäöüß]+(?: [\w()äöüß.,&/-]+)*$/.test(t);
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function collect() {
  const found = new Map(); // Text -> Quellen
  const add = (s, src, strict = true) => { const t = norm(s); if (wanted(t, strict)) { if (!found.has(t)) found.set(t, new Set()); found.get(t).add(src); } };
  for (const f of ['public/index.html', 'public/login.html']) htmlStrings(read(f)).forEach((s) => add(s, f, false));
  for (const f of ['public/app.js', 'public/login.js']) jsStrings(read(f)).forEach((s) => add(s, f));
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of ['server.js', ...walk('lib'), ...walk('routes')].filter((x) => x.endsWith('.js'))) jsStrings(read(f)).forEach((s) => add(s, f));
  return found;
}

function loadDictionary() {
  const file = path.join(ROOT, 'public', 'i18n-en.js');
  if (!fs.existsSync(file)) return { exact: {} };
  const win = {};
  new Function('window', fs.readFileSync(file, 'utf8'))(win);
  return win.I18N_EN || { exact: {} };
}

if (require.main === module) {
  const found = collect();
  const dict = loadDictionary();
  const have = new Set(Object.keys(dict.exact || {}));
  const missing = [...found.keys()].filter((k) => !have.has(k)).sort();
  if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1));
  else if (process.argv.includes('--all')) console.log([...found.keys()].sort().join('\n'));
  else {
    console.log(`${found.size} deutsche Texte gefunden, ${found.size - missing.length} übersetzt, ${missing.length} fehlen.`);
    missing.forEach((m) => console.log(' - ' + m));
    if (missing.length) process.exitCode = 1;
  }
}

module.exports = { collect, jsStrings, htmlStrings, wanted };
