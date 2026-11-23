'use strict';
// Zweiter Faktor je Benutzer: u.totp = { enabled, secret, last, recovery: [sha256 der Wiederherstellungscodes] }
const { saveConfig } = require('./core');
const totp = require('./totp');

const has2fa = (u) => !!(u && u.totp && u.totp.enabled && u.totp.secret);

/** Prüft Authenticator-Code oder Wiederherstellungscode. Verbraucht den Code (kein zweites Mal verwendbar). Gibt 'totp' | 'recovery' | null zurück. */
function checkSecondFactor(u, input) {
  if (!has2fa(u)) return null;
  const c = totp.verify(u.totp.secret, input, u.totp.last ?? -1);
  if (c !== null) { u.totp.last = c; saveConfig(); return 'totp'; }
  const h = totp.hashRecovery(input);
  const i = (u.totp.recovery || []).indexOf(h);
  if (i >= 0 && totp.normRecovery(input).length >= 8) { u.totp.recovery.splice(i, 1); saveConfig(); return 'recovery'; }
  return null;
}

module.exports = { has2fa, checkSecondFactor };
