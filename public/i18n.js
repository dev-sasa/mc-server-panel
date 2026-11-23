'use strict';
/**
 * Sprachumschaltung Deutsch / English.
 * Die Oberfläche ist auf Deutsch geschrieben. Ist Englisch gewählt, werden alle Texte (auch später eingefügte, Hinweise und
 * Fehlermeldungen vom Server) anhand des Wörterbuchs in i18n-en.js ersetzt. Texte ohne Eintrag bleiben deutsch.
 * Platzhalter im Wörterbuch: {0}, {1} … stehen für Werte, die erst zur Laufzeit feststehen.
 */
(function () {
  const KEY = 'mcp_lang';
  let lang = null;
  try { lang = localStorage.getItem(KEY); } catch {}
  if (lang !== 'de' && lang !== 'en') lang = String(navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
  window.LANG = lang;
  document.documentElement.lang = lang;
  window.LOCALE = lang === 'en' ? 'en-GB' : 'de-DE';
  window.setLang = (l) => { try { localStorage.setItem(KEY, l); } catch {} location.reload(); };

  const dict = window.I18N_EN || { exact: {} };
  const exact = dict.exact || {};
  // Texte mit Platzhaltern in Muster umwandeln
  const rules = [];
  for (const [de, en] of Object.entries(exact)) {
    if (!/\{\d+\}/.test(de)) continue;
    const order = [];
    const src = de.split(/(\{\d+\})/).map((part) => {
      const m = part.match(/^\{(\d+)\}$/);
      if (m) { order.push(Number(m[1])); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    rules.push({ re: new RegExp('^' + src + '$', 's'), order, en });
  }
  rules.sort((a, b) => b.re.source.length - a.re.source.length);

  function tr(s) {
    if (lang === 'de' || typeof s !== 'string') return s;
    const core = s.replace(/\s+/g, ' ').trim();
    if (!core) return s;
    let out = exact[core];
    if (out === undefined) {
      for (const r of rules) {
        const m = core.match(r.re);
        if (m) { out = r.en.replace(/\{(\d+)\}/g, (_, n) => { const i = r.order.indexOf(Number(n)); return i >= 0 ? tr(m[i + 1]) : ''; }); break; }
      }
    }
    if (out === undefined) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + out + trail;
  }
  window.t = (s, ...vals) => { let out = tr(s); vals.forEach((v, i) => { out = out.replace('{' + i + '}', v); }); return out; };

  if (lang === 'de') return;

  /* ---- Englisch: DOM übersetzen ---- */
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'label'];
  const SKIP_TAG = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const inConsoleLine = (n) => { const c = n.parentElement && n.parentElement.closest('#console'); return !!c; };
  function doText(node) {
    const v = node.nodeValue;
    if (!v || !v.trim()) return;
    const p = node.parentElement;
    if (p && SKIP_TAG.has(p.tagName)) return;
    if (inConsoleLine(node) && !/^\s*\[(Panel|Installer)\]/.test(v)) return; // Minecraft-Log nicht anfassen
    const out = tr(v);
    if (out !== v) node.nodeValue = out;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      if (el.hasAttribute && el.hasAttribute(a)) {
        const v = el.getAttribute(a), out = tr(v);
        if (out !== v) el.setAttribute(a, out);
      }
    }
  }
  const FILTER = { acceptNode: (n) => (n.nodeType === 1 && SKIP_TAG.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) };
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || SKIP_TAG.has(root.tagName)) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  const titleParts = (s) => s.split(' – ').map(tr).join(' – ');
  function fixTitle() { const x = titleParts(document.title); if (x !== document.title) document.title = x; }

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName), out = tr(v); if (out !== v) m.target.setAttribute(m.attributeName, out); }
      else m.addedNodes.forEach(walk);
    }
    fixTitle();
  });
  function start() {
    walk(document.body);
    fixTitle();
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
