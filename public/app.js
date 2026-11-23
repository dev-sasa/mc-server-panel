'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
};

/* ---------- Eigene Dropdowns (ersetzen jedes <select>, auch dynamisch erzeugte) ---------- */
// Das echte <select> bleibt versteckt im Hintergrund: value, onchange und change-Events funktionieren wie gewohnt.
const SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
let ddOpen = null; // { sel, trigger, menu }
function closeDd() {
  if (!ddOpen) return;
  ddOpen.menu.remove();
  ddOpen.trigger.setAttribute('aria-expanded', 'false');
  ddOpen = null;
}
document.addEventListener('pointerdown', (e) => { if (ddOpen && !ddOpen.menu.contains(e.target) && !ddOpen.trigger.contains(e.target)) closeDd(); });
window.addEventListener('resize', closeDd);
window.addEventListener('scroll', (e) => { if (ddOpen && !ddOpen.menu.contains(e.target)) closeDd(); }, true);

function enhanceSelect(sel) {
  if (sel.dataset.dd) return;
  sel.dataset.dd = '1';
  const wrap = el('div', { className: 'dd' });
  const trigger = el('button', { type: 'button', className: 'dd-trigger' });
  const label = el('span', { className: 'dd-label' });
  const chev = el('i', { className: 'fa-solid fa-chevron-down dd-chev' });
  chev.setAttribute('aria-hidden', 'true');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  ['aria-label', 'title'].forEach((a) => { if (sel.getAttribute(a)) trigger.setAttribute(a, sel.getAttribute(a)); });
  trigger.append(label, chev);
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(trigger, sel);

  const iconEl = (cls) => { const i = el('i', { className: cls + ' dd-ico' }); i.setAttribute('aria-hidden', 'true'); return i; };
  function sync() {
    const o = sel.options[sel.selectedIndex];
    label.textContent = '';
    if (o && o.dataset.icon) label.append(iconEl(o.dataset.icon));
    label.append(o ? o.textContent : '');
    trigger.disabled = sel.disabled;
  }
  // value von außen setzen (sel.value = ...) aktualisiert die Anzeige
  Object.defineProperty(sel, 'value', { configurable: true, get() { return SEL_VALUE.get.call(this); }, set(v) { SEL_VALUE.set.call(this, v); sync(); } });
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', sync);
  sync();

  let active = -1, typed = '', typedT = null;
  const optRows = () => (ddOpen && ddOpen.sel === sel ? [...ddOpen.menu.children] : []);
  function setActive(i, scroll = true) {
    const rows = optRows();
    if (!rows.length) return;
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => r.classList.toggle('active', k === active));
    if (scroll) rows[active].scrollIntoView({ block: 'nearest' });
  }
  function choose(index) {
    const o = sel.options[index];
    if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== index;
    sel.selectedIndex = index;
    sync();
    closeDd();
    trigger.focus();
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function open() {
    if (trigger.disabled) return;
    if (ddOpen && ddOpen.sel === sel) return closeDd();
    closeDd();
    const menu = el('div', { className: 'dd-menu', role: 'listbox' });
    [...sel.options].forEach((o, idx) => {
      const row = el('div', { className: 'dd-opt' + (idx === sel.selectedIndex ? ' sel' : '') + (o.disabled ? ' off' : ''), role: 'option' });
      row.setAttribute('aria-selected', idx === sel.selectedIndex ? 'true' : 'false');
      if (o.dataset.icon) row.append(iconEl(o.dataset.icon));
      row.append(el('span', { className: 'dd-text', textContent: o.textContent }));
      if (idx === sel.selectedIndex) { const ck = el('i', { className: 'fa-solid fa-check dd-check' }); ck.setAttribute('aria-hidden', 'true'); row.append(ck); }
      row.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus bleibt am Auslöser
      row.addEventListener('click', () => choose(idx));
      row.addEventListener('mousemove', () => { if (active !== idx) setActive(idx, false); });
      menu.append(row);
    });
    (trigger.closest('dialog') || document.body).append(menu);
    ddOpen = { sel, trigger, menu };
    trigger.setAttribute('aria-expanded', 'true');
    // Position: unter dem Auslöser, bei Platzmangel darüber
    const r = trigger.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    const mh = Math.min(menu.scrollHeight + 2, 300);
    const below = innerHeight - r.bottom, above = r.top;
    menu.style.maxHeight = Math.min(300, Math.max(120, (below < mh + 12 && above > below ? above : below) - 12)) + 'px';
    const h = menu.getBoundingClientRect().height;
    menu.style.top = (below < h + 12 && above > below ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.getBoundingClientRect().width - 8)) + 'px';
    setActive(sel.selectedIndex);
  }
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (e) => {
    const isOpen = !!ddOpen && ddOpen.sel === sel;
    const k = e.key;
    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) { e.preventDefault(); open(); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(sel.options.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDd(); }
    else if (k === 'Tab') closeDd();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) { // Tippen springt zum passenden Eintrag
      typed += k.toLowerCase(); clearTimeout(typedT); typedT = setTimeout(() => { typed = ''; }, 600);
      const i = [...sel.options].findIndex((o) => o.textContent.toLowerCase().startsWith(typed));
      if (i >= 0) setActive(i);
    }
  });
}
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1 || (n.classList && n.classList.contains('ln'))) return;
    if (n.tagName === 'SELECT') enhanceSelect(n);
    else if (n.querySelectorAll) n.querySelectorAll('select').forEach(enhanceSelect);
  });
}).observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('select').forEach(enhanceSelect);

/* ---------- API ---------- */
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Nicht angemeldet'); }
  if (!r.ok) throw new Error(data.error || 'Fehler ' + r.status);
  return data;
}
let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}
const act = (fn, okMsg) => async (...a) => {
  try { const r = await fn(...a); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, 'err'); }
};
const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
};
const fmtTime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm ' + String(s % 60).padStart(2, '0') + 's';
};
const fmtDate = (ms) => new Date(ms).toLocaleString(LOCALE);

/* ---------- Eigene Dialoge (statt Browser-confirm/prompt) ---------- */
const uiDlg = $('#uiDlg');
function uiAsk({ title, message = '', icon = 'fa-solid fa-circle-question', input = null, okText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; if (uiDlg.open) uiDlg.close(); resolve(v); };
    const cancelValue = input ? null : false;
    $('#uiTitle').textContent = title;
    $('#uiMsg').textContent = message;
    $('#uiIcon').className = icon;
    $('#uiIc').classList.toggle('danger', danger);
    $('#uiErr').textContent = '';
    const wrap = $('#uiInputWrap'), inp = $('#uiInput');
    wrap.classList.toggle('hidden', !input);
    if (input) {
      $('#uiLabel').textContent = input.label || '';
      inp.type = input.type || 'text';
      inp.value = input.value || '';
      inp.placeholder = input.placeholder || '';
      inp.autocomplete = input.type === 'password' ? 'new-password' : 'off';
    }
    const ok = $('#uiOk');
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    $('#uiForm').onsubmit = (e) => {
      e.preventDefault();
      if (!input) return done(true);
      if (input.required && !inp.value.trim()) { $('#uiErr').textContent = 'Bitte einen Wert eingeben.'; inp.focus(); return; }
      done(inp.value);
    };
    $('#uiCancel').onclick = () => done(cancelValue);
    uiDlg.onclose = () => done(cancelValue); // Esc
    uiDlg.showModal();
    if (input) { inp.focus(); inp.select(); } else ok.focus();
  });
}
const uiConfirm = (title, message, opts = {}) => uiAsk({ title, message, ...opts });
const uiPrompt = (title, input, opts = {}) => uiAsk({ title, input, ...opts });

/* ---------- Login / Start ---------- */
function showLogin() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  location.href = '/login';
}
$('#logoutBtn').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); showLogin(); };

/* ---------- Rollen ---------- */
let myRole = 'viewer', myPerms = new Set();
const can = (perm) => myPerms.has(perm);
// data-perm="a|b": sichtbar, wenn mindestens eines der Rechte vorhanden ist
const canAnyOf = (spec) => !spec || spec.split('|').some(can);
function applyRole() {
  $$('[data-perm]').forEach((e) => e.classList.toggle('role-hidden', !canAnyOf(e.dataset.perm)));
}

let myMc = null, myName = '', myRoleLabel = '';
function renderWhoami(me) {
  myMc = me.minecraft || null; myName = me.username; myRoleLabel = me.roleName;
  const b = $('#whoami'); b.textContent = '';
  b.append(myMc ? head(myMc.uuid, 24) : fa('fa-solid fa-circle-user'), el('span', { textContent: `${me.username} · ${myRoleLabel}` }));
}

async function boot() {
  let me;
  try { me = await api('GET', '/api/me'); } catch { return showLogin(); }
  myRole = me.role;
  myPerms = new Set(me.perms || []);
  renderWhoami(me);
  applyRole();
  connectWs();
  // Start-Seite aus der Adresse (/spieler, /dateien, ...); ohne Berechtigung -> Konsole
  let t = tabFromPath();
  if (!canAnyOf($(`#tabs a[data-tab=${t}]`).dataset.perm)) t = 'console';
  showTab(t, false);
  if (location.pathname !== '/' + ROUTES[t]) history.replaceState(null, '', '/' + ROUTES[t]);
}

/* ---------- Theme & mobile Navigation ---------- */
function renderThemeBtn() {
  const light = document.documentElement.dataset.theme === 'light';
  const b = $('#themeBtn'); b.textContent = '';
  b.append(fa(light ? 'fa-solid fa-moon' : 'fa-solid fa-sun'));
  const label = light ? 'Dunkles Design' : 'Helles Design';
  b.dataset.tip = label;
  b.setAttribute('aria-label', label);
}
function setTheme(t, save) {
  document.documentElement.dataset.theme = t;
  if (save) { try { localStorage.setItem('mcp_theme', t); } catch {} }
  renderThemeBtn();
}
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', (e) => {
  try { if (localStorage.getItem('mcp_theme')) return; } catch {}
  setTheme(e.matches ? 'light' : 'dark', false);
});
const sidebar = $('#sidebar'), scrim = $('#scrim');
const setMenu = (open) => { sidebar.classList.toggle('open', open); scrim.classList.toggle('open', open); };
$('#menuBtn').onclick = () => setMenu(!sidebar.classList.contains('open'));
scrim.onclick = () => setMenu(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

/* ---------- Seitenleiste einklappen (Desktop) + schnelle Tooltips ---------- */
const isCollapsed = () => document.documentElement.dataset.sidebar === 'collapsed';
function renderCollapseBtn() {
  const b = $('#collapseBtn'), c = isCollapsed();
  b.dataset.tip = c ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen';
  b.setAttribute('aria-label', b.dataset.tip);
  b.setAttribute('aria-expanded', String(!c));
}
$('#collapseBtn').onclick = () => {
  const c = !isCollapsed();
  if (c) document.documentElement.dataset.sidebar = 'collapsed'; else delete document.documentElement.dataset.sidebar;
  try { localStorage.setItem('mcp_sidebar', c ? 'collapsed' : 'expanded'); } catch {}
  renderCollapseBtn();
  sideTip.classList.remove('show');
};
const sideTip = el('div', { className: 'side-tip', role: 'tooltip' });
document.body.append(sideTip);
// Tooltip rechts neben dem Element: Menüpunkte nur im eingeklappten Zustand, Knöpfe unten und Ein-/Ausklappen immer
function tipText(t) {
  if (t.dataset.tip) return t.dataset.tip;
  const nt = t.querySelector('.nav-text');
  return nt ? nt.textContent.trim() : '';
}
sidebar.addEventListener('mouseover', (e) => {
  const t = e.target.closest('#tabs a, .side-foot .btn, .collapse-btn, .brand');
  if (!t || innerWidth <= 900) return;
  const always = t.matches('.side-foot .btn, .collapse-btn');
  if (!always && !isCollapsed()) return;
  const text = tipText(t);
  if (!text) return;
  const r = t.getBoundingClientRect();
  sideTip.textContent = text;
  sideTip.style.top = (r.top + r.height / 2) + 'px';
  sideTip.style.left = (r.right + 10) + 'px';
  sideTip.classList.add('show');
});
sidebar.addEventListener('mouseout', () => sideTip.classList.remove('show'));
sidebar.addEventListener('scroll', () => sideTip.classList.remove('show'));

/* ---------- Tabs (jede Seite hat eine eigene Adresse) ---------- */
const ROUTES = { console: 'konsole', settings: 'einstellungen', files: 'dateien', players: 'spieler', backups: 'backups', install: 'installation', mods: 'mods', logs: 'logs', account: 'konto', changelog: 'changelog', panel: 'panel', users: 'benutzer', audit: 'protokoll' };
const TAB_TITLE = { console: 'Konsole', settings: 'Einstellungen', files: 'Dateien', players: 'Spieler', backups: 'Backups', install: 'Installation', mods: 'Mods & Plugins', logs: 'Logs', account: 'Mein Konto', changelog: 'Changelog', panel: 'Panel', users: 'Benutzer', audit: 'Protokoll' };
const tabFromPath = () => Object.keys(ROUTES).find((k) => '/' + ROUTES[k] === location.pathname.replace(/\/+$/, '')) || 'console';
let currentTab = 'console';
function showTab(t, push = true) {
  currentTab = t;
  $$('#tabs a').forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
  $$('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + t));
  if (push && location.pathname !== '/' + ROUTES[t]) history.pushState(null, '', '/' + ROUTES[t]);
  document.title = TAB_TITLE[t] + ' – MC Server Panel';
  $('#pageTitle').textContent = TAB_TITLE[t];
  setMenu(false);
  window.scrollTo(0, 0);
  loadTab(t);
}
$('#tabs').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // Strg/Cmd-Klick = neuer Tab
  e.preventDefault();
  showTab(a.dataset.tab);
});
window.addEventListener('popstate', () => {
  const t = tabFromPath();
  showTab(canAnyOf($(`#tabs a[data-tab=${t}]`).dataset.perm) ? t : 'console', false);
});
function loadTab(t) {
  ({ settings: loadProps, files: () => loadFiles(cwd), players: loadPlayers, backups: loadBackups, install: loadInstall, mods: loadMods, logs: loadLogs, account: loadAccount, changelog: loadChangelog, panel: () => { loadConfig(); loadDiscord(); loadWebhook(); }, users: loadUsers, audit: () => loadAudit(true) })[t]?.();
}

/* ---------- WebSocket / Konsole / Dashboard ---------- */
let ws = null, lastStatus = null;
let plData = { whitelist: [], ops: [], banned: [] };
const con = $('#console');
const logLines = [];
let conFilter = 'all', conQuery = '';

// Zeile einordnen: chat | join | leave | warn | err | panel | cmd | info
const LOG_RE = /^\[(\d{2}:\d{2}:\d{2})\] \[[^\]]*\/(\w+)\]: ?(.*)$/;
function buildLine(raw) {
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, '');
  logLines.push(clean);
  if (logLines.length > 5000) logLines.shift();
  const d = el('div', { className: 'ln' });
  let cat = 'info', text = clean;
  if (clean.startsWith('[Panel]')) cat = 'panel';
  else if (clean.startsWith('> ')) cat = 'cmd';
  else {
    const m = clean.match(LOG_RE);
    if (m) {
      const [, time, level, msg] = m;
      d.append(el('span', { className: 't', textContent: time }));
      text = msg;
      if (/^(<[^>]+>|\[Server\]|\[Rcon\]) /.test(msg)) cat = 'chat';
      else if (/ joined the game$/.test(msg)) cat = 'join';
      else if (/ left the game$/.test(msg)) cat = 'leave';
      else if (level === 'ERROR' || level === 'FATAL') cat = 'err';
      else if (level === 'WARN') cat = 'warn';
    } else if (/Exception|^\s+at |^Caused by/.test(clean)) cat = 'err';
  }
  d.classList.add(cat);
  d.dataset.cat = cat;
  d.dataset.text = clean.toLowerCase();
  const chat = cat === 'chat' && text.match(/^(<[^>]+>|\[Server\]|\[Rcon\]) (.*)$/);
  if (chat) d.append(el('span', { className: 'who', textContent: chat[1] + ' ' }), el('span', { className: 'msg', textContent: chat[2] }));
  else d.append(document.createTextNode(text));
  return d;
}
function lineVisible(d) {
  const c = d.dataset.cat;
  const byFilter = conFilter === 'all' || (conFilter === 'join' ? c === 'join' || c === 'leave' : c === conFilter);
  return byFilter && (!conQuery || d.dataset.text.includes(conQuery));
}
function addLine(raw) {
  const stick = con.scrollTop + con.clientHeight >= con.scrollHeight - 40;
  const d = buildLine(raw);
  d.hidden = !lineVisible(d);
  con.append(d);
  while (con.childElementCount > 1500) con.firstChild.remove();
  if (stick) con.scrollTop = con.scrollHeight;
}
function refilter() {
  [...con.children].forEach((d) => { d.hidden = !lineVisible(d); });
  con.scrollTop = con.scrollHeight;
}
$('#conFilters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  conFilter = b.dataset.f;
  $$('#conFilters button').forEach((x) => x.classList.toggle('active', x === b));
  refilter();
});
$('#conSearch').addEventListener('input', (e) => { conQuery = e.target.value.trim().toLowerCase(); refilter(); });
$('#conClear').onclick = () => { con.textContent = ''; logLines.length = 0; };
$('#conDl').onclick = () => {
  const url = URL.createObjectURL(new Blob([logLines.join('\n') + '\n'], { type: 'text/plain' }));
  const a = el('a', { href: url, download: 'server-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

function connectWs() {
  if (ws) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'init') { con.textContent = ''; logLines.length = 0; m.lines.forEach(addLine); con.scrollTop = con.scrollHeight; setStatus(m.status); }
    else if (m.type === 'log') addLine(m.line);
    else if (m.type === 'status') setStatus(m.status);
    else if (m.type === 'notify') showNotify(m);
  };
  ws.onclose = () => {
    ws = null;
    setTimeout(async () => { try { await api('GET', '/api/me'); connectWs(); } catch {} }, 2000);
  };
}

// Verlaufskurven (letzte ~3 Minuten, ein Messpunkt alle 3 s)
const HIST = 60, cpuH = [], ramH = [];
function spark(svg, data, max) {
  const w = 120, h = 40, step = w / (HIST - 1);
  const line = svg.querySelector('.line'), area = svg.querySelector('.area');
  if (data.length < 2) { line.setAttribute('d', ''); area.setAttribute('d', ''); return; }
  const x0 = w - (data.length - 1) * step, m = Math.max(max, 1);
  const pts = data.map((v, i) => [x0 + i * step, h - 3 - Math.min(v / m, 1) * (h - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  line.setAttribute('d', d);
  area.setAttribute('d', `${d} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`);
}
function renderSparks() {
  spark($('#spCpu'), cpuH, 100);
  spark($('#spRam'), ramH, (lastStatus && lastStatus.memMax) || Math.max(...ramH, 1));
}
function sample() {
  if (!lastStatus) return;
  const off = lastStatus.state === 'stopped';
  cpuH.push(off ? 0 : lastStatus.cpu / lastStatus.sys.cpus); ramH.push(off ? 0 : lastStatus.rss);
  if (cpuH.length > HIST) { cpuH.shift(); ramH.shift(); }
  renderSparks();
}
setInterval(sample, 3000);

// Kopfreihe: immer genau eine Zeile. Passt nicht jeder Kopf hinein, steht am Ende ein Kasten „+N“.
// Beim Darüberfahren erscheint der Name (bei „+N“ die Liste der übrigen Spieler).
let headsList = [], headsW = -1;
const HEAD = 30, HEAD_GAP = 5;
function tipEl(tip, cls, child) {
  const s = el('span', { className: 'hd ' + cls, tabIndex: 0 }, child);
  s.dataset.tip = tip;
  s.setAttribute('aria-label', tip.replace(/\n/g, ', '));
  return s;
}
function renderHeads(list) {
  headsList = list;
  const box = $('#heads');
  headsW = box.clientWidth;
  box.textContent = '';
  if (!list.length) return box.append(el('span', { className: 'none', textContent: 'Niemand online' }));
  const slots = headsW ? Math.max(1, Math.floor((headsW + HEAD_GAP) / (HEAD + HEAD_GAP))) : 8; // 0 = Seite gerade nicht sichtbar
  const showAll = list.length <= slots;
  const shown = showAll ? list : list.slice(0, Math.max(0, slots - 1));
  shown.forEach((n) => {
    const h = head(n, HEAD);
    h.removeAttribute('title');
    box.append(tipEl(/^\./.test(n) ? n + ' (Bedrock)' : n, '', h));
  });
  if (!showAll) {
    const rest = list.slice(shown.length);
    const names = rest.slice(0, 12).join('\n') + (rest.length > 12 ? `\n… und ${rest.length - 12} weitere` : '');
    box.append(tipEl(names, 'more', document.createTextNode('+' + rest.length)));
  }
}
// bei geänderter Kartenbreite (Fenstergröße, Seitenwechsel) neu aufteilen
new ResizeObserver(() => { const w = $('#heads').clientWidth; if (w !== headsW) renderHeads(headsList); }).observe($('#heads'));
const barLevel = (pct, warn, hot) => 'bar' + (pct >= hot ? ' hot' : pct >= warn ? ' warn' : '');
const STATE_TXT = { stopped: 'Gestoppt', starting: 'Startet…', running: 'Läuft', stopping: 'Stoppt…' };
function setStatus(s) {
  const first = !lastStatus;
  lastStatus = s;
  const off = s.state === 'stopped';
  ['stateDot', 'topDot'].forEach((id) => { $('#' + id).className = 'dot ' + s.state; });
  $('#stateText').textContent = $('#topState').textContent = STATE_TXT[s.state];
  // Laufzeit hinter „Läuft“ (ohne Sekunden, sobald es länger als eine Stunde ist)
  const upTxt = s.state === 'running' && s.uptime != null ? '· ' + (s.uptime >= 3600 ? fmtTime(s.uptime).replace(/ \d+s$/, '') : fmtTime(s.uptime)) : '';
  $('#stateUp').textContent = $('#topUp').textContent = upTxt;
  $('#srvName').textContent = s.motd || 'Minecraft-Server';
  $('#srvVersion').textContent = s.version ? 'Version ' + s.version : 'Version unbekannt';
  $('#srvWorld').textContent = s.levelName;
  $('#srvNextChip').classList.toggle('hidden', !s.nextRestart);
  if (s.nextRestart) {
    const d = new Date(s.nextRestart), sameDay = d.toDateString() === new Date().toDateString();
    $('#srvNext').textContent = `Neustart ${sameDay ? 'heute' : 'morgen'} ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
  }

  const online = s.state === 'running' ? s.players : [];
  const pct = Math.min(100, (online.length / s.maxPlayers) * 100);
  $('#mPlayers').textContent = online.length;
  $('#mMax').textContent = s.maxPlayers;
  $('#plBar').firstElementChild.style.width = pct + '%';
  $('#plBar').className = barLevel(pct, 70, 90);
  renderHeads(online);

  // Auslastung des gesamten Prozessors (alle Kerne zusammen), darunter in Kernen
  const cores = s.sys.cpus;
  $('#mCpu').textContent = off ? '–' : Math.min(100, s.cpu / cores).toFixed(1) + ' %';
  $('#mCores').textContent = off ? `${cores} Kerne` : `${(s.cpu / 100).toFixed(1).replace('.', LANG === 'en' ? '.' : ',')} von ${cores} Kernen`;
  $('#mLoad').textContent = s.sys.load.map((x) => x.toFixed(2)).join(' · ');
  $('#mRam').textContent = off ? '–' : fmtBytes(s.rss);
  $('#mRamSub').textContent = s.memMax ? `von max. ${fmtBytes(s.memMax)}` + (off ? '' : ` (${Math.round((s.rss / s.memMax) * 100)} %)`) : ' ';
  // Server-Takt: 20 TPS = alles in Ordnung; MSPT = Millisekunden je Tick (Grenze 50 ms)
  const tpsOn = s.state === 'running' && s.tps != null;
  $('#mTps').textContent = tpsOn ? s.tps.toFixed(1) : (s.state === 'running' && s.tpsSupported ? '…' : '–');
  $('#mMsptSub').textContent = !s.tpsSupported && s.state === 'running' ? 'Auf diesem Server nicht abfragbar'
    : s.mspt != null && s.state === 'running' ? `${s.mspt.toFixed(1)} ms je Tick (Grenze 50 ms)` : ' ';
  $('#tpsBar').firstElementChild.style.width = (tpsOn ? (s.tps / 20) * 100 : 0) + '%';
  $('#tpsBar').className = 'bar' + (tpsOn && s.tps < 15 ? ' hot' : tpsOn && s.tps < 18 ? ' warn' : '');
  const used = s.sys.totalmem - s.sys.freemem, sp = (used / s.sys.totalmem) * 100;
  $('#mSys').textContent = `${fmtBytes(used)} / ${fmtBytes(s.sys.totalmem)}`;
  $('#sysBar').firstElementChild.style.width = sp + '%';
  $('#sysBar').className = barLevel(sp, 75, 90);

  $('#btnStart').disabled = !off;
  $('#btnStop').disabled = s.state !== 'running' && s.state !== 'starting';
  $('#btnRestart').disabled = s.state === 'stopping';
  $('#btnKill').disabled = off;
  if (first) { sample(); sample(); }
  if (currentTab === 'players') renderOnline(s.players);
  if (plDlg.open) renderSug();
}
$('#btnStart').onclick = act(() => api('POST', '/api/server/start'));
$('#btnStop').onclick = act(() => api('POST', '/api/server/stop'));
$('#btnRestart').onclick = act(() => api('POST', '/api/server/restart'));
$('#btnKill').onclick = async () => {
  if (await uiConfirm('Server hart beenden?', 'Der Prozess wird sofort beendet (Kill). Ungespeicherte Daten gehen verloren.', { okText: 'Kill', danger: true, icon: 'fa-solid fa-skull-crossbones' })) act(() => api('POST', '/api/server/kill'))();
};

const cmdHistory = []; let hIdx = 0;
$('#cmdForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#cmdInput'), cmd = inp.value.trim();
  if (!cmd) return;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'command', cmd }));
  addLine('> ' + cmd);
  cmdHistory.push(cmd); hIdx = cmdHistory.length; inp.value = '';
});
$('#cmdInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && hIdx > 0) { e.target.value = cmdHistory[--hIdx]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { e.target.value = hIdx < cmdHistory.length - 1 ? cmdHistory[++hIdx] : ((hIdx = cmdHistory.length), ''); e.preventDefault(); }
});

/* ---------- server.properties ---------- */
const MODES = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFS = ['peaceful', 'easy', 'normal', 'hard'];
// [key, Titel, Typ, Hilfetext, volle Breite]
const SETTINGS = [
  { title: 'Allgemein', icon: 'fa-solid fa-server', fields: [
    ['motd', 'Server-Beschreibung (MOTD)', 'text', 'Text in der Serverliste', true],
    ['max-players', 'Maximale Spieler', 'number', 'Wie viele gleichzeitig spielen dürfen'],
    ['online-mode', 'Online-Modus', 'bool', 'Spieler werden bei Mojang geprüft (nur Originalkonten)'],
    ['white-list', 'Whitelist aktiv', 'bool', 'Nur eingetragene Spieler dürfen beitreten'],
    ['enforce-whitelist', 'Whitelist erzwingen', 'bool', 'Wirft Nicht-Eingetragene sofort raus'],
  ] },
  { title: 'Spielregeln', icon: 'fa-solid fa-gamepad', fields: [
    ['gamemode', 'Spielmodus', MODES, 'Standard für neue Spieler'],
    ['difficulty', 'Schwierigkeit', DIFFS],
    ['hardcore', 'Hardcore', 'bool', 'Ein Tod beendet das Spiel'],
    ['pvp', 'PvP', 'bool', 'Spieler können sich gegenseitig schaden'],
    ['force-gamemode', 'Spielmodus erzwingen', 'bool', 'Beim Beitritt immer den Standard setzen'],
    ['allow-flight', 'Fliegen erlauben', 'bool', 'Verhindert Kicks bei Flug-Mods'],
    ['enable-command-block', 'Befehlsblöcke', 'bool'],
    ['player-idle-timeout', 'AFK-Kick', 'number', 'Minuten, 0 = aus'],
  ] },
  { title: 'Welt', icon: 'fa-solid fa-earth-europe', fields: [
    ['level-name', 'Weltname', 'text', 'Ordnername der Welt'],
    ['level-seed', 'Welt-Seed', 'text', 'Leer = zufällig (nur bei neuer Welt)'],
    ['level-type', 'Welttyp', 'text'],
    ['generate-structures', 'Strukturen', 'bool', 'Dörfer, Festungen usw.'],
    ['allow-nether', 'Nether erlauben', 'bool'],
    ['spawn-monsters', 'Monster', 'bool'],
    ['spawn-animals', 'Tiere', 'bool'],
    ['spawn-npcs', 'Dorfbewohner', 'bool'],
    ['spawn-protection', 'Spawn-Schutz', 'number', 'Radius in Blöcken'],
  ] },
  { title: 'Netzwerk & Leistung', icon: 'fa-solid fa-gauge-high', fields: [
    ['server-ip', 'Server-IP', 'text', 'Leer = alle Adressen'],
    ['server-port', 'Server-Port', 'number', 'Standard: 25565'],
    ['view-distance', 'Sichtweite', 'number', 'Chunks – höher = mehr Last'],
    ['simulation-distance', 'Simulationsdistanz', 'number', 'Chunks mit aktiven Mobs und Pflanzen'],
  ] },
];
function settingCtl(key, type, value) {
  let c;
  if (type === 'bool') {
    const i = el('input', { type: 'checkbox', checked: String(value) === 'true' });
    i.dataset.bool = '1';
    c = el('label', { className: 'switch' }, i, el('span', { className: 'slider' }));
    c.dataset.sw = '1';
    i.dataset.key = key;
    return c;
  }
  if (Array.isArray(type)) {
    c = el('select', {}, type.map((o) => el('option', { value: o, textContent: o })));
    if (!type.includes(value)) c.append(el('option', { value, textContent: value }));
    c.value = value;
  } else {
    c = el('input', { type: type === 'number' ? 'number' : 'text', value: value ?? '' });
  }
  c.dataset.key = key;
  return c;
}
function settingRow(key, label, type, help, value, stack) {
  const ctl = settingCtl(key, type, value);
  return el('div', { className: 'field' + (stack ? ' stack' : '') },
    el('div', { className: 'field-text' }, el('b', { textContent: label }), help ? el('small', { textContent: help }) : ''),
    el('div', { className: 'field-ctl' + (ctl.dataset.sw ? ' sw' : '') }, ctl));
}
async function loadProps() {
  const { exists, props } = await api('GET', '/api/properties').catch((e) => (toast(e.message, 'err'), { exists: false, props: {} }));
  const hint = $('#propsHint');
  hint.classList.toggle('warn', !exists);
  hint.querySelector('i').className = exists ? 'fa-solid fa-circle-info' : 'fa-solid fa-triangle-exclamation';
  hint.querySelector('span').textContent = exists
    ? 'Änderungen werden nach einem Server-Neustart wirksam.'
    : 'Noch keine server.properties – sie wird beim ersten Serverstart erzeugt (vorher Server installieren und EULA akzeptieren).';
  const grid = $('#propsForm'), more = $('#propsMore');
  grid.textContent = ''; more.textContent = '';
  const known = new Set();
  const list = el('div', { className: 'card' });
  SETTINGS.forEach((g) => {
    const fields = g.fields.filter(([k]) => k in props);
    g.fields.forEach(([k]) => known.add(k));
    if (!fields.length) return;
    list.append(el('section', { className: 'set-sec' },
      el('h3', { className: 'set-title' }, fa(g.icon), g.title),
      fields.map(([k, label, type, help, stack]) => settingRow(k, label, type, help, props[k], stack))));
  });
  if (list.childElementCount) grid.append(list);
  const rest = Object.keys(props).filter((k) => !known.has(k)).sort();
  rest.forEach((k) => more.append(settingRow(k, k, 'text', '', props[k], false)));
  $('#propsMoreWrap').classList.toggle('hidden', !rest.length);
}
$('#propsSave').onclick = act(async () => {
  const out = {};
  $$('#tab-settings [data-key]').forEach((i) => { out[i.dataset.key] = i.dataset.bool ? String(i.checked) : i.value; });
  return api('PUT', '/api/properties', { props: out });
}, (r) => (r.running ? 'Gespeichert – Neustart nötig, damit es gilt.' : 'Gespeichert.'));

/* ---------- Dateien ---------- */
let cwd = '';
const join = (a, b) => (a ? a + '/' + b : b);
const FILE_ICONS = {
  jar: ['jar', 'fa-solid fa-cube'], zip: ['zip', 'fa-solid fa-file-zipper'], gz: ['zip', 'fa-solid fa-file-zipper'], '7z': ['zip', 'fa-solid fa-file-zipper'],
  png: ['img', 'fa-regular fa-file-image'], jpg: ['img', 'fa-regular fa-file-image'], jpeg: ['img', 'fa-regular fa-file-image'], gif: ['img', 'fa-regular fa-file-image'],
  json: ['cfg', 'fa-solid fa-file-code'], yml: ['cfg', 'fa-solid fa-file-code'], yaml: ['cfg', 'fa-solid fa-file-code'], toml: ['cfg', 'fa-solid fa-file-code'],
  properties: ['cfg', 'fa-solid fa-file-code'], conf: ['cfg', 'fa-solid fa-file-code'], cfg: ['cfg', 'fa-solid fa-file-code'],
  txt: ['', 'fa-regular fa-file-lines'], log: ['', 'fa-regular fa-file-lines'], md: ['', 'fa-regular fa-file-lines'],
  sh: ['cfg', 'fa-solid fa-terminal'], js: ['cfg', 'fa-solid fa-file-code'],
  dat: ['', 'fa-solid fa-database'], mca: ['', 'fa-solid fa-database'], mcc: ['', 'fa-solid fa-database'], db: ['', 'fa-solid fa-database'],
};
function fileIcon(it) {
  if (it.dir) return fa('fi dir fa-solid fa-folder');
  const [cls, icon] = FILE_ICONS[(it.name.split('.').pop() || '').toLowerCase()] || ['', 'fa-regular fa-file'];
  return fa(`fi ${cls} ${icon}`);
}
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i;
let fileItems = [], fSel = new Set(), fFilterText = '';
async function loadFiles(p) {
  try {
    const { items } = await api('GET', '/api/files?path=' + encodeURIComponent(p));
    if (p !== cwd) { fSel.clear(); $('#fFilter').value = ''; fFilterText = ''; }
    cwd = p;
    fileItems = items;
    fSel = new Set([...fSel].filter((n) => items.some((i) => i.name === n)));
    renderFiles();
  } catch (e) { toast(e.message, 'err'); }
}
function renderFiles() {
  const p = cwd;
  const crumbs = $('#crumbs'); crumbs.textContent = '';
  const parts = p ? p.split('/') : [];
  crumbs.append(el('a', { onclick: () => loadFiles('') }, fa('fa-solid fa-house'), 'server'));
  parts.forEach((part, i) => {
    crumbs.append(el('span', {}, fa('fa-solid fa-chevron-right')));
    crumbs.append(el('a', { textContent: part, onclick: () => loadFiles(parts.slice(0, i + 1).join('/')) }));
  });
  const q = fFilterText.toLowerCase();
  const shown = fileItems.filter((it) => !q || it.name.toLowerCase().includes(q));
  const tbl = $('#fileTable'); tbl.textContent = '';
  const all = el('input', { type: 'checkbox', title: 'Alle auswählen', checked: shown.length > 0 && shown.every((i) => fSel.has(i.name)) });
  all.setAttribute('aria-label', 'Alle auswählen');
  all.onchange = () => { shown.forEach((i) => (all.checked ? fSel.add(i.name) : fSel.delete(i.name))); renderFiles(); };
  tbl.append(el('tr', {}, el('th', { className: 'chk' }, all), ...['Name', 'Größe', 'Geändert', ''].map((x) => el('th', { textContent: x }))));
  if (p && !q) tbl.append(el('tr', {}, el('td', { colSpan: 5 }, el('a', { className: 'link', onclick: () => loadFiles(p.split('/').slice(0, -1).join('/')) }, fa('fi fa-solid fa-arrow-turn-up'), 'Ordner nach oben'))));
  if (!shown.length) tbl.append(el('tr', {}, el('td', { colSpan: 5, className: 'bk-empty' }, fa('fa-regular fa-folder-open'), q ? 'Nichts gefunden.' : 'Dieser Ordner ist leer.')));
  shown.forEach((it) => {
    const full = join(p, it.name);
    const name = el('a', { className: 'link', onclick: () => (it.dir ? loadFiles(full) : openEditor(full)) }, fileIcon(it), it.name);
    const cb = el('input', { type: 'checkbox', checked: fSel.has(it.name) });
    cb.setAttribute('aria-label', it.name + ' auswählen');
    cb.onchange = () => { if (cb.checked) fSel.add(it.name); else fSel.delete(it.name); updateSelBar(); tr.classList.toggle('sel', cb.checked); all.checked = shown.every((i) => fSel.has(i.name)); };
    const btns = el('td', { className: 'act' });
    if (!it.dir) {
      const dl = el('a', { className: 'btn ic sm', title: 'Herunterladen', href: '/api/download?path=' + encodeURIComponent(full) }, fa('fa-solid fa-download'));
      dl.setAttribute('aria-label', 'Herunterladen');
      btns.append(dl, ' ');
      if (ARCHIVE_RE.test(it.name)) btns.append(faBtn('fa-solid fa-box-open', 'Entpacken', act(async () => {
        if (!(await uiConfirm('Archiv entpacken?', `„${it.name}“ wird in den Ordner /${p} entpackt. Gleichnamige Dateien werden überschrieben.`, { okText: 'Entpacken', icon: 'fa-solid fa-box-open' }))) return;
        toast('Entpacken läuft…');
        await api('POST', '/api/files/extract', { path: full });
        loadFiles(p);
      }, 'Entpackt.'), 'sm'), ' ');
    }
    btns.append(
      faBtn('fa-solid fa-pen', 'Umbenennen', act(async () => {
        const n = await uiPrompt('Umbenennen', { label: 'Neuer Name', value: it.name, required: true }, { okText: 'Umbenennen', icon: 'fa-solid fa-pen' });
        if (n && n !== it.name) { await api('POST', '/api/rename', { from: full, to: join(p, n) }); loadFiles(p); }
      }), 'sm'), ' ',
      faBtn('fa-solid fa-trash', 'Löschen', act(async () => {
        if (!(await uiConfirm('Endgültig löschen?', `„${it.name}“ wird unwiderruflich gelöscht.`, { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
        await api('DELETE', '/api/file?path=' + encodeURIComponent(full)); loadFiles(p);
      }), 'sm danger'));
    const tr = el('tr', { className: fSel.has(it.name) ? 'sel' : '' }, el('td', { className: 'chk' }, cb), el('td', {}, name), el('td', { textContent: it.dir ? '' : fmtBytes(it.size) }), el('td', { textContent: fmtDate(it.mtime) }), btns);
    tbl.append(tr);
  });
  updateSelBar();
}
function updateSelBar() {
  const n = fSel.size;
  $('#fSelBar').classList.toggle('hidden', !n);
  $('#fSelCount').textContent = n === 1 ? '1 ausgewählt' : n + ' ausgewählt';
}
$('#fFilter').addEventListener('input', (e) => { fFilterText = e.target.value.trim(); renderFiles(); });
$('#fSelNone').onclick = () => { fSel.clear(); renderFiles(); };
$('#fSelDel').onclick = act(async () => {
  const names = [...fSel];
  if (!(await uiConfirm('Auswahl löschen?', (names.length === 1 ? '1 Eintrag wird unwiderruflich gelöscht (Ordner samt Inhalt).' : `${names.length} Einträge werden unwiderruflich gelöscht (Ordner samt Inhalt).`), { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
  await api('POST', '/api/files/delete', { path: cwd, names });
  fSel.clear(); loadFiles(cwd);
}, 'Gelöscht.');
$('#fSelDl').onclick = () => {
  const qs = [...fSel].map((n) => '&name=' + encodeURIComponent(n)).join('');
  const a = el('a', { href: '/api/files/archive?path=' + encodeURIComponent(cwd) + qs, download: '' });
  document.body.append(a); a.click(); a.remove();
};
$('#fNewDir').onclick = act(async () => { const n = await uiPrompt('Neuer Ordner', { label: 'Ordnername', required: true }, { okText: 'Anlegen', icon: 'fa-solid fa-folder-plus' }); if (n) { await api('POST', '/api/mkdir', { path: join(cwd, n) }); loadFiles(cwd); } });
$('#fNewFile').onclick = act(async () => { const n = await uiPrompt('Neue Datei', { label: 'Dateiname', required: true }, { okText: 'Anlegen', icon: 'fa-solid fa-file-circle-plus' }); if (n) { await api('PUT', '/api/file', { path: join(cwd, n), content: '' }); loadFiles(cwd); openEditor(join(cwd, n)); } });
/* ---- Hochladen: mit Fortschritt, per Auswahl oder Drag & Drop ---- */
let upXhr = null;
function uploadFiles(files, dir = cwd) {
  files = [...files];
  if (!files.length) return;
  if (upXhr) { toast('Es läuft schon ein Upload.', 'err'); return; }
  const total = files.reduce((s, f) => s + f.size, 0);
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const box = $('#upBox'), bar = $('#upBar'), label = $('#upLabel');
  const what = files.length === 1 ? files[0].name : files.length + ' Dateien';
  const t0 = Date.now();
  box.classList.remove('hidden'); bar.style.width = '0%'; label.textContent = `${what} – wird gestartet …`;
  const xhr = upXhr = new XMLHttpRequest();
  const done = () => { upXhr = null; box.classList.add('hidden'); };
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.min(100, (e.loaded / e.total) * 100), sec = (Date.now() - t0) / 1000 || 1;
    bar.style.width = pct.toFixed(1) + '%';
    label.textContent = `${what} – ${pct.toFixed(0)} % (${fmtBytes(e.loaded)} von ${fmtBytes(e.total)}, ${fmtBytes(e.loaded / sec)}/s)`;
    if (pct >= 100) label.textContent = `${what} – wird gespeichert …`;
  };
  xhr.onload = () => {
    done();
    let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 401) return showLogin();
    if (xhr.status >= 200 && xhr.status < 300) { toast(files.length === 1 ? 'Hochgeladen: ' + files[0].name : files.length + ' Dateien hochgeladen.'); if (dir === cwd) loadFiles(cwd); }
    else toast(r.error || 'Upload fehlgeschlagen (' + xhr.status + ')', 'err');
  };
  xhr.onerror = () => { done(); toast('Upload fehlgeschlagen – Verbindung unterbrochen.', 'err'); };
  xhr.onabort = () => { done(); toast('Upload abgebrochen.'); };
  xhr.open('POST', '/api/upload?path=' + encodeURIComponent(dir));
  xhr.send(fd);
  void total;
}
$('#upCancel').onclick = () => { if (upXhr) upXhr.abort(); };
$('#fUpload').onchange = (e) => { uploadFiles(e.target.files); e.target.value = ''; };
// Drag & Drop auf die Dateiseite
let dragDepth = 0;
const fileTabOpen = () => currentTab === 'files' && can('files');
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!fileTabOpen() || !hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropWhere').textContent = 'nach /' + cwd; $('#dropHint').classList.remove('hidden'); });
window.addEventListener('dragover', (e) => { if (fileTabOpen() && hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (!fileTabOpen()) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').classList.add('hidden'); });
window.addEventListener('drop', (e) => {
  if (!fileTabOpen() || !hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropHint').classList.add('hidden');
  const files = [], skipped = [];
  [...e.dataTransfer.items].forEach((it) => {
    const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (entry && entry.isDirectory) skipped.push(entry.name);
    else if (it.kind === 'file') files.push(it.getAsFile());
  });
  if (skipped.length) toast('Ordner lassen sich nicht hochladen (' + skipped.join(', ') + ') – bitte als .zip packen und hier entpacken.', 'err');
  uploadFiles(files.filter(Boolean));
});

let editPath = '';
async function openEditor(p) {
  try {
    const { content } = await api('GET', '/api/file?path=' + encodeURIComponent(p));
    editPath = p;
    $('#edName').textContent = '/' + p; $('#edMsg').textContent = '';
    $('#edText').value = content;
    $('#editor').showModal();
  } catch (e) { toast(e.message, 'err'); }
}
$('#edSave').onclick = act(async () => {
  await api('PUT', '/api/file', { path: editPath, content: $('#edText').value });
  $('#edMsg').textContent = t('Gespeichert') + ' ' + new Date().toLocaleTimeString(LOCALE);
});
$('#edText').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('#edSave').click(); }
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
});

/* ---------- Spieler ---------- */
const plAct = (action, name, reason) => act(() => api('POST', '/api/players/action', { action, name, reason }), 'Befehl gesendet.')().then(() => setTimeout(loadPlayers, 1200));
// Standard-Steve-Kopf (8x8 Pixel, als Fallback wenn kein Skin geladen werden kann)
const STEVE_HEAD = 'data:image/svg+xml,' + encodeURIComponent((() => {
  const pal = { H: '#4a3320', S: '#c68e6b', W: '#ffffff', B: '#4a4ad0', N: '#a06a4c', M: '#6b4530' };
  const rows = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SWBSSBWS', 'SSSNNSSS', 'SSMMMMSS', 'SSSSSSSS', 'SSSSSSSS'];
  const rects = rows.map((r, y) => [...r].map((c, x) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[c]}"/>`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${rects}</svg>`;
})());
// Bedrock-Spieler (Geyser/Floodgate): UUID beginnt mit 16 Nullen-Ziffern, Name hat meist das Präfix "."
const isBedrock = (name, uuid) => /^\./.test(name || '') || /^00000000-0000-0000-/i.test(uuid || '');
function bedrockHead(size) {
  const s = el('span', { className: 'head bedrock', title: 'Bedrock-Spieler' }, fa('fa-solid fa-gamepad'));
  s.style.width = s.style.height = size + 'px';
  s.style.fontSize = Math.round(size * 0.5) + 'px';
  return s;
}
function head(name, size = 28) {
  if (isBedrock(name)) return bedrockHead(size);
  const img = el('img', { className: 'head', alt: '', loading: 'lazy', width: size, height: size, referrerPolicy: 'no-referrer', src: 'https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/' + (size > 32 ? 64 : 32) });
  img.onerror = () => { img.onerror = null; img.src = STEVE_HEAD; };
  return img;
}
function plList(ul, items, buttons, emptyText = 'Keine') {
  ul.textContent = '';
  if (!items.length) return ul.append(el('li', { className: 'empty', textContent: emptyText }));
  items.forEach((it) => ul.append(el('li', {},
    el('span', { className: 'pl', title: it.bedrock ? it.name : '' }, it.bedrock ? bedrockHead(34) : head(it.name, 34),
      el('span', { className: 'pl-text' },
        el('span', { className: 'pl-name', textContent: it.bedrock ? it.label.replace(/^\./, '') : it.label }),
        (it.bedrock || it.sub) ? el('span', { className: 'pl-sub' },
          it.bedrock ? el('span', { className: 'bd' }, fa('fa-solid fa-gamepad'), 'Bedrock') : '',
          it.bedrock && it.sub ? ' · ' : '',
          it.sub || '') : '')),
    can('players.manage') ? el('span', {}, buttons(it)) : '')));
}
function renderOnline(list) {
  const stopped = lastStatus && lastStatus.state !== 'running';
  $('#cntOnline').textContent = list.length;
  plList($('#plOnline'), list.map((n) => ({ label: n, name: n, bedrock: isBedrock(n) })), (it) => [
    faBtn('fa-solid fa-right-from-bracket', 'Kick', () => openPlDlg('kick', it.name), 'sm warn'), ' ',
    faBtn('fa-solid fa-ban', 'Ban', () => openPlDlg('ban', it.name), 'sm danger'),
  ], stopped ? 'Server läuft nicht – in der Konsole starten' : 'Niemand online');
}
async function loadPlayers() {
  try {
    if (plView === 'stats') loadPlayerStats();
    const d = await api('GET', '/api/players');
    plData = d;
    renderOnline(d.online);
    $('#cntWhite').textContent = d.whitelist.length; $('#cntOps').textContent = d.ops.length; $('#cntBanned').textContent = d.banned.length;
    plList($('#plWhite'), d.whitelist.map((p) => ({ label: p.name, name: p.name, bedrock: isBedrock(p.name, p.uuid) })), (it) => faBtn('fa-solid fa-user-minus', 'Von der Whitelist entfernen', async () => {
      if (await uiConfirm('Von der Whitelist entfernen?', `„${it.name}“ kann danach nicht mehr beitreten, solange die Whitelist aktiv ist.`, { okText: 'Entfernen', danger: true, icon: 'fa-solid fa-user-minus' })) plAct(it.bedrock ? 'fwhitelist-remove' : 'whitelist-remove', it.name);
    }, 'sm'));
    plList($('#plOps'), d.ops.map((p) => ({ label: p.name, name: p.name, bedrock: isBedrock(p.name, p.uuid), sub: 'Level ' + p.level })), (it) => faBtn('fa-solid fa-arrow-down', 'OP entziehen', async () => {
      if (await uiConfirm('OP entziehen?', `„${it.name}“ verliert alle Operator-Rechte.`, { okText: 'OP entziehen', danger: true, icon: 'fa-solid fa-arrow-down' })) plAct('deop', it.name);
    }, 'sm'));
    plList($('#plBanned'), d.banned.map((p) => ({ label: p.name, name: p.name, bedrock: isBedrock(p.name, p.uuid) })), (it) => faBtn('fa-solid fa-unlock', 'Entbannen', async () => {
      if (await uiConfirm('Spieler entbannen?', `„${it.name}“ darf danach wieder beitreten.`, { okText: 'Entbannen', icon: 'fa-solid fa-unlock' })) plAct('pardon', it.name);
    }, 'sm'));
  } catch (e) { toast(e.message, 'err'); }
}
/* ---- Spieler-Dialog (Name eingeben / aus Dropdown wählen) ---- */
const PL_ACTIONS = {
  'whitelist-add': { title: 'Zur Whitelist hinzufügen', ok: 'Hinzufügen', cls: 'primary', onlineOnly: false, reason: false, mojang: true, suggest: false },
  op: { title: 'OP geben', ok: 'OP geben', cls: 'primary', onlineOnly: false, reason: false, mojang: true, suggest: true },
  kick: { title: 'Spieler kicken', ok: 'Kicken', cls: 'warn', onlineOnly: true, reason: true, mojang: false, suggest: true },
  ban: { title: 'Spieler bannen', ok: 'Bannen', cls: 'danger', onlineOnly: false, reason: true, mojang: true, suggest: true },
};
let plCur = null;
let plKind = 'java'; // nur bei „Whitelist“: java | bedrock
const isBedrockMode = () => !!plCur && plCur.action === 'whitelist-add' && plKind === 'bedrock';
const plDlg = $('#plDlg'), plInput = $('#plDlgName');

function plCandidates() {
  const online = lastStatus ? lastStatus.players : [];
  const out = online.map((name) => ({ name, online: true }));
  if (!plCur.onlineOnly) {
    const banned = new Set(plData.banned.map((p) => p.name.toLowerCase()));
    const seen = new Set(online.map((n) => n.toLowerCase()));
    [...plData.whitelist, ...plData.ops].forEach((p) => {
      const k = p.name.toLowerCase();
      if (!seen.has(k) && !banned.has(k)) { seen.add(k); out.push({ name: p.name, online: false }); }
    });
  }
  return out;
}
// Mojang-Abgleich (Name existiert? + Kopf), entprellt
let mjTimer = null, mjSeq = 0;
function checkMojang() {
  clearTimeout(mjTimer);
  const box = $('#plDlgMj');
  const name = plInput.value.trim();
  if (!plCur || !(plCur.mojang || isBedrockMode()) || !name) { box.classList.add('hidden'); mjSeq++; return; }
  box.classList.remove('hidden');
  if (isBedrockMode()) return checkBedrock(name.replace(/^\./, ''));
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    mjSeq++;
    return mjShow('warn', null, 'Kein gültiger Java-Name', 'Nur Buchstaben, Ziffern und _ (3–16 Zeichen). Bedrock-/Offline-Namen kannst du trotzdem eintragen.');
  }
  mjShow('', null, 'Prüfe bei Mojang…', '');
  const seq = ++mjSeq;
  mjTimer = setTimeout(async () => {
    let r;
    try { r = await api('GET', '/api/mojang/' + encodeURIComponent(name)); } catch { r = { status: 'unavailable' }; }
    if (seq !== mjSeq) return; // veraltete Antwort
    if (r.status === 'found') mjShow('ok', r.uuid, r.name, 'Existiert bei Mojang · UUID ' + r.uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'));
    else if (r.status === 'notfound') mjShow('bad', null, name, 'Diesen Spieler gibt es bei Mojang nicht. (Bei Servern mit online-mode=false trotzdem möglich.)');
    else mjShow('warn', null, name, 'Mojang gerade nicht erreichbar – Prüfung nicht möglich.');
  }, 350);
}
// Bedrock: Gamertag bei Xbox (über GeyserMC) nachschlagen
function checkBedrock(name) {
  if (!/^[A-Za-z0-9_ ]{1,16}$/.test(name)) { mjSeq++; return mjShow('warn', '*bedrock', 'Kein gültiger Gamertag', 'Buchstaben, Ziffern, _ und Leerzeichen (max. 16 Zeichen).'); }
  mjShow('', null, 'Prüfe bei Xbox …', '');
  const seq = ++mjSeq;
  mjTimer = setTimeout(async () => {
    let r;
    try { r = await api('GET', '/api/bedrock/' + encodeURIComponent(name)); } catch { r = { status: 'unavailable' }; }
    if (seq !== mjSeq) return;
    if (r.status === 'found') mjShow('ok', '*bedrock', name, 'Xbox-Konto gefunden · XUID ' + r.xuid);
    else if (r.status === 'notfound') mjShow('warn', '*bedrock', name, 'Gamertag nicht gefunden (oder nicht im Cache). Floodgate prüft beim Eintragen selbst.');
    else mjShow('warn', '*bedrock', name, 'Xbox-Prüfung gerade nicht möglich.');
  }, 350);
}
function applyKind() {
  const b = isBedrockMode();
  $('#plDlgNameLbl').textContent = b ? 'Bedrock-Name (Gamertag)' : 'Spielername';
  plInput.placeholder = b ? 'z. B. PocketAlex (ohne Punkt)' : 'Name eingeben oder unten auswählen';
  const hint = $('#plDlgHint');
  hint.classList.toggle('hidden', !b);
  hint.textContent = b ? 'Wird mit dem Floodgate-Befehl /fwhitelist eingetragen. Floodgate (Geyser) muss dafür auf dem Server installiert sein.' : '';
  $$('#plDlgKind button').forEach((x) => x.classList.toggle('active', x.dataset.k === plKind));
}
$('#plDlgKind').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  plKind = b.dataset.k;
  applyKind(); renderSug(); checkMojang(); plInput.focus();
});
function mjShow(cls, skin, title, sub) {
  const box = $('#plDlgMj');
  box.className = 'mj ' + cls;
  box.textContent = '';
  if (skin === '*bedrock') box.append(bedrockHead(40));
  else if (skin) box.append(head(skin, 40));
  else if (cls === 'bad') box.append(el('img', { className: 'head', alt: '', width: 40, height: 40, src: STEVE_HEAD }));
  box.append(el('div', { className: 'mj-text' }, el('b', { textContent: title }), sub ? el('small', { textContent: sub }) : ''));
}
function renderSug() {
  if (!plCur) return;
  const q = plInput.value.trim().toLowerCase();
  const box = $('#plDlgSug'); box.textContent = '';
  box.classList.toggle('hidden', !plCur.suggest);
  if (!plCur.suggest) return;
  const list = plCandidates().filter((c) => c.name.toLowerCase().includes(q));
  if (!list.length) {
    const none = plCur.onlineOnly && !(lastStatus && lastStatus.players.length);
    box.append(el('div', { className: 'sug-empty', textContent: none
      ? 'Niemand online – Namen trotzdem eintippen.'
      : q ? 'Kein Treffer – Namen einfach eintippen (der Spieler muss nicht online sein).' : 'Keine Spieler bekannt – Namen eintippen.' }));
    return;
  }
  const add = (label, items) => {
    if (!items.length) return;
    box.append(el('div', { className: 'sug-label', textContent: label }));
    items.forEach((c) => box.append(el('button', { type: 'button', className: 'sug-item', onclick: () => { plInput.value = c.name; renderSug(); checkMojang(); plInput.focus(); } },
      head(c.name), el('span', { textContent: c.name }), el('span', { className: 'tag', textContent: c.online ? '' : 'bekannt' }))));
  };
  add('Online', list.filter((c) => c.online));
  add('Bekannt', list.filter((c) => !c.online));
}
function openPlDlg(action, name = '') {
  plCur = { action, ...PL_ACTIONS[action] };
  plKind = 'java';
  $('#plDlgKind').classList.toggle('hidden', action !== 'whitelist-add');
  $('#plDlgTitle').textContent = plCur.title;
  $('#plDlgReasonWrap').classList.toggle('hidden', !plCur.reason);
  $('#plDlgReason').value = '';
  $('#plDlgErr').textContent = '';
  const ok = $('#plDlgOk'); ok.textContent = plCur.ok; ok.className = 'btn ' + plCur.cls; ok.disabled = false;
  plInput.value = name;
  $('#plDlgMj').classList.add('hidden');
  applyKind();
  renderSug();
  checkMojang();
  plDlg.showModal();
  plInput.focus();
  plInput.select();
}
plInput.addEventListener('input', () => { renderSug(); checkMojang(); });
$('#plDlgCancel').onclick = () => plDlg.close();
plDlg.addEventListener('close', () => { plCur = null; });
$('#plDlgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = plInput.value.trim();
  const bedrock = isBedrockMode();
  const nameOk = bedrock ? /^\.?[A-Za-z0-9_ ]{1,16}$/.test(name) : /^[A-Za-z0-9_.]{1,16}$/.test(name);
  if (!nameOk) { $('#plDlgErr').textContent = bedrock ? 'Bitte einen gültigen Gamertag eingeben (max. 16 Zeichen: Buchstaben, Ziffern, _ und Leerzeichen).' : 'Bitte einen gültigen Spielernamen eingeben (max. 16 Zeichen: Buchstaben, Ziffern, _ .).'; return; }
  const ok = $('#plDlgOk'); ok.disabled = true;
  try {
    await api('POST', '/api/players/action', { action: bedrock ? 'fwhitelist-add' : plCur.action, name, reason: plCur.reason ? $('#plDlgReason').value : '' });
    toast(`${plCur.title}: ${name}`);
    plDlg.close();
    setTimeout(loadPlayers, 1200);
  } catch (err) {
    $('#plDlgErr').textContent = err.message;
    ok.disabled = false;
  }
});
$('#plActions').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (b) openPlDlg(b.dataset.a);
});

/* ---------- Backups ---------- */
function renderBkInfo(items, disk, copy) {
  const box = $('#bkInfo'); box.textContent = '';
  if (disk) {
    const usedPct = ((disk.total - disk.free) / disk.total) * 100;
    box.append(el('div', { className: 'bk-disk' },
      el('div', { className: 'bk-disk-row' }, fa('fa-solid fa-hard-drive'), el('b', {}, `${fmtBytes(disk.free)} frei`), el('span', { className: 'muted', textContent: ` von ${fmtBytes(disk.total)} · Backups belegen ${fmtBytes(disk.used)}` })),
      el('div', { className: barLevel(usedPct, 80, 92), style: 'margin-top:8px' }, el('span', { style: `width:${usedPct.toFixed(1)}%` }))));
  }
  const last = copy && copy.last;
  box.append(el('div', { className: 'bk-copy' },
    fa(copy && copy.target ? (last && !last.ok ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-cloud-arrow-up') : 'fa-regular fa-copy'),
    copy && copy.target
      ? el('span', {}, 'Kopie nach ', el('code', { textContent: copy.target }), last ? (last.ok ? ` – zuletzt ok (${fmtDate(last.t)})` : ` – zuletzt fehlgeschlagen: ${last.msg}`) : ' – noch nichts kopiert')
      : el('span', { className: 'muted', textContent: 'Keine Kopie an einen zweiten Ort eingerichtet (unter „Panel“ einstellbar).' })));
  if (last && !last.ok) box.lastChild.classList.add('bad');
}
async function loadBackups() {
  try {
    const { items, disk, copy } = await api('GET', '/api/backups');
    renderBkInfo(items, disk, copy);
    const t = $('#bkTable'); t.textContent = '';
    t.append(el('tr', {}, ...['Datei', 'Größe', 'Erstellt', ''].map((x) => el('th', { textContent: x }))));
    if (!items.length) {
      t.append(el('tr', {}, el('td', { colSpan: 4, className: 'bk-empty' }, fa('fa-regular fa-folder-open'), 'Noch keine Backups vorhanden.')));
    }
    items.forEach((b) => {
      const enc = encodeURIComponent(b.name);
      const dl = el('a', { className: 'btn ic', title: 'Herunterladen', href: `/api/backups/${enc}/download` }, fa('fa-solid fa-download'));
      dl.setAttribute('aria-label', 'Herunterladen');
      t.append(el('tr', {},
        el('td', {}, el('span', { className: 'bk-name' }, fa('fa-solid fa-file-zipper'), b.name)),
        el('td', { className: 'bk-meta' }, fa('fa-solid fa-hard-drive'), fmtBytes(b.size)),
        el('td', { className: 'bk-meta' }, fa('fa-regular fa-clock'), fmtDate(b.mtime)),
        el('td', { className: 'act' },
          dl, ' ',
          faBtn('fa-solid fa-shield-halved', 'Archiv prüfen (Integrität)', act(async () => {
            await api('POST', `/api/backups/${enc}/verify`);
          }, 'Das Archiv ist in Ordnung.')), ' ',
          faBtn('fa-solid fa-clock-rotate-left', 'Wiederherstellen', () => openRestoreDlg(b), 'warn'), ' ',
          faBtn('fa-solid fa-trash', 'Löschen', act(async () => {
            if (!(await uiConfirm('Backup löschen?', `„${b.name}“ wird unwiderruflich gelöscht.`, { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
            await api('DELETE', `/api/backups/${enc}`); loadBackups();
          }), 'danger'))));
    });
    if (!can('backups.manage')) $$('#bkTable td.act').forEach((td) => { td.textContent = ''; });
  } catch (e) { toast(e.message, 'err'); }
}
$('#cBkCopyTest').onclick = act(async () => {
  await api('POST', '/api/backups/copy-test', { target: $('#cBkCopy').value.trim() });
}, 'Das Ziel ist erreichbar und beschreibbar.');
/* ---------- Backup wiederherstellen: alles oder Auswahl ---------- */
const rsDlg = $('#rsDlg');
let rsBackup = null, rsMode = 'all', rsTree = null, rsSel = new Set(), rsKids = new Map(), rsOpen = new Set();
const rsNum = (n) => n.toLocaleString(LOCALE);
function rsSelectionPaths() {
  const out = [];
  (rsTree ? rsTree.entries : []).forEach((t) => {
    if (rsSel.has(t.path)) out.push(t.path);
    else (rsKids.get(t.path) || []).forEach((k) => out.push(k));
  });
  return out;
}
function renderRsTree() {
  const box = $('#rsTree'); box.textContent = '';
  rsTree.entries.forEach((t) => {
    const whole = rsSel.has(t.path), kidsSel = rsKids.get(t.path) || new Set();
    const cb = el('input', { type: 'checkbox', checked: whole });
    cb.indeterminate = !whole && kidsSel.size > 0;
    cb.onchange = () => { if (cb.checked) { rsSel.add(t.path); rsKids.delete(t.path); } else rsSel.delete(t.path); renderRsTree(); };
    const toggle = t.kids.length
      ? el('button', { type: 'button', className: 'rs-tg', title: 'Aufklappen', onclick: () => { if (rsOpen.has(t.path)) rsOpen.delete(t.path); else rsOpen.add(t.path); renderRsTree(); } }, fa(rsOpen.has(t.path) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'))
      : el('span', { className: 'rs-tg' });
    box.append(el('div', { className: 'rs-row' }, toggle, cb, fileIcon({ dir: t.dir, name: t.name }), el('span', { className: 'rs-name', textContent: t.name }),
      el('span', { className: 'rs-cnt', textContent: t.dir ? `${rsNum(t.files)} Dateien` : '' })));
    if (!rsOpen.has(t.path)) return;
    t.kids.forEach((k) => {
      const kc = el('input', { type: 'checkbox', checked: whole || kidsSel.has(k.path), disabled: whole });
      kc.onchange = () => {
        const s = new Set(rsKids.get(t.path) || []);
        if (kc.checked) s.add(k.path); else s.delete(k.path);
        if (s.size) rsKids.set(t.path, s); else rsKids.delete(t.path);
        renderRsTree();
      };
      box.append(el('div', { className: 'rs-row kid' }, kc, fileIcon({ dir: k.dir, name: k.name }), el('span', { className: 'rs-name', textContent: k.name }),
        el('span', { className: 'rs-cnt', textContent: k.dir ? `${rsNum(k.files)} Dateien` : '' })));
    });
    if (t.more) box.append(el('div', { className: 'rs-more', textContent: '… weitere Einträge (hier lässt sich nur der ganze Ordner wählen)' }));
  });
  const n = rsSelectionPaths().length;
  $('#rsOk').textContent = n ? `${n} ${n === 1 ? 'Eintrag' : 'Einträge'} wiederherstellen` : 'Auswahl wiederherstellen';
}
async function applyRsMode() {
  $$('#rsMode button').forEach((x) => x.classList.toggle('active', x.dataset.m === rsMode));
  $('#rsAllHint').classList.toggle('hidden', rsMode !== 'all');
  $('#rsPick').classList.toggle('hidden', rsMode !== 'pick');
  $('#rsErr').textContent = '';
  if (rsMode === 'all') { $('#rsOk').textContent = 'Alles wiederherstellen'; return; }
  if (rsTree) return renderRsTree();
  $('#rsTree').textContent = '';
  $('#rsTree').append(el('div', { className: 'rs-load' }, fa('fa-solid fa-spinner fa-spin'), ' Backup wird gelesen … (bei großen Welten kann das etwas dauern)'));
  try {
    rsTree = await api('GET', `/api/backups/${encodeURIComponent(rsBackup.name)}/contents`);
    if (rsMode === 'pick') renderRsTree();
  } catch (e) { $('#rsErr').textContent = e.message; $('#rsTree').textContent = ''; }
}
function openRestoreDlg(b) {
  rsBackup = b; rsMode = 'all'; rsTree = null; rsSel = new Set(); rsKids = new Map(); rsOpen = new Set();
  $('#rsName').textContent = `${b.name} · ${fmtDate(b.mtime)} · ${fmtBytes(b.size)}`;
  applyRsMode();
  rsDlg.showModal();
}
$('#rsMode').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-m]');
  if (!btn) return;
  rsMode = btn.dataset.m;
  applyRsMode();
});
$('#rsCancel').onclick = () => rsDlg.close();
$('#rsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  if (rsMode === 'pick') {
    body.paths = rsSelectionPaths();
    if (!body.paths.length) { $('#rsErr').textContent = 'Bitte mindestens einen Ordner oder eine Datei auswählen.'; return; }
  }
  const ok = $('#rsOk'); ok.disabled = true;
  try {
    const r = await api('POST', `/api/backups/${encodeURIComponent(rsBackup.name)}/restore`, body);
    rsDlg.close();
    toast(r.note);
    loadBackups();
  } catch (err) { $('#rsErr').textContent = err.message; }
  ok.disabled = false;
});

const setBtn = (b, icon, text) => { b.textContent = ''; b.append(fa(icon), ' ' + text); };
$('#bkCreate').onclick = async () => {
  const b = $('#bkCreate'); b.disabled = true; setBtn(b, 'fa-solid fa-spinner fa-spin', 'Backup läuft…');
  await act(() => api('POST', '/api/backups'), (r) => 'Backup erstellt: ' + r.name)();
  b.disabled = false; setBtn(b, 'fa-solid fa-plus', 'Backup jetzt erstellen'); loadBackups();
};

/* ---------- Installation ---------- */
const INSTALL_HINT = {
  paper: 'Schneller Server mit Plugins (Bukkit/Spigot). Für die meisten die beste Wahl.',
  purpur: 'Fork von Paper mit vielen zusätzlichen Einstellungen. Plugins wie bei Paper.',
  folia: 'Paper-Fork, der die Welt auf mehrere CPU-Kerne verteilt. Nur für sehr große Server; Plugins müssen Folia unterstützen.',
  forge: 'Für Forge-Mods (ab Minecraft 1.17.1). Die Installation dauert ein bis drei Minuten; den Fortschritt siehst du in der Konsole. Mods kommen in den Ordner „mods“.',
  neoforge: 'Für NeoForge-Mods (der Nachfolger von Forge). Die Installation dauert ein bis drei Minuten; den Fortschritt siehst du in der Konsole. Mods kommen in den Ordner „mods“.',
  fabric: 'Für Mods (Fabric). Mods kommen in den Ordner „mods“ (Dateien → Hochladen). Beim ersten Start lädt Fabric Minecraft nach.',
  vanilla: 'Der Original-Server von Mojang, ohne Plugins und Mods.',
};
const updateInstallHint = () => { $('#inHint').textContent = INSTALL_HINT[$('#inType').value] || ''; };
async function loadInstall() {
  updateInstallHint();
  api('GET', '/api/eula').then((d) => { $('#eulaBox').checked = d.accepted; }).catch(() => {});
  await loadVersions();
}
async function loadVersions() {
  const sel = $('#inVersion');
  sel.textContent = ''; sel.append(el('option', { textContent: 'Lade…' }));
  try {
    const { versions } = await api('GET', '/api/versions?type=' + $('#inType').value);
    sel.textContent = '';
    versions.forEach((v) => sel.append(typeof v === 'string' ? el('option', { value: v, textContent: v }) : el('option', { value: v.value, textContent: v.label })));
  } catch (e) { sel.textContent = ''; toast(e.message, 'err'); }
}
$('#inType').onchange = () => { updateInstallHint(); loadVersions(); };
$('#inGo').onclick = async () => {
  const b = $('#inGo'), v = $('#inVersion').value;
  if (!v) return;
  const type = $('#inType').value;
  b.disabled = true; setBtn(b, 'fa-solid fa-spinner fa-spin', ['forge', 'neoforge'].includes(type) ? 'Installiere … (dauert einige Minuten)' : 'Lade herunter…');
  await act(() => api('POST', '/api/install', { type, version: v }), ['fabric', 'forge', 'neoforge'].includes(type) ? 'Installiert. Mods kommen in den Ordner „mods“. Jetzt EULA akzeptieren und starten.' : 'Installiert. Jetzt EULA akzeptieren und Server starten.')();
  b.disabled = false; setBtn(b, 'fa-solid fa-download', 'Herunterladen & installieren');
};
$('#eulaSave').onclick = act(() => {
  if (!$('#eulaBox').checked) throw new Error('Bitte EULA ankreuzen.');
  return api('POST', '/api/eula', { accept: true });
}, 'EULA gespeichert.');

/* ---------- Panel-Config ---------- */
// Liste von Uhrzeiten als Chips mit Hinzufügen/Entfernen (für Neustart- und Backup-Zeiten)
function createTimeList(boxSel, inputSel, addSel, emptyText) {
  let times = [];
  const box = $(boxSel);
  const render = () => {
    box.textContent = '';
    if (!times.length) return box.append(el('span', { className: 'muted', textContent: emptyText }));
    times.forEach((t) => box.append(el('span', { className: 'time-chip' }, fa('fa-regular fa-clock'), t,
      el('button', { type: 'button', title: 'Entfernen', onclick: () => { times = times.filter((x) => x !== t); render(); } }, fa('fa-solid fa-xmark')))));
  };
  $(addSel).onclick = () => {
    const v = $(inputSel).value;
    if (!/^\d{2}:\d{2}$/.test(v)) return toast('Bitte eine Uhrzeit wählen.', 'err');
    if (!times.includes(v)) { times.push(v); times.sort(); render(); }
  };
  return { get: () => times, set: (v) => { times = [...(v || [])]; render(); } };
}
const restartTimesUI = createTimeList('#cTimes', '#cTimeNew', '#cTimeAdd', 'Kein geplanter Neustart');
const backupTimesUI = createTimeList('#cbTimes', '#cbTimeNew', '#cbTimeAdd', 'Keine festen Backup-Zeiten');
async function loadConfig() {
  try {
    const c = await api('GET', '/api/config');
    window.panelClean && window.panelClean();
    $('#cJava').value = c.javaPath; $('#cJar').value = c.jarFile; $('#cMin').value = c.memMin; $('#cMax').value = c.memMax;
    $('#cExtra').value = c.extraArgs; $('#cBkH').value = c.backupIntervalHours; $('#cBkK').value = c.backupKeep;
    $('#cPort').value = c.port; $('#cAuto').checked = c.autoRestart;
    $('#cJarHint').textContent = c.launchArgsFile ? 'Wird derzeit über die Forge/NeoForge-Startdatei gestartet; diese JAR wird dann nicht benutzt.' : 'Dateiname im Server-Ordner';
    restartTimesUI.set(c.restartTimes); backupTimesUI.set(c.backupTimes);
    $('#cBkEx').value = (c.backupExclude || []).join('\n'); $('#cBkCopy').value = c.backupCopy || '';
    $('#cWarn').checked = c.restartWarn !== false;
    $('#cNow').textContent = $('#cNow2').textContent = (LANG === "en" ? `${c.serverTime}, ${c.serverTz}` : `${c.serverTime} Uhr, ${c.serverTz}`);
  } catch (e) { toast(e.message, 'err'); }
}
$('#cSave').onclick = act(() => api('PUT', '/api/config', {
  javaPath: $('#cJava').value.trim(), jarFile: $('#cJar').value.trim(), memMin: $('#cMin').value.trim(), memMax: $('#cMax').value.trim(),
  extraArgs: $('#cExtra').value, backupIntervalHours: $('#cBkH').value, backupKeep: $('#cBkK').value, port: $('#cPort').value, autoRestart: $('#cAuto').checked, restartTimes: restartTimesUI.get(), restartWarn: $('#cWarn').checked, backupTimes: backupTimesUI.get(), backupExclude: $('#cBkEx').value.split('\n'), backupCopy: $('#cBkCopy').value.trim(),
}).then((r) => { if (r) window.panelClean && window.panelClean(); return r; }), (r) => r && 'Gespeichert. ' + r.note);
/* ---------- Minecraft-Account verknüpfen ---------- */
const mcDlg = $('#mcDlg'), mcInput = $('#mcName'), mcBox = $('#mcMj');
let mcTarget = null, mcTimer = null, mcSeq = 0;
function mcShow(cls, skin, title, sub) {
  mcBox.className = 'mj ' + cls;
  mcBox.textContent = '';
  if (skin) mcBox.append(head(skin, 40));
  else if (cls === 'bad') mcBox.append(el('img', { className: 'head', alt: '', width: 40, height: 40, src: STEVE_HEAD }));
  mcBox.append(el('div', { className: 'mj-text' }, el('b', { textContent: title }), sub ? el('small', { textContent: sub }) : ''));
}
function mcCheck() {
  clearTimeout(mcTimer);
  const name = mcInput.value.trim();
  mcSeq++;
  if (!name) { mcBox.classList.add('hidden'); return; }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return mcShow('warn', null, 'Kein gültiger Minecraft-Name', 'Nur Buchstaben, Ziffern und _ (3–16 Zeichen).');
  mcShow('', null, 'Prüfe bei Mojang…', '');
  const seq = mcSeq;
  mcTimer = setTimeout(async () => {
    let r;
    try { r = await api('GET', '/api/mojang/' + encodeURIComponent(name)); } catch { r = { status: 'unavailable' }; }
    if (seq !== mcSeq) return;
    if (r.status === 'found') mcShow('ok', r.uuid, r.name, 'Existiert bei Mojang · UUID ' + r.uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'));
    else if (r.status === 'notfound') mcShow('bad', null, name, 'Diesen Minecraft-Account gibt es nicht.');
    else mcShow('warn', null, name, 'Mojang gerade nicht erreichbar – Prüfung nicht möglich.');
  }, 350);
}
function openMcDlg(target) {
  mcTarget = target;
  $('#mcTitle').textContent = target.self ? 'Mein Minecraft-Account' : 'Minecraft-Account für ' + target.username;
  $('#mcErr').textContent = '';
  mcInput.value = target.current ? target.current.name : '';
  $('#mcRemove').classList.toggle('hidden', !target.current);
  $('#mcOk').disabled = false;
  mcBox.classList.add('hidden');
  mcCheck();
  mcDlg.showModal();
  mcInput.focus(); mcInput.select();
}
async function saveMc(name) {
  const t = mcTarget;
  const url = t.self ? '/api/me/minecraft' : '/api/users/' + encodeURIComponent(t.username);
  await api('PUT', url, { minecraft: name });
  mcDlg.close();
  toast(name ? 'Minecraft-Account verknüpft.' : 'Verknüpfung entfernt.');
  if (t.self || t.username === myName) { renderWhoami(await api('GET', '/api/me')); renderAcc(); }
  if (currentTab === 'users') loadUsers();
}
mcInput.addEventListener('input', mcCheck);
$('#mcCancel').onclick = () => mcDlg.close();
$('#mcRemove').onclick = async () => { try { await saveMc(''); } catch (e) { $('#mcErr').textContent = e.message; } };
$('#mcForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = mcInput.value.trim();
  if (!name) { $('#mcErr').textContent = 'Bitte einen Minecraft-Namen eingeben.'; return; }
  $('#mcOk').disabled = true;
  try { await saveMc(name); } catch (err) { $('#mcErr').textContent = err.message; $('#mcOk').disabled = false; }
});

/* ---------- Eigenes Passwort ---------- */
function renderAcc() {
  const h = $('#accHead'); h.textContent = '';
  if (myMc) h.append(head(myMc.uuid, 44));
  else h.append(el('span', { className: 'ph' }, fa('fa-solid fa-user')));
  $('#accMcName').textContent = myMc ? myMc.name : 'Kein Minecraft-Account verknüpft';
  setBtn($('#accMcBtn'), 'fa-solid fa-link', myMc ? 'Ändern' : 'Verknüpfen');
}
const openPwDlg = () => { $('#pwCur').value = ''; $('#pwNew').value = ''; $('#pwErr').textContent = ''; renderAcc(); loadTf(); $('#pwDlg').showModal(); };
$('#whoami').onclick = () => showTab('account');
$('#accMcBtn').onclick = () => openMcDlg({ self: true, current: myMc });

/* ---------- Zwei-Faktor-Anmeldung (Konto-Dialog) ---------- */
let tfOn = false;
async function loadTf() {
  try {
    const d = await api('GET', '/api/me/2fa');
    tfOn = d.enabled;
    $('#tfState').textContent = d.enabled ? 'Aktiv' : 'Nicht eingerichtet';
    $('#tfSmall').textContent = d.enabled ? `Noch ${d.recoveryLeft} Wiederherstellungscodes übrig.` : 'Schützt dein Konto zusätzlich mit einem Code aus einer Authenticator-App.';
    $('#tfBtn').textContent = d.enabled ? 'Deaktivieren' : 'Einrichten';
    $('#tfRecBtn').classList.toggle('hidden', !d.enabled);
  } catch { $('#tfState').textContent = 'Nicht verfügbar'; }
}
function showTfCodes(codes) {
  $('#tfStep1').classList.add('hidden'); $('#tfStep2').classList.remove('hidden');
  const box = $('#tfCodes'); box.textContent = '';
  codes.forEach((c) => box.append(el('code', { textContent: c })));
  $('#tfCopy').onclick = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes kopiert.'); } catch { toast('Kopieren nicht möglich – bitte von Hand abschreiben.', 'err'); } };
  if (!$('#tfDlg').open) $('#tfDlg').showModal();
}
$('#tfBtn').onclick = act(async () => {
  if (tfOn) {
    const password = await uiPrompt('Zwei-Faktor deaktivieren', { label: 'Dein Passwort', type: 'password', required: true }, { okText: 'Weiter', icon: 'fa-solid fa-shield-halved' });
    if (!password) return;
    const code = await uiPrompt('Zwei-Faktor deaktivieren', { label: 'Code aus der App (oder Wiederherstellungscode)', required: true }, { okText: 'Deaktivieren', danger: true, icon: 'fa-solid fa-shield-halved' });
    if (!code) return;
    await api('POST', '/api/me/2fa/disable', { password, code });
    toast('Zwei-Faktor-Anmeldung deaktiviert.');
    return loadTf();
  }
  const password = await uiPrompt('Zwei-Faktor einrichten', { label: 'Zur Sicherheit: dein Passwort', type: 'password', required: true }, { okText: 'Weiter', icon: 'fa-solid fa-shield-halved' });
  if (!password) return;
  const s = await api('POST', '/api/me/2fa/setup', { password });
  $('#tfQr').innerHTML = s.svg; // SVG kommt vom eigenen Server
  $('#tfSecret').textContent = s.secret;
  $('#tfCode').value = ''; $('#tfErr').textContent = '';
  $('#tfStep1').classList.remove('hidden'); $('#tfStep2').classList.add('hidden');
  $('#tfDlg').showModal(); $('#tfCode').focus();
});
$('#tfRecBtn').onclick = act(async () => {
  const password = await uiPrompt('Neue Wiederherstellungscodes', { label: 'Dein Passwort', type: 'password', required: true }, { okText: 'Weiter', icon: 'fa-solid fa-life-ring' });
  if (!password) return;
  const code = await uiPrompt('Neue Wiederherstellungscodes', { label: 'Code aus der App (die alten Codes werden ungültig)', required: true }, { okText: 'Erzeugen', icon: 'fa-solid fa-life-ring' });
  if (!code) return;
  const r = await api('POST', '/api/me/2fa/recovery', { password, code });
  showTfCodes(r.recovery); loadTf();
});
$('#tfCancel').onclick = () => $('#tfDlg').close();
$('#tfDone').onclick = () => { $('#tfDlg').close(); loadTf(); };
$('#tfForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('#tfStep2').classList.contains('hidden')) return;
  try {
    const r = await api('POST', '/api/me/2fa/enable', { code: $('#tfCode').value });
    showTfCodes(r.recovery); loadTf();
  } catch (err) { $('#tfErr').textContent = err.message; }
});
$('#pwCancel').onclick = () => $('#pwDlg').close();
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/password', { current: $('#pwCur').value, next: $('#pwNew').value });
    showLogin();
  } catch (err) { $('#pwErr').textContent = err.message; }
});

/* ---------- Protokoll ---------- */
// action -> [Icon, Text, Warnung?]
const AUDIT = {
  login: ['fa-solid fa-right-to-bracket', 'Angemeldet'], login_discord: ['fa-brands fa-discord', 'Mit Discord angemeldet'],
  login_failed: ['fa-solid fa-triangle-exclamation', 'Anmeldung fehlgeschlagen', true], logout: ['fa-solid fa-right-from-bracket', 'Abgemeldet'],
  server_start: ['fa-solid fa-play', 'Server gestartet'], server_stop: ['fa-solid fa-stop', 'Server gestoppt'], server_restart: ['fa-solid fa-rotate', 'Server neu gestartet'],
  server_kill: ['fa-solid fa-skull-crossbones', 'Server hart beendet (Kill)', true], server_crash: ['fa-solid fa-burst', 'Server abgestürzt', true],
  command: ['fa-solid fa-terminal', 'Konsolenbefehl'],
  player_whitelist_add: ['fa-solid fa-list-check', 'Zur Whitelist hinzugefügt'], player_whitelist_remove: ['fa-solid fa-user-minus', 'Von der Whitelist entfernt'],
  player_fwhitelist_add: ['fa-solid fa-gamepad', 'Bedrock zur Whitelist hinzugefügt'], player_fwhitelist_remove: ['fa-solid fa-gamepad', 'Bedrock von der Whitelist entfernt'],
  player_op: ['fa-solid fa-crown', 'OP gegeben'], player_deop: ['fa-solid fa-arrow-down', 'OP entzogen'], player_kick: ['fa-solid fa-right-from-bracket', 'Spieler gekickt'],
  player_ban: ['fa-solid fa-ban', 'Spieler gebannt'], player_pardon: ['fa-solid fa-unlock', 'Spieler entbannt'],
  player_ban_ip: ['fa-solid fa-ban', 'IP gebannt'], player_pardon_ip: ['fa-solid fa-unlock', 'IP entbannt'],
  file_save: ['fa-solid fa-floppy-disk', 'Datei gespeichert'], file_delete: ['fa-solid fa-trash', 'Datei/Ordner gelöscht'], file_mkdir: ['fa-solid fa-folder-plus', 'Ordner angelegt'],
  file_rename: ['fa-solid fa-pen', 'Umbenannt'], file_upload: ['fa-solid fa-upload', 'Dateien hochgeladen'],
  file_archive: ['fa-solid fa-file-zipper', 'Dateien als Archiv geladen'], file_extract: ['fa-solid fa-box-open', 'Archiv entpackt'],
  props_save: ['fa-solid fa-sliders', 'Spiel-Einstellungen geändert'], config_save: ['fa-solid fa-gear', 'Panel-Einstellungen geändert'],
  discord_config: ['fa-brands fa-discord', 'Discord-Login konfiguriert'], webhook_config: ['fa-solid fa-bell', 'Discord-Benachrichtigungen geändert'], webhook_test: ['fa-solid fa-paper-plane', 'Discord-Testnachricht gesendet'],
  mod_install: ['fa-solid fa-puzzle-piece', 'Mod/Plugin installiert'], mod_remove: ['fa-solid fa-puzzle-piece', 'Mod/Plugin entfernt'],
  backup_verify: ['fa-solid fa-shield-halved', 'Backup geprüft'], backup_copy_test: ['fa-solid fa-plug', 'Kopierziel getestet'], backup_copy_failed: ['fa-solid fa-triangle-exclamation', 'Backup-Kopie fehlgeschlagen', true], eula_accept: ['fa-solid fa-file-signature', 'EULA akzeptiert'], install: ['fa-solid fa-cloud-arrow-down', 'Server-Software installiert'],
  backup_create: ['fa-solid fa-box-archive', 'Backup erstellt'], backup_delete: ['fa-solid fa-trash', 'Backup gelöscht'], backup_restore: ['fa-solid fa-clock-rotate-left', 'Backup wiederhergestellt'],
  user_create: ['fa-solid fa-user-plus', 'Benutzer angelegt'], user_delete: ['fa-solid fa-user-minus', 'Benutzer gelöscht'], user_role: ['fa-solid fa-user-shield', 'Rolle geändert'],
  user_denied: ['fa-solid fa-lock', 'Zugriff verweigert', true], role_create: ['fa-solid fa-user-tag', 'Rolle angelegt'], role_update: ['fa-solid fa-user-tag', 'Rolle geändert'], role_delete: ['fa-solid fa-user-tag', 'Rolle gelöscht'],
  user_rename: ['fa-solid fa-pen', 'Benutzer umbenannt'], user_password: ['fa-solid fa-key', 'Passwort gesetzt'], password_change: ['fa-solid fa-key', 'Eigenes Passwort geändert'],
  user_2fa_enable: ['fa-solid fa-shield-halved', 'Zwei-Faktor aktiviert'], user_2fa_disable: ['fa-solid fa-shield-halved', 'Zwei-Faktor deaktiviert', true], user_2fa_reset: ['fa-solid fa-shield-halved', 'Zwei-Faktor zurückgesetzt', true], user_2fa_recovery: ['fa-solid fa-life-ring', 'Neue Wiederherstellungscodes'],
  user_discord: ['fa-brands fa-discord', 'Discord-ID geändert'], user_notify: ['fa-solid fa-bell', 'Benachrichtigungen geändert'], log_download: ['fa-solid fa-scroll', 'Logdatei geladen'], user_minecraft: ['fa-solid fa-cube', 'Minecraft-Account geändert'],
};
const AU_PAGE = 100;
let auOffset = 0, auTimer = null;
function auditRow(e) {
  const [icon, label, bad] = AUDIT[e.action] || ['fa-solid fa-circle-info', e.action];
  return el('div', { className: 'au-row' },
    el('span', { className: 'au-ic cat-' + e.cat }, fa(icon)),
    el('div', { className: 'au-main' }, el('b', { className: bad ? 'bad' : '', textContent: label }), e.detail ? el('span', { className: 'au-detail', textContent: e.detail }) : ''),
    el('div', { className: 'au-meta' },
      el('span', { className: 'au-user' }, fa(e.user === 'System' ? 'fa-solid fa-microchip' : 'fa-solid fa-user'), e.user),
      el('span', { textContent: fmtDate(e.t) })));
}
async function loadAudit(reset) {
  try {
    if (reset) auOffset = 0;
    const qs = new URLSearchParams({ limit: AU_PAGE, offset: auOffset, cat: $('#auCat').value, q: $('#auSearch').value.trim() });
    const { items, total } = await api('GET', '/api/audit?' + qs);
    const list = $('#auList');
    if (reset) list.textContent = '';
    if (reset && !items.length) list.append(el('div', { className: 'au-empty' }, fa('fa-regular fa-folder-open'), 'Keine Einträge gefunden.'));
    items.forEach((e) => list.append(auditRow(e)));
    auOffset += items.length;
    $('#auCount').textContent = `${Math.min(auOffset, total)} von ${total}`;
    $('#auMore').classList.toggle('hidden', auOffset >= total);
  } catch (e) { toast(e.message, 'err'); }
}
$('#auRefresh').onclick = () => loadAudit(true);
$('#auMore').onclick = () => loadAudit(false);
$('#auCat').onchange = () => loadAudit(true);
$('#auSearch').addEventListener('input', () => { clearTimeout(auTimer); auTimer = setTimeout(() => loadAudit(true), 300); });

/* ---------- Benutzer & Discord ---------- */
const ROLE_ICON = { admin: 'fa-crown', moderator: 'fa-shield-halved', viewer: 'fa-eye' };
const fa = (cls) => { const i = el('i', { className: cls }); i.setAttribute('aria-hidden', 'true'); return i; };
const faBtn = (icon, title, onclick, extra = '') => {
  const b = el('button', { className: 'btn ic ' + extra, title, onclick });
  b.setAttribute('aria-label', title);
  b.append(fa(icon));
  return b;
};
const roleIcon = (id) => ROLE_ICON[id] || 'fa-user-tag';
const roleCls = (id) => (ROLE_ICON[id] ? id : 'custom');
let permDefs = [], allRolesCache = [];

function renderRoles(roles, defs, isAdmin) {
  const ul = $('#roleList'); ul.textContent = '';
  roles.forEach((r) => {
    const names = r.id === 'admin' ? [] : r.perms.map((k) => (defs.find((d) => d.k === k) || { label: k }).label);
    const chips = r.id === 'admin'
      ? el('p', { className: 'none', textContent: 'Alle Rechte, fest eingebaut.' })
      : names.length
        ? el('div', { className: 'perm-chips' }, names.map((n) => el('span', { className: 'perm-chip', textContent: n })))
        : el('p', { className: 'none', textContent: 'Nur ansehen: Status, Konsolen-Log und Spielerlisten.' });
    const actions = r.builtin || !isAdmin ? '' : el('div', { className: 'role-actions' },
      faBtn('fa-solid fa-pen', 'Rolle bearbeiten', () => openRoleDlg(r), 'sm'),
      faBtn('fa-solid fa-trash', 'Rolle löschen', act(async () => {
        if (!(await uiConfirm('Rolle löschen?', `„${r.name}“ wird gelöscht. Das geht nur, wenn kein Benutzer diese Rolle mehr hat.`, { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
        await api('DELETE', '/api/roles/' + encodeURIComponent(r.id)); toast('Rolle gelöscht.'); loadUsers();
      }), 'sm danger'));
    ul.append(el('li', {},
      el('span', { className: 'role-ic ' + roleCls(r.id) }, fa('fa-solid ' + roleIcon(r.id))),
      el('div', { className: 'role-body' }, el('b', {}, r.name, el('span', { className: 'role-count', textContent: `${r.users} ${r.users === 1 ? 'Benutzer' : 'Benutzer'}` })), chips),
      actions));
  });
  $('#roleNew').classList.toggle('hidden', !isAdmin);
}

let roleEditId = null;
function openRoleDlg(role) {
  roleEditId = role ? role.id : null;
  $('#roleTitle').textContent = role ? 'Rolle bearbeiten' : 'Neue Rolle';
  $('#roleName').value = role ? role.name : '';
  $('#roleErr').textContent = '';
  const box = $('#rolePerms'); box.textContent = '';
  let group = '';
  permDefs.forEach((d) => {
    if (d.g !== group) { group = d.g; box.append(el('div', { className: 'perm-group', textContent: group })); }
    const cb = el('input', { type: 'checkbox', checked: !!role && role.perms.includes(d.k) });
    cb.dataset.k = d.k;
    box.append(el('label', { className: 'perm-row' }, el('span', { className: 'switch' }, cb, el('span', { className: 'slider' })),
      el('span', { className: 'perm-text' }, el('b', { textContent: d.label }), el('small', { textContent: d.help }))));
  });
  $('#roleDlg').showModal();
  $('#roleName').focus();
}
$('#roleNew').onclick = () => openRoleDlg(null);
$('#roleCancel').onclick = () => $('#roleDlg').close();
$('#roleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: $('#roleName').value.trim(), perms: $$('#rolePerms input:checked').map((c) => c.dataset.k) };
  const ok = $('#roleOk'); ok.disabled = true;
  try {
    if (roleEditId) await api('PUT', '/api/roles/' + encodeURIComponent(roleEditId), body);
    else await api('POST', '/api/roles', body);
    $('#roleDlg').close();
    toast(roleEditId ? 'Rolle gespeichert.' : 'Rolle angelegt.');
    loadUsers();
  } catch (err) { $('#roleErr').textContent = err.message; }
  ok.disabled = false;
});

async function loadUsers() {
  try {
    const { me, myRole: mine, perms, roles, users } = await api('GET', '/api/users');
    permDefs = perms; allRolesCache = roles;
    const isAdmin = mine === 'admin';
    renderRoles(roles, perms, isAdmin);
    // Rollenauswahl beim Anlegen: nur Rollen, die man selbst vergeben darf
    const add = $('#uRole'), keep = add.value;
    add.textContent = '';
    roles.filter((r) => r.assignable).forEach((r) => { const o = el('option', { value: r.id, textContent: r.name }); o.dataset.icon = 'fa-solid ' + roleIcon(r.id); add.append(o); });
    add.value = [...add.options].some((o) => o.value === keep) ? keep : ([...add.options].some((o) => o.value === 'moderator') ? 'moderator' : (add.options[0] || {}).value);

    $('#userCount').textContent = users.length + (users.length === 1 ? ' Benutzer' : ' Benutzer');
    const list = $('#userList'); list.textContent = '';
    const meOwner = users.some((x) => x.owner && x.username === me);
    users.forEach((u) => {
      const self = u.username === me, enc = encodeURIComponent(u.username);
      const locked = (u.owner && !meOwner) || !u.canEdit; // Hauptbenutzer nur durch ihn selbst, Höhergestellte nicht durch Niedrigere
      const lockNote = el('span', { className: 'lock-note', title: u.owner && !meOwner ? 'Nur der Hauptbenutzer kann dieses Konto bearbeiten' : 'Dieser Benutzer hat mehr Rechte als du' }, fa('fa-solid fa-lock'), 'Geschützt');
      const cls = roleCls(u.role);
      let role;
      if (self || u.owner || locked) {
        role = el('span', { className: 'badge ' + cls }, fa('fa-solid ' + roleIcon(u.role)), u.roleName);
      } else {
        const icon = fa('fa-solid ' + roleIcon(u.role));
        const sel = el('select', { title: 'Rolle ändern', onchange: act(async (ev) => {
          await api('PUT', '/api/users/' + enc, { role: ev.target.value });
          icon.className = 'fa-solid ' + roleIcon(ev.target.value);
          role.className = 'role-pick ' + roleCls(ev.target.value);
          loadUsers();
        }, 'Rolle geändert.') }, roles.filter((r) => r.assignable || r.id === u.role).map((r) => el('option', { value: r.id, textContent: r.name })));
        sel.value = u.role;
        role = el('label', { className: 'role-pick ' + cls }, icon, sel);
      }
      list.append(el('div', { className: 'user' },
        u.minecraft ? el('div', { className: 'avatar mc' }, head(u.minecraft.uuid, 46)) : el('div', { className: 'avatar ' + cls, textContent: u.username.charAt(0) }),
        el('div', { className: 'u-main' },
          el('div', { className: 'u-name' }, u.username, self ? el('span', { className: 'you', textContent: 'du' }) : '', u.owner ? el('span', { className: 'owner-chip', title: 'Das ursprüngliche Hauptkonto' }, fa('fa-solid fa-crown'), 'Hauptbenutzer') : ''),
          el('div', { className: 'u-meta' },
            el('span', {}, fa('fa-regular fa-clock'), u.lastLogin ? 'Letzter Login: ' + fmtDate(u.lastLogin) : 'Noch nie angemeldet'),
            el('span', {}, fa('fa-solid fa-cube'), u.minecraft ? 'Minecraft: ' + u.minecraft.name : 'Kein Minecraft-Account verknüpft'),
            el('span', {}, fa('fa-brands fa-discord'), u.discordId ? 'Discord-ID ' + u.discordId : 'Kein Discord verknüpft'),
            u.twofa ? el('span', { className: 'tf-on' }, fa('fa-solid fa-shield-halved'), '2FA aktiv') : '')),
        role,
        locked ? lockNote : el('div', { className: 'u-actions' },
          faBtn('fa-solid fa-pen', 'Benutzernamen ändern', act(async () => {
            const n = await uiPrompt('Benutzer umbenennen', { label: 'Neuer Benutzername für ' + u.username, value: u.username, required: true }, { okText: 'Umbenennen', icon: 'fa-solid fa-pen' });
            if (!n || n.trim() === u.username) return;
            await api('PUT', '/api/users/' + enc, { username: n.trim() });
            toast('Benutzer umbenannt.');
            if (self) renderWhoami(await api('GET', '/api/me'));
            loadUsers();
          })),
          faBtn('fa-solid fa-cube', 'Minecraft-Account verknüpfen', () => openMcDlg({ username: u.username, current: u.minecraft })),
          faBtn('fa-brands fa-discord', 'Discord-ID ändern', act(async () => {
            const id = await uiPrompt('Discord-ID ändern', { label: 'Discord-ID für ' + u.username + ' (leer = entfernen)', value: u.discordId }, { okText: 'Speichern', icon: 'fa-brands fa-discord' });
            if (id !== null) { await api('PUT', '/api/users/' + enc, { discordId: id }); loadUsers(); }
          })),
          faBtn('fa-solid fa-key', 'Passwort setzen', act(async () => {
            const pw = await uiPrompt('Passwort setzen', { label: 'Neues Passwort für ' + u.username + ' (min. 8 Zeichen)', type: 'password', required: true }, { okText: 'Setzen', icon: 'fa-solid fa-key' });
            if (pw) { await api('PUT', '/api/users/' + enc, { password: pw }); toast('Passwort gesetzt.'); }
          })),
          u.twofa && !self ? faBtn('fa-solid fa-shield-halved', 'Zwei-Faktor zurücksetzen', act(async () => {
            if (!(await uiConfirm('Zwei-Faktor zurücksetzen?', `„${u.username}“ meldet sich danach nur noch mit dem Passwort an und kann die Zwei-Faktor-Anmeldung neu einrichten.`, { okText: 'Zurücksetzen', danger: true, icon: 'fa-solid fa-shield-halved' }))) return;
            await api('POST', '/api/users/' + enc + '/2fa-reset'); toast('Zwei-Faktor zurückgesetzt.'); loadUsers();
          })) : '',
          self ? '' : faBtn('fa-solid fa-trash', 'Benutzer löschen', act(async () => {
            if (!(await uiConfirm('Benutzer löschen?', `„${u.username}“ kann sich danach nicht mehr anmelden.`, { okText: 'Löschen', danger: true, icon: 'fa-solid fa-user-minus' }))) return;
            await api('DELETE', '/api/users/' + enc); loadUsers();
          }), 'danger'))));
    });
  } catch (e) { toast(e.message, 'err'); }
}
$('#uAdd').onclick = act(async () => {
  await api('POST', '/api/users', { username: $('#uName').value.trim(), password: $('#uPass').value, role: $('#uRole').value, minecraft: $('#uMc').value.trim(), discordId: $('#uDisc').value.trim() });
  $('#uName').value = ''; $('#uPass').value = ''; $('#uMc').value = ''; $('#uDisc').value = '';
  loadUsers();
}, 'Benutzer angelegt.');
async function loadDiscord() {
  try {
    const d = await api('GET', '/api/discord');
    $('#dEnabled').checked = d.enabled; $('#dId').value = d.clientId; $('#dRedirect').value = d.redirectUri;
    $('#dSecret').value = ''; $('#dSecret').placeholder = d.hasSecret ? '(gespeichert – leer lassen = unverändert)' : 'Client-Secret';
    $('#dSuggest').textContent = d.redirectUri || d.suggestedRedirect;
    const on = d.enabled && d.clientId && d.hasSecret;
    $('#dStatus').textContent = on ? 'Aktiv' : 'Nicht aktiv';
    $('#dStatus').classList.toggle('on', !!on);
    $$('#dEnabled, #dId, #dSecret, #dRedirect, #dSave').forEach((x) => { x.disabled = !!d.fromEnv; });
    if (d.fromEnv) $('#dSecret').placeholder = 'per .env gesetzt (DISCORD_CLIENT_SECRET)';
  } catch (e) { toast(e.message, 'err'); }
}
$('#dSave').onclick = act(async () => {
  await api('PUT', '/api/discord', { enabled: $('#dEnabled').checked, clientId: $('#dId').value, clientSecret: $('#dSecret').value, redirectUri: $('#dRedirect').value.trim() });
  loadDiscord();
}, 'Discord-Einstellungen gespeichert.');

/* ---------- Panel-Seite: Bereiche und Änderungsanzeige ---------- */
{
  const tabs = $$('#pnTabs button');
  const show = (g) => {
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.g === g));
    $$('.pn-group').forEach((x) => x.classList.toggle('hidden', x.dataset.g !== g));
    $('#pnNote').classList.toggle('hidden', g !== 'server' && g !== 'auto');
    try { localStorage.setItem('mcp_pn_tab', g); } catch {}
  };
  tabs.forEach((b) => { b.onclick = () => show(b.dataset.g); });
  let saved = 'server'; try { saved = localStorage.getItem('mcp_pn_tab') || 'server'; } catch {}
  show(tabs.some((b) => b.dataset.g === saved) ? saved : 'server');
  const dirty = (on) => $('#cSave').classList.toggle('dirty', on);
  $$('.pn-group[data-g=server] input, .pn-group[data-g=auto] input, .pn-group[data-g=auto] textarea').forEach((x) => {
    x.addEventListener('input', () => dirty(true)); x.addEventListener('change', () => dirty(true));
  });
  $('#tab-panel').addEventListener('click', (e) => { if (e.target.closest('.time-chips, .time-add button')) dirty(true); });
  window.panelClean = () => dirty(false);
}

/* ---------- Discord-Benachrichtigungen (Webhook) ---------- */
async function loadWebhook() {
  try {
    const d = await api('GET', '/api/webhook');
    $('#whEnabled').checked = d.enabled;
    $('#whUrl').value = '';
    $('#whUrl').placeholder = d.fromEnv ? 'per .env gesetzt (DISCORD_WEBHOOK_URL)' : d.hasUrl ? `gespeichert (${d.urlHint}) – leer lassen = unverändert` : 'https://discord.com/api/webhooks/…';
    const box = $('#whEvents'); box.textContent = '';
    Object.entries(d.labels).forEach(([k, label]) => {
      const cb = el('input', { type: 'checkbox', checked: !!d.events[k] }); cb.dataset.ev = k;
      box.append(el('label', { className: 'check' }, el('span', { className: 'switch' }, cb, el('span', { className: 'slider' })), label));
    });
    const on = d.enabled && d.hasUrl;
    $('#whStatus').textContent = on ? 'Aktiv' : 'Nicht aktiv';
    $('#whStatus').classList.toggle('on', !!on);
    $('#whClear').classList.toggle('hidden', !d.hasUrl || d.fromEnv);
    $('#botStatus').textContent = d.hasBot ? 'Eingetragen' : 'Nicht eingetragen'; $('#botStatus').classList.toggle('on', !!d.hasBot);
    $('#botToken').value = ''; $('#botToken').placeholder = d.botFromEnv ? 'per .env gesetzt (DISCORD_BOT_TOKEN)' : d.hasBot ? 'gespeichert – leer lassen = unverändert' : 'Token des Bots';
    $('#botClear').classList.toggle('hidden', !d.hasBot || d.botFromEnv);
    $$('#botToken, #botClear').forEach((q) => { q.disabled = !!d.botFromEnv; });
    $$('#whEnabled, #whUrl, #whSave, #whClear, #whEvents input').forEach((x) => { x.disabled = !!d.fromEnv; });
  } catch (e) { toast(e.message, 'err'); }
}
const whEvents = () => Object.fromEntries($$('#whEvents input').map((i) => [i.dataset.ev, i.checked]));
$('#whSave').onclick = act(async () => {
  await api('PUT', '/api/webhook', { enabled: $('#whEnabled').checked, url: $('#whUrl').value.trim(), botToken: $('#botToken').value.trim(), events: whEvents() });
  loadWebhook();
}, 'Benachrichtigungen gespeichert.');
$('#whTest').onclick = act(async () => {
  await api('POST', '/api/webhook/test', { url: $('#whUrl').value.trim() });
}, 'Testnachricht gesendet – schau in deinen Discord-Kanal.');
$('#botClear').onclick = act(async () => {
  if (!(await uiConfirm('Bot-Token löschen?', 'Direktnachrichten werden dann nicht mehr verschickt.', { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
  await api('PUT', '/api/webhook', { enabled: $('#whEnabled').checked, removeBot: true });
  loadWebhook();
}, 'Bot-Token gelöscht.');
$('#whClear').onclick = act(async () => {
  if (!(await uiConfirm('Webhook-Adresse löschen?', 'Es werden keine Benachrichtigungen mehr gesendet.', { okText: 'Löschen', danger: true, icon: 'fa-solid fa-trash' }))) return;
  await api('PUT', '/api/webhook', { enabled: false, removeUrl: true });
  loadWebhook();
}, 'Webhook-Adresse gelöscht.');

/* ---------- Mods & Plugins (Modrinth) ---------- */
let modInfo = null, modQuery = '', modOffset = 0, modUpdates = {};
const modOk = () => modInfo && modInfo.dir;
async function loadMods() {
  try {
    modInfo = await api('GET', '/api/mods/info');
    const sel = $('#modSw'); sel.textContent = '';
    sel.append(el('option', { value: '', textContent: '– bitte wählen –' }));
    modInfo.software.forEach((s) => sel.append(el('option', { value: s.id, textContent: `${s.label} (${s.dir})` })));
    sel.append(el('option', { value: 'vanilla', textContent: 'Vanilla (keine Mods)' }));
    sel.value = modInfo.type; sel.dispatchEvent(new Event('change'));
    $('#modVer').value = modInfo.version;
    const hint = $('#modEnvHint span');
    hint.textContent = modOk() ? `Es werden nur Dateien gezeigt, die zu ${modInfo.type} ${modInfo.version || '(jede Version)'} passen. Sie landen im Ordner „${modInfo.dir}“.`
      : modInfo.type === 'vanilla' ? 'Ein Vanilla-Server kann keine Mods oder Plugins laden. Installiere Paper (Plugins) oder Fabric, Forge oder NeoForge (Mods).' : 'Wähle deine Server-Software und die Minecraft-Version. Nach einer Installation über „Installation“ ist das schon ausgefüllt.';
    if (modOk()) { if (!$('#modResults').children.length) searchMods(true); else if (!$('#modInstalledPane').classList.contains('hidden')) loadModsInstalled(); }
  } catch (e) { toast(e.message, 'err'); }
}
$('#modEnvSave').onclick = act(async () => {
  await api('PUT', '/api/mods/info', { type: $('#modSw').value, version: $('#modVer').value.trim() });
  $('#modResults').textContent = '';
  await loadMods();
}, 'Gespeichert.');
$$('#modTabs button').forEach((b) => { b.onclick = () => {
  $$('#modTabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#modSearchPane').classList.toggle('hidden', b.dataset.m !== 'search');
  $('#modInstalledPane').classList.toggle('hidden', b.dataset.m !== 'installed');
  if (b.dataset.m === 'installed' && modOk()) loadModsInstalled();
}; });
const fmtNum = (n) => { const dec = LANG === 'en' ? '.' : ','; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', dec) + (LANG === 'en' ? ' M' : ' Mio.') : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', dec) + (LANG === 'en' ? ' k' : ' Tsd.') : String(n); };
async function installMod(projectId, versionId, btn) {
  if (btn) { btn.disabled = true; btn.dataset.old = btn.innerHTML; btn.textContent = 'Lädt …'; }
  try {
    const r = await api('POST', '/api/mods/install', { projectId, versionId });
    toast('Installiert: ' + r.installed.map((i) => i.title + (i.dependency ? ' (benötigt)' : '')).join(', ') + '. ' + r.note);
    if (!$('#modInstalledPane').classList.contains('hidden')) loadModsInstalled();
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.old; } }
}
async function searchMods(reset) {
  if (!modOk()) { $('#modResults').textContent = ''; $('#modMore').classList.add('hidden'); return; }
  if (reset) { modOffset = 0; modQuery = $('#modQ').value.trim(); $('#modResults').textContent = ''; }
  try {
    const [r, inst] = await Promise.all([api('GET', `/api/mods/search?q=${encodeURIComponent(modQuery)}&offset=${modOffset}&env=${$('#modEnv').value}`), api('GET', '/api/mods/installed').catch(() => ({ items: [] }))]);
    const have = new Set(inst.items.filter((i) => i.projectId).map((i) => i.projectId));
    const box = $('#modResults');
    if (reset && !r.hits.length) box.append(el('div', { className: 'bk-empty' }, fa('fa-regular fa-face-frown'), 'Nichts gefunden.'));
    r.hits.forEach((h) => {
      const install = el('button', { className: 'btn primary small' }, fa('fa-solid fa-download'), have.has(h.id) ? ' Neu installieren' : ' Installieren');
      install.onclick = async () => {
        if (h.server === 'unsupported' && !(await uiConfirm('Nur für Spieler-Rechner', `„${h.title}“ ist eine reine Client-Mod. Auf dem Server bringt sie nichts und kann ihn sogar am Start hindern. Trotzdem installieren?`, { okText: 'Trotzdem installieren', danger: true, icon: 'fa-solid fa-triangle-exclamation' }))) return;
        installMod(h.id, undefined, install).then((ok) => { if (ok) install.lastChild.textContent = ' Neu installieren'; });
      };
      const open = el('a', { className: 'btn ic small', title: 'Bei Modrinth öffnen', href: `https://modrinth.com/${h.type === 'plugin' ? 'plugin' : 'mod'}/${encodeURIComponent(h.slug)}`, target: '_blank', rel: 'noopener noreferrer' }, fa('fa-solid fa-arrow-up-right-from-square'));
      open.setAttribute('aria-label', 'Bei Modrinth öffnen');
      const side = h.server === 'unsupported' ? ['mod-env client', 'fa-solid fa-desktop', 'Nur Client'] : h.client === 'unsupported' ? ['mod-env server', 'fa-solid fa-server', 'Nur Server'] : ['mod-env both', 'fa-solid fa-server', 'Server & Client'];
      const pick = el('button', { className: 'btn ic small', title: 'Andere Version wählen' }, fa('fa-solid fa-code-branch'));
      pick.setAttribute('aria-label', 'Andere Version wählen');
      pick.onclick = () => openModVersions(h);
      box.append(el('div', { className: 'mod' },
        h.icon ? el('img', { className: 'mod-icon', src: h.icon, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : el('span', { className: 'mod-icon ph' }, fa('fa-solid fa-puzzle-piece')),
        el('div', { className: 'mod-main' },
          el('div', { className: 'mod-title' }, el('b', { textContent: h.title }), el('span', { className: 'muted', textContent: ' von ' + h.author }), have.has(h.id) ? el('span', { className: 'tf-on' }, fa('fa-solid fa-check'), 'installiert') : ''),
          el('div', { className: 'mod-desc', textContent: h.description }),
          el('div', { className: 'mod-meta' }, el('span', { className: side[0], title: h.server === 'unsupported' ? 'Läuft nur auf den Rechnern der Spieler, nicht auf dem Server' : 'Läuft auf dem Server' }, fa(side[1]), side[2]), el('span', {}, fa('fa-solid fa-download'), fmtNum(h.downloads)), ...h.categories.slice(0, 4).map((c) => el('span', { className: 'mod-tag', textContent: c })))),
        el('div', { className: 'mod-act' }, install, open, pick)));
    });
    modOffset += r.hits.length;
    $('#modMore').classList.toggle('hidden', modOffset >= r.total);
  } catch (e) { toast(e.message, 'err'); }
}
$('#modSearchForm').addEventListener('submit', (e) => { e.preventDefault(); searchMods(true); });
$('#modMore').onclick = () => searchMods(false);
$('#modEnv').addEventListener('change', () => searchMods(true));
async function openModVersions(h) {
  $('#modDlgTitle').textContent = h.title + ' – Version wählen';
  const list = $('#modDlgList'); list.textContent = 'Lade …';
  $('#modDlg').showModal();
  try {
    const { versions } = await api('GET', `/api/mods/project/${encodeURIComponent(h.id)}/versions`);
    list.textContent = '';
    if (!versions.length) list.append(el('p', { className: 'muted', textContent: 'Keine passende Version für deinen Server gefunden.' }));
    versions.forEach((v) => {
      const b = el('button', { type: 'button', className: 'btn small' }, fa('fa-solid fa-download'), ' Installieren');
      b.onclick = async () => { if (await installMod(h.id, v.id, b)) $('#modDlg').close(); };
      list.append(el('div', { className: 'mod-ver' },
        el('div', {}, el('b', { textContent: v.number }), el('span', { className: `mod-tag ${v.type}`, textContent: v.type }), el('small', { className: 'muted', textContent: `${v.game.join(', ')} · ${fmtDate(Date.parse(v.date))} · ${fmtBytes(v.size)}` })),
        b));
    });
  } catch (e) { list.textContent = ''; list.append(el('p', { className: 'error', textContent: e.message })); }
}
$('#modDlgClose').onclick = () => $('#modDlg').close();
async function loadModsInstalled() {
  try {
    const { items, dir } = await api('GET', '/api/mods/installed');
    const t = $('#modTable'); t.textContent = '';
    t.append(el('tr', {}, ...['Name', 'Version', 'Größe', ''].map((x) => el('th', { textContent: x }))));
    if (!items.length) t.append(el('tr', {}, el('td', { colSpan: 4, className: 'bk-empty' }, fa('fa-regular fa-folder-open'), `Im Ordner „${dir}“ liegt noch nichts.`)));
    items.forEach((i) => {
      const up = modUpdates[i.file];
      t.append(el('tr', {},
        el('td', {}, el('span', { className: 'bk-name' }, fa('fa-solid fa-puzzle-piece'), i.title || i.file), i.title ? el('small', { className: 'muted', textContent: ' ' + i.file }) : '', i.dependency ? el('span', { className: 'tf-on', title: 'Wird von einem anderen Eintrag benötigt' }, 'Abhängigkeit') : ''),
        el('td', { className: 'bk-meta', textContent: i.version || '–' }),
        el('td', { className: 'bk-meta' }, fa('fa-solid fa-hard-drive'), fmtBytes(i.size)),
        el('td', { className: 'act' },
          up ? el('button', { className: 'btn small primary', onclick: async (ev) => { if (await installMod(up.projectId, up.versionId, ev.currentTarget)) { delete modUpdates[i.file]; loadModsInstalled(); } } }, fa('fa-solid fa-arrow-up'), ` Auf ${up.to}`) : '', ' ',
          faBtn('fa-solid fa-trash', 'Entfernen', act(async () => {
            if (!(await uiConfirm('Entfernen?', `„${i.title || i.file}“ wird aus dem Ordner „${dir}“ gelöscht.`, { okText: 'Entfernen', danger: true, icon: 'fa-solid fa-trash' }))) return;
            await api('DELETE', '/api/mods/installed?file=' + encodeURIComponent(i.file));
            loadModsInstalled();
          }, 'Entfernt – wirkt nach dem nächsten Neustart.'), 'danger'))));
    });
  } catch (e) { toast(e.message, 'err'); }
}
$('#modCheck').onclick = act(async () => {
  const { updates } = await api('GET', '/api/mods/updates');
  modUpdates = Object.fromEntries(updates.map((u) => [u.file, u]));
  await loadModsInstalled();
  return updates;
}, (u) => (u.length ? `${u.length} Update${u.length > 1 ? 's' : ''} gefunden.` : 'Alles auf dem neuesten Stand.'));

/* ---------- Logs ---------- */
const lg = { offset: 0, loading: false, files: null, timer: null };
const lgSel = (id) => [...$$('#' + id + ' button.on')].map((b) => b.dataset.v);
function lgParams(offset) {
  const p = new URLSearchParams({ file: $('#lgFile').value || 'all', limit: '150', offset: String(offset) });
  const q = $('#lgQ').value.trim(), pl = $('#lgPlayer').value.trim(), ty = lgSel('lgTypes'), lv = lgSel('lgLevels');
  if (q) p.set('q', q); if (pl) p.set('player', pl);
  if (ty.length) p.set('type', ty.join(',')); if (lv.length) p.set('level', lv.join(','));
  if ($('#lgFrom').value) p.set('from', $('#lgFrom').value); if ($('#lgTo').value) p.set('to', $('#lgTo').value);
  return p;
}
async function loadLogs() {
  try {
    const { files } = await api('GET', '/api/logs/files');
    const sel = $('#lgFile'), keep = sel.value;
    sel.textContent = '';
    sel.append(el('option', { value: 'all', textContent: 'Alle Logdateien' }));
    files.forEach((f) => {
      const label = f.crash ? 'Absturz: ' + f.name : f.name === 'latest.log' ? 'Aktuell (latest.log)' : f.name;
      const o = el('option', { value: f.ref, textContent: `${label} · ${fmtBytes(f.size)}` }); sel.append(o);
    });
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : (files.some((f) => f.name === 'latest.log') ? 'latest.log' : 'all');
    sel.dispatchEvent(new Event('change'));
    lg.files = files;
    const dl = $('#lgDownload');
    const upd = () => { const v = sel.value; dl.classList.toggle('hidden', v === 'all'); dl.href = '/api/logs/download?file=' + encodeURIComponent(v); };
    sel.onchange = () => { upd(); runLogSearch(true); }; upd();
    loadPickerPlayers();
    runLogSearch(true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- Spielerauswahl (mit Avataren) ---------- */
const pp = (() => {
  const box = () => $('#lgPP'), inp = () => $('#ppIn'), menu = () => $('#ppMenu'), chips = () => $('#ppChips');
  const S = { names: [], cands: new Map(), idx: 0, shown: [] };
  const key = (n) => n.toLowerCase();
  const sync = () => { $('#lgPlayer').value = S.names.join(','); };
  const fire = () => { sync(); clearTimeout(lg.timer); lg.timer = setTimeout(() => runLogSearch(true), 250); };
  function badges(c) {
    const out = [];
    if (c.online) out.push(el('span', { className: 'pp-b on' }, el('i', { className: 'dot running' }), 'Online'));
    if (c.op) out.push(el('span', { className: 'pp-b op' }, fa('fa-solid fa-crown'), 'OP'));
    if (c.banned) out.push(el('span', { className: 'pp-b ban' }, fa('fa-solid fa-ban'), 'Gebannt'));
    if (c.bedrock) out.push(el('span', { className: 'pp-b' }, fa('fa-solid fa-gamepad'), 'Bedrock'));
    return out;
  }
  function renderChips() {
    const c = chips(); c.textContent = '';
    S.names.forEach((n) => {
      const x = el('button', { type: 'button', className: 'pp-x', title: 'Entfernen' }, fa('fa-solid fa-xmark'));
      x.setAttribute('aria-label', n + ' entfernen');
      x.onclick = (e) => { e.stopPropagation(); remove(n); };
      c.append(el('span', { className: 'pp-chip' }, head(n, 20), el('b', { textContent: n }), x));
    });
    inp().placeholder = S.names.length ? 'Weiteren Spieler hinzufügen …' : 'Spieler wählen oder Namen tippen …';
  }
  function candidates() {
    const q = key(inp().value.trim());
    const list = [...S.cands.values()].filter((c) => !S.names.some((n) => key(n) === key(c.name)) && (!q || key(c.name).includes(q)));
    list.sort((a, b) => (b.online - a.online) || (b.op - a.op) || (b.seen - a.seen) || a.name.localeCompare(b.name));
    return list.slice(0, 40);
  }
  function renderMenu(open = true) {
    const m = menu(); m.textContent = '';
    if (!open) { m.classList.add('hidden'); return; }
    const typed = inp().value.trim();
    S.shown = candidates();
    const exact = S.shown.some((c) => key(c.name) === key(typed));
    const rows = S.shown.map((c) => ({ name: c.name, c }));
    if (typed && /^[\w.*-]{1,32}$/.test(typed) && !exact && !S.names.some((n) => key(n) === key(typed))) rows.push({ name: typed, free: true });
    S.rows = rows;
    S.idx = Math.min(S.idx, Math.max(0, rows.length - 1));
    if (!rows.length) m.append(el('div', { className: 'pp-empty' }, fa('fa-regular fa-face-meh'), typed ? 'Niemand gefunden – tippe den vollen Namen und drücke Enter.' : 'Keine weiteren Spieler bekannt.'));
    else {
      const online = rows.filter((r) => r.c && r.c.online);
      if (online.length && !typed) m.append(el('div', { className: 'pp-sec', textContent: 'Gerade online' }));
      rows.forEach((r, i) => {
        if (!typed && r.c && !r.c.online && (i === 0 || (rows[i - 1].c && rows[i - 1].c.online))) m.append(el('div', { className: 'pp-sec', textContent: 'Bekannte Spieler' }));
        const row = el('button', { type: 'button', className: 'pp-row' + (i === S.idx ? ' act' : ''), role: 'option' },
          head(r.name, 32),
          el('span', { className: 'pp-name' }, el('b', { textContent: r.name }), r.free ? el('small', { textContent: 'Diesen Namen verwenden' }) : el('small', { className: 'pp-bs' }, ...badges(r.c))),
          r.free ? fa('fa-solid fa-plus') : '');
        row.onmousedown = (e) => { e.preventDefault(); add(r.name); };
        row.onmouseenter = () => { S.idx = i; m.querySelectorAll('.pp-row').forEach((x, k) => x.classList.toggle('act', k === i)); };
        m.append(row);
      });
    }
    m.classList.remove('hidden');
  }
  function add(name) {
    name = String(name).trim().replace(/,/g, '');
    if (!name || S.names.length >= 10 || S.names.some((n) => key(n) === key(name))) return;
    S.names.push(name); inp().value = ''; S.idx = 0;
    renderChips(); renderMenu(document.activeElement === inp()); fire();
  }
  function remove(name) { S.names = S.names.filter((n) => n !== name); renderChips(); fire(); }
  function set(names) { S.names = names.slice(0, 10); inp().value = ''; renderChips(); renderMenu(false); fire(); }
  function learn(name, p = {}) {
    const k = key(name), c = S.cands.get(k) || { name, online: false, op: false, banned: false, bedrock: false, seen: false };
    Object.assign(c, Object.fromEntries(Object.entries(p).filter(([, v]) => v)));
    S.cands.set(k, c);
  }
  async function load() {
    S.cands.clear();
    try {
      const d = await api('GET', '/api/players');
      (d.online || []).forEach((n) => learn(n, { online: true, bedrock: isBedrock(n) }));
      (d.whitelist || []).forEach((p) => learn(p.name, { bedrock: isBedrock(p.name, p.uuid) }));
      (d.ops || []).forEach((p) => learn(p.name, { op: true }));
      (d.banned || []).forEach((p) => learn(p.name, { banned: true }));
    } catch {}
    try { (await api('GET', '/api/logs/players')).names.forEach((n) => learn(n, { seen: true })); } catch {}
  }
  function init() {
    const i = inp();
    i.addEventListener('focus', () => renderMenu(true));
    i.addEventListener('input', () => { S.idx = 0; renderMenu(true); });
    i.addEventListener('blur', () => setTimeout(() => menu().classList.add('hidden'), 120));
    i.addEventListener('keydown', (e) => {
      const rows = S.rows || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); S.idx = Math.min(rows.length - 1, S.idx + 1); renderMenu(true); menu().querySelector('.act')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); S.idx = Math.max(0, S.idx - 1); renderMenu(true); menu().querySelector('.act')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = rows[S.idx] || (i.value.trim() && { name: i.value.trim() }); if (r) add(r.name); }
      else if (e.key === 'Backspace' && !i.value && S.names.length) remove(S.names[S.names.length - 1]);
      else if (e.key === 'Escape') { menu().classList.add('hidden'); i.blur(); }
      else if (e.key === ',') { e.preventDefault(); if (i.value.trim()) add(i.value); }
    });
    box().querySelector('.pp-box').addEventListener('click', () => i.focus());
    renderChips();
  }
  return { init, load, add, set, names: () => S.names };
})();
function loadPickerPlayers() { pp.load(); }
pp.init();
function lgHighlight(text, terms) {
  const frag = document.createDocumentFragment();
  const list = terms.filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!list.length) { frag.append(text); return frag; }
  const re = new RegExp('(' + list.join('|') + ')', 'gi');
  text.split(re).forEach((part, i) => { if (i % 2) frag.append(el('mark', { textContent: part })); else if (part) frag.append(part); });
  return frag;
}
const LG_TYPE = { chat: ['fa-solid fa-comment', 'Chat'], join: ['fa-solid fa-right-to-bracket', 'Spieler kommt oder geht'], command: ['fa-solid fa-terminal', 'Befehl'], other: ['fa-solid fa-circle-info', 'Meldung'] };
function lgDayLabel(d) {
  const day = new Date(d + 'T12:00:00'), today = new Date(), diff = Math.round((new Date(today.toDateString()) - new Date(day.toDateString())) / 86400000);
  const full = day.toLocaleDateString(LOCALE, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return diff === 0 ? t('Heute') + ' · ' + full : diff === 1 ? t('Gestern') + ' · ' + full : full;
}
async function runLogSearch(reset) {
  if (lg.loading) return;
  lg.loading = true;
  if (reset) { lg.offset = 0; lg.lastDate = null; $('#lgList').textContent = ''; $('#lgMeta').textContent = 'Suche läuft …'; }
  try {
    const r = await api('GET', '/api/logs/search?' + lgParams(lg.offset));
    const terms = [$('#lgQ').value.trim(), ...$('#lgPlayer').value.split(',').map((s) => s.trim())];
    const showFile = $('#lgFile').value === 'all';
    const list = $('#lgList');
    if (reset && !r.items.length) {
      const filtered = !!($('#lgQ').value.trim() || $('#lgPlayer').value.trim() || lgSel('lgTypes').length || lgSel('lgLevels').length || $('#lgFrom').value || $('#lgTo').value);
      list.append(el('div', { className: 'lg-empty' },
        el('span', { className: 'lg-empty-ic' }, fa(filtered ? 'fa-solid fa-magnifying-glass' : 'fa-regular fa-file-lines')),
        el('b', { textContent: filtered ? 'Keine passenden Zeilen gefunden' : 'Hier gibt es noch keine Logs' }),
        el('span', { textContent: filtered ? 'Versuche es mit weniger Filtern oder einem anderen Suchbegriff.' : 'Sobald der Server läuft, legt er seine Logdateien an und sie erscheinen hier.' }),
        filtered ? el('button', { className: 'btn small', type: 'button', onclick: () => $('#lgReset').click() }, 'Filter zurücksetzen') : ''));
    }
    r.items.forEach((i) => {
      if (i.date !== lg.lastDate) { lg.lastDate = i.date; list.append(el('div', { className: 'lg-day' }, fa('fa-regular fa-calendar'), lgDayLabel(i.date))); }
      const lines = i.text.split('\n');
      const m = i.type === 'chat' && lines[0].match(/^((?:\[Not Secure\] )?(?:\[[^\]]+\] )?)<([^>]+)> ([\s\S]*)$/);
      const body = el('div', { className: 'lg-text' });
      if (m) {
        const who = el('button', { type: 'button', className: 'lg-who', title: 'Nach diesem Spieler filtern', textContent: m[2], onclick: () => pp.add(m[2]) });
        body.append(who, el('span', { className: 'lg-msg' }, lgHighlight(m[3], terms)));
      } else body.append(lgHighlight(lines[0], terms));
      if (lines.length > 1) body.append(el('pre', {}, lgHighlight(lines.slice(1).join('\n'), terms)));
      const copy = el('button', { type: 'button', className: 'lg-copy', title: 'Zeile kopieren', onclick: async () => { try { await navigator.clipboard.writeText(`[${i.date} ${i.time}] ${i.text}`); toast('Kopiert.'); } catch { toast('Kopieren nicht möglich.', 'err'); } } }, fa('fa-regular fa-copy'));
      list.append(el('div', { className: `lg-line lv-${i.level} ty-${i.type}` },
        el('span', { className: 'lg-time', textContent: i.time }),
        el('span', { className: 'lg-ic', title: LG_TYPE[i.type] ? LG_TYPE[i.type][1] : '' }, fa(i.level === 'ERROR' ? 'fa-solid fa-circle-xmark' : i.level === 'WARN' ? 'fa-solid fa-triangle-exclamation' : (LG_TYPE[i.type] || LG_TYPE.other)[0])),
        body,
        showFile ? el('span', { className: 'lg-file', textContent: i.file }) : '',
        copy));
    });
    lg.offset += r.items.length;
    $('#lgMore').classList.toggle('hidden', !r.more);
    $('#lgMeta').textContent = lg.offset ? `${lg.offset} Zeilen angezeigt${r.more ? ' (es gibt mehr)' : ''}${r.truncated ? ' · sehr große Logs: die Suche wurde abgekürzt, bitte eingrenzen' : ''}` : '';
  } catch (e) { $('#lgMeta').textContent = ''; toast(e.message, 'err'); }
  finally { lg.loading = false; }
}
$('#lgForm').addEventListener('submit', (e) => { e.preventDefault(); runLogSearch(true); });
$('#lgMore').onclick = () => runLogSearch(false);
$('#lgReset').onclick = () => { $('#lgQ').value = ''; pp.set([]); $('#lgFrom').value = ''; $('#lgTo').value = ''; $$('#lgTypes button, #lgLevels button').forEach((b) => b.classList.remove('on')); runLogSearch(true); };
$$('#lgTypes button, #lgLevels button').forEach((b) => { b.onclick = () => { b.classList.toggle('on'); runLogSearch(true); }; });
['lgQ'].forEach((id) => $('#' + id).addEventListener('input', () => { clearTimeout(lg.timer); lg.timer = setTimeout(() => runLogSearch(true), 450); }));
['lgFrom', 'lgTo'].forEach((id) => $('#' + id).addEventListener('change', () => runLogSearch(true)));

/* ---------- Mein Konto ---------- */
let acc = null;
async function loadAccount() {
  try {
    acc = await api('GET', '/api/me/settings');
    myMc = acc.minecraft;
    const h = $('#acHead'); h.textContent = '';
    if (acc.minecraft) h.append(head(acc.minecraft.uuid, 72)); else h.append(el('span', { className: 'ph' }, fa('fa-solid fa-user')));
    $('#acName').textContent = acc.username;
    $('#acRole').textContent = acc.roleName; $('#acRole').className = 'badge ' + roleCls(acc.role);
    $('#acLast').textContent = acc.lastLogin ? 'Letzte Anmeldung: ' + fmtDate(acc.lastLogin) : '';
    $('#acMc').textContent = acc.minecraft ? acc.minecraft.name : 'Kein Minecraft-Account verknüpft (dein Avatar im Panel)';
    setBtn($('#acMcBtn'), 'fa-solid fa-link', acc.minecraft ? 'Ändern' : 'Verknüpfen');
    $('#acDc').textContent = acc.discordId ? 'ID ' + acc.discordId : 'Keine Discord-ID eingetragen';
    setBtn($('#acDcBtn'), 'fa-brands fa-discord', acc.discordId ? 'Ändern' : 'Eintragen');
    $('#acTf').textContent = acc.twofa ? 'Aktiv – dein Konto ist zusätzlich geschützt' : 'Nicht eingerichtet – empfohlen';
    $('#anPanel').checked = acc.notify.panel;
    $('#anDm').checked = acc.notify.dm;
    $('#anDm').disabled = !acc.discordId || !acc.botActive;
    $('#anDmTest').disabled = !acc.discordId || !acc.botActive;
    $('#anDmHint').textContent = !acc.botActive ? 'Noch nicht eingerichtet: Ein Admin muss unter Panel → Benachrichtigungen einen Discord-Bot eintragen.' : !acc.discordId ? 'Trage zuerst deine Discord-ID ein.' : 'Eine private Nachricht von einem Bot, nur an dich. Du musst mit dem Bot einen Server teilen.';
    let br = false; try { br = localStorage.getItem('mcp_browser_notify') === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch {}
    $('#anBrowser').checked = br;
    const box = $('#anEvents'); box.textContent = '';
    Object.entries(acc.labels).forEach(([k, label]) => {
      const cb = el('input', { type: 'checkbox', checked: !!acc.notify.events[k] }); cb.dataset.ev = k;
      box.append(el('label', { className: 'check' }, el('span', { className: 'switch' }, cb, el('span', { className: 'slider' })), label));
    });
    $('#whoami').dataset.loaded = '1';
  } catch (e) { toast(e.message, 'err'); }
}
$('#acMcBtn').onclick = () => openMcDlg({ self: true, current: myMc });
$('#acDcBtn').onclick = act(async () => {
  const id = await uiPrompt('Discord-ID', { label: 'Deine Discord-ID (leer = entfernen)', value: acc ? acc.discordId : '' }, { okText: 'Weiter', icon: 'fa-brands fa-discord' });
  if (id === null) return;
  const password = await uiPrompt('Zur Sicherheit', { label: 'Dein Passwort', type: 'password', required: true }, { okText: 'Speichern', icon: 'fa-solid fa-lock' });
  if (!password) return;
  await api('PUT', '/api/me/discord', { discordId: id.trim(), password });
  loadAccount();
}, 'Discord-ID gespeichert.');
$('#acPw').onclick = openPwDlg;
$('#acTfBtn').onclick = openPwDlg;
$('#acLogout').onclick = () => $('#logoutBtn').click();
$('#acLogoutAll').onclick = async () => {
  if (!(await uiConfirm('Überall abmelden?', 'Alle deine Sitzungen auf allen Geräten werden beendet, auch diese.', { okText: 'Überall abmelden', danger: true, icon: 'fa-solid fa-laptop-code' }))) return;
  try { await api('POST', '/api/me/logout-all'); } catch {}
  showLogin();
};
$('#anBrowser').onchange = async (e) => {
  if (!e.target.checked) { try { localStorage.setItem('mcp_browser_notify', '0'); } catch {} return; }
  if (!('Notification' in window)) { toast('Dieser Browser unterstützt keine Mitteilungen.', 'err'); e.target.checked = false; return; }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') { toast('Mitteilungen sind im Browser blockiert.', 'err'); e.target.checked = false; return; }
  try { localStorage.setItem('mcp_browser_notify', '1'); } catch {}
};
$('#anSave').onclick = act(async () => {
  const events = Object.fromEntries($$('#anEvents input').map((i) => [i.dataset.ev, i.checked]));
  await api('PUT', '/api/me/notifications', { panel: $('#anPanel').checked, dm: $('#anDm').checked, events });
  loadAccount();
}, 'Benachrichtigungen gespeichert.');
$('#anDmTest').onclick = act(async () => { await api('POST', '/api/me/dm-test'); }, 'Test-Nachricht gesendet – schau in deine Discord-Nachrichten.');
// Hinweise vom Server (persönliche Benachrichtigungen)
function showNotify(m) {
  toast(m.title + (m.text ? ' – ' + m.text : ''), m.color === 'bad' ? 'err' : 'ok');
  try {
    if (document.hidden && localStorage.getItem('mcp_browser_notify') === '1' && 'Notification' in window && Notification.permission === 'granted') new Notification(m.title, { body: m.text || '', icon: '/logo.svg' });
  } catch {}
}

/* ---------- Spieler: Statistik (auch rückwirkend) und Details ---------- */
let plView = 'lists', plsData = null, plsSort = { k: 'playSeconds', dir: -1 };
const fmtPlay = (s) => (s == null ? '–' : s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} min` : `${Math.floor(s / 60)} min`);
function fmtAgo(ts) {
  if (!ts) return '–';
  const d = (Date.now() - ts) / 1000;
  if (d < 90) return t('gerade eben');
  if (d < 3600) return t('vor {0} Min.', Math.round(d / 60));
  if (d < 86400) return t('vor {0} Std.', Math.round(d / 3600));
  if (d < 86400 * 14) return t('vor {0} Tagen', Math.round(d / 86400));
  return new Date(ts).toLocaleDateString(LOCALE);
}
function plBadges(p) {
  const out = [];
  if (p.online) out.push(el('span', { className: 'pp-b on' }, el('i', { className: 'dot running' }), 'Online'));
  if (p.op) out.push(el('span', { className: 'pp-b op' }, fa('fa-solid fa-crown'), 'OP'));
  if (p.whitelisted) out.push(el('span', { className: 'pp-b' }, fa('fa-solid fa-list-check'), 'Whitelist'));
  if (p.banned) out.push(el('span', { className: 'pp-b ban' }, fa('fa-solid fa-ban'), 'Gebannt'));
  return out;
}
async function loadPlayerStats() {
  try {
    plsData = await api('GET', '/api/players/stats');
    renderPlayerStats();
  } catch (e) { toast(e.message, 'err'); }
}
function renderPlayerStats() {
  if (!plsData) return;
  const q = $('#plsQ').value.trim().toLowerCase();
  const rows = plsData.players.filter((p) => !q || p.name.toLowerCase().includes(q));
  const k = plsSort.k;
  rows.sort((a, b) => {
    if (k === 'name') return a.name.localeCompare(b.name) * plsSort.dir;
    const x = a[k] ?? -1, y = b[k] ?? -1;
    return (x - y) * plsSort.dir || a.name.localeCompare(b.name);
  });
  const tbl = $('#plsTable'); tbl.textContent = '';
  const cols = [['name', 'Spieler'], ['playSeconds', 'Spielzeit'], ['lastSeen', 'Zuletzt gesehen'], ['joins', 'Beitritte'], ['deaths', 'Tode'], ['mobKills', 'Mob-Kills']];
  tbl.append(el('tr', {}, ...cols.map(([key, label]) => {
    const th = el('th', { className: 'sortable' + (plsSort.k === key ? ' on' : '') }, label, plsSort.k === key ? fa(plsSort.dir < 0 ? 'fa-solid fa-arrow-down' : 'fa-solid fa-arrow-up') : '');
    th.onclick = () => { plsSort = { k: key, dir: plsSort.k === key ? -plsSort.dir : (key === 'name' ? 1 : -1) }; renderPlayerStats(); };
    return th;
  })));
  if (!rows.length) tbl.append(el('tr', {}, el('td', { colSpan: 6, className: 'bk-empty' }, fa('fa-regular fa-face-meh'), q ? 'Niemand gefunden.' : 'Noch keine Spieler bekannt.')));
  rows.forEach((p) => {
    const tr = el('tr', { className: 'clickable' },
      el('td', {}, el('span', { className: 'pls-who' }, head(p.name, 30), el('span', {}, el('b', { textContent: p.name }), el('span', { className: 'pls-badges' }, ...plBadges(p))))),
      el('td', { textContent: fmtPlay(p.playSeconds) }),
      el('td', { textContent: p.online ? 'Online' : fmtAgo(p.lastSeen), title: p.lastSeen ? fmtDate(p.lastSeen) : '' }),
      el('td', { textContent: p.joins ?? '–' }), el('td', { textContent: p.deaths ?? '–' }), el('td', { textContent: p.mobKills ?? '–' }));
    tr.onclick = () => openPlayerDetail(p);
    tbl.append(tr);
  });
  const total = plsData.players.reduce((s, p) => s + (p.playSeconds || 0), 0);
  $('#plsInfo').textContent = `${plsData.players.length} ${plsData.players.length === 1 ? t('Spieler') : t('Spieler')}` + (plsData.hasStats ? ` · ${t('zusammen')} ${fmtPlay(total)}` : '');
}
async function openPlayerDetail(p) {
  $('#pldHead').textContent = ''; $('#pldHead').append(head(p.name, 64));
  $('#pldName').textContent = p.name;
  const b = $('#pldBadges'); b.textContent = ''; b.append(...plBadges(p));
  const tiles = [['fa-regular fa-clock', 'Spielzeit', fmtPlay(p.playSeconds)], ['fa-solid fa-eye', 'Zuletzt gesehen', p.online ? 'Online' : fmtAgo(p.lastSeen)], ['fa-solid fa-flag', 'Erster Besuch', p.firstSeen ? new Date(p.firstSeen).toLocaleDateString(LOCALE) : '–'],
    ['fa-solid fa-right-to-bracket', 'Beitritte', p.joins ?? '–'], ['fa-solid fa-skull', 'Tode', p.deaths ?? '–'], ['fa-solid fa-khanda', 'Mob-Kills', p.mobKills ?? '–']];
  const box = $('#pldTiles'); box.textContent = '';
  tiles.forEach(([ic, label, v]) => box.append(el('div', { className: 'pld-tile' }, fa(ic), el('small', { textContent: label }), el('b', { textContent: String(v) }))));
  const h = $('#pldHist'); h.textContent = 'Lade …';
  $('#plDet').showModal();
  try {
    const { events } = await api('GET', '/api/players/history?name=' + encodeURIComponent(p.name));
    h.textContent = '';
    if (!events.length) h.append(el('p', { className: 'muted', textContent: 'Keine Banns oder Kicks bekannt.' }));
    events.forEach((e) => {
      const ic = e.type === 'ban' ? ['fa-solid fa-ban', 'Gebannt'] : e.type === 'unban' ? ['fa-solid fa-unlock', 'Entbannt'] : ['fa-solid fa-right-from-bracket', 'Gekickt'];
      h.append(el('div', { className: 'pld-ev ' + e.type },
        el('span', { className: 'pld-ev-ic' }, fa(ic[0])),
        el('div', {}, el('b', { textContent: ic[1] + (e.current ? ' – aktuell' : '') }), el('span', { className: 'muted', textContent: ' · ' + (e.ts ? fmtDate(e.ts) : '') }),
          e.reason ? el('div', { className: 'pld-reason', textContent: '„' + e.reason + '“' }) : '',
          e.source && e.source !== 'log' ? el('small', { className: 'muted', textContent: t('von') + ' ' + e.source.replace(/^Panel: /, '') }) : '')));
    });
  } catch (e) { h.textContent = ''; h.append(el('p', { className: 'error', textContent: e.message })); }
}
$('#pldClose').onclick = () => $('#plDet').close();
$('#plsQ').addEventListener('input', renderPlayerStats);
$$('#plViews button').forEach((b) => { b.onclick = () => {
  plView = b.dataset.v;
  $$('#plViews button').forEach((x) => x.classList.toggle('active', x === b));
  $('#plStats').classList.toggle('hidden', plView !== 'stats');
  $('#plLists').classList.toggle('hidden', plView !== 'lists');
  if (plView === 'stats') loadPlayerStats();
}; });

/* ---------- Vorhandenen Server verwenden ---------- */
$('#adScan').onclick = act(async () => {
  const d = await api('GET', '/api/server/detect');
  const box = $('#adResult'); box.textContent = '';
  if (!d.suggestion) {
    box.append(el('div', { className: 'ad-box warn' }, fa('fa-solid fa-triangle-exclamation'), el('div', {}, el('b', { textContent: 'Noch kein Server gefunden' }), ...d.notes.map((n) => el('p', { textContent: n })), el('p', { className: 'muted', textContent: 'Server-Ordner: ' + d.dir }))));
    return;
  }
  const s = d.suggestion;
  const sw = el('select', { id: 'adType' }, ...[['paper', 'Paper'], ['purpur', 'Purpur'], ['folia', 'Folia'], ['spigot', 'Spigot'], ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['forge', 'Forge'], ['neoforge', 'NeoForge'], ['vanilla', 'Vanilla']].map(([v, l]) => el('option', { value: v, textContent: l })));
  sw.value = s.type || 'vanilla';
  const ver = el('input', { id: 'adVer', value: s.version, placeholder: 'z. B. 1.21.4' });
  const jar = s.launchArgsFile ? null : el('select', { id: 'adJar' }, ...d.candidates.map((c) => el('option', { value: c.file, textContent: `${c.file} (${fmtBytes(c.size)})` })));
  if (jar) jar.value = s.jarFile;
  box.append(el('div', { className: 'ad-box ok' }, fa('fa-solid fa-circle-check'), el('div', { className: 'ad-main' },
    el('b', { textContent: 'Server gefunden' }),
    el('div', { className: 'ad-facts' },
      el('span', {}, fa('fa-solid fa-play'), s.launchArgsFile ? 'Start über ' + s.launchArgsFile : 'Start-Datei: ' + s.jarFile),
      el('span', {}, fa('fa-solid fa-earth-europe'), d.hasWorld ? `Welt „${d.level}“ vorhanden` : 'Noch keine Welt (wird beim Start erzeugt)'),
      el('span', {}, fa('fa-solid fa-sliders'), d.hasProps ? 'server.properties vorhanden' : 'keine server.properties')),
    ...d.notes.map((n) => el('p', { className: 'muted', textContent: n })),
    el('div', { className: 'form form-2 ad-form' },
      jar ? el('label', {}, el('span', { className: 'lbl', textContent: 'Start-Datei' }), jar) : '',
      el('label', {}, el('span', { className: 'lbl', textContent: 'Server-Software' }), sw),
      el('label', {}, el('span', { className: 'lbl', textContent: 'Minecraft-Version' }), ver)),
    el('button', { className: 'btn primary', id: 'adApply', onclick: act(async () => {
      await api('POST', '/api/server/adopt', { jarFile: jar ? jar.value : '', launchArgsFile: s.launchArgsFile, type: sw.value, version: ver.value.trim() });
      toast('Übernommen. Du kannst den Server jetzt in der Konsole starten.');
      box.textContent = '';
    }) }, fa('fa-solid fa-check'), ' Übernehmen'))));
});

/* ---------- Changelog ---------- */
function clInline(s) { // **fett**, `Code`, [Text](Adresse) – ohne innerHTML
  const frag = document.createDocumentFragment();
  s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) frag.append(el('b', { textContent: part.slice(2, -2) }));
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) frag.append(el('code', { textContent: part.slice(1, -1) }));
    else if (part) frag.append(part.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'));
  });
  return frag;
}
async function loadChangelog() {
  try {
    const { version, entries } = await api('GET', '/api/changelog');
    $('#clVersion').textContent = version ? 'Version ' + version : '';
    const box = $('#clList'); box.textContent = '';
    if (!entries.length) box.append(el('div', { className: 'bk-empty' }, fa('fa-regular fa-file-lines'), 'Kein Changelog gefunden.'));
    const ICON = { 'Hinzugefügt': ['fa-solid fa-plus', 'add'], 'Geändert': ['fa-solid fa-pen', 'chg'], 'Behoben': ['fa-solid fa-wrench', 'fix'], 'Entfernt': ['fa-solid fa-trash', 'del'], 'Sicherheit': ['fa-solid fa-shield-halved', 'sec'] };
    entries.forEach((e) => {
      const unreleased = /^unver/i.test(e.version);
      box.append(el('div', { className: 'card cl-entry' },
        el('div', { className: 'cl-head' }, el('h3', { textContent: unreleased ? 'Neueste Änderungen' : 'Version ' + e.version }), e.date ? el('span', { className: 'chip', textContent: e.date }) : '', unreleased ? el('span', { className: 'chip', title: 'Diese Änderungen sind schon im Panel, haben aber noch keine eigene Versionsnummer.', textContent: 'noch ohne Versionsnummer' }) : ''),
        ...e.notes.map((n) => el('p', { className: 'muted', textContent: n })),
        ...e.groups.map((g) => {
          const [ic, cls] = ICON[g.title] || ['fa-solid fa-circle', 'chg'];
          return el('div', { className: 'cl-group ' + cls },
            g.title ? el('h4', {}, fa(ic), g.title) : '',
            el('ul', {}, ...g.items.map((i) => el('li', {}, clInline(i)))));
        })));
    });
  } catch (e) { toast(e.message, 'err'); }
}

// Sprache umschalten (Deutsch / English)
$$('.lang-seg button').forEach((b) => {
  b.classList.toggle('on', b.dataset.lang === LANG);
  b.onclick = () => { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); };
});
renderThemeBtn();
renderCollapseBtn();
boot();
