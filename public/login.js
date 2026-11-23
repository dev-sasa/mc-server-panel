'use strict';
const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  $('#loginErr').textContent = params.get('error');
  history.replaceState(null, '', '/login');
}

fetch('/api/auth-info').then((r) => r.json()).then((d) => {
  $('#discordWrap').dataset.off = d.discord ? '0' : '1';
  $('#discordWrap').classList.toggle('hidden', !d.discord);
}).catch(() => {});

let ticket = null; // gesetzt, sobald das Passwort stimmt und noch ein Code fehlt

function showStep(code) {
  $('#stepPw').classList.toggle('hidden', code);
  $('#stepCode').classList.toggle('hidden', !code);
  $('#discordWrap').classList.toggle('hidden', code || $('#discordWrap').dataset.off === '1');
  $('#loginBtn').lastChild.textContent = code ? ' Bestätigen' : ' Anmelden';
  $('#loginUser').required = !code; $('#loginPw').required = !code;
  $('#loginErr').textContent = '';
  if (code) { $('#loginCode').value = ''; $('#loginCode').focus(); } else { ticket = null; $('#loginPw').value = ''; $('#loginPw').focus(); }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  $('#loginErr').textContent = '';
  try {
    const r = ticket
      ? await fetch('/api/login/totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket, code: $('#loginCode').value.trim() }) })
      : await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#loginUser').value.trim(), password: $('#loginPw').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Fehler ' + r.status);
    if (d.totp) { ticket = d.ticket; showStep(true); btn.disabled = false; return; }
    location.href = '/';
  } catch (err) {
    $('#loginErr').textContent = err.message;
    if (ticket) {
      $('#loginCode').value = ''; $('#loginCode').focus();
      if (/abgelaufen/.test(err.message)) showStep(false), ($('#loginErr').textContent = err.message);
    } else { $('#loginPw').value = ''; $('#loginPw').focus(); }
    btn.disabled = false;
  }
});

// Sprache umschalten (Deutsch / English)
document.querySelectorAll('.lang-seg button').forEach((b) => {
  b.classList.toggle('on', b.dataset.lang === LANG);
  b.onclick = () => { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); };
});
