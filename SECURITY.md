# Sicherheit

Das MC Server Panel kann Dateien auf dem Server ändern, Befehle ausführen und Prozesse steuern. Sicherheitslücken sind deshalb besonders ernst.

## Schwachstelle melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue oder in einer Diskussion.

Nutze stattdessen die private Meldefunktion von GitHub:

1. Öffne den Reiter **Security** dieses Repositorys.
2. Klicke auf **Report a vulnerability**.
3. Beschreibe, was passiert, wie man es nachstellt und welche Version betroffen ist.

Ich antworte so schnell wie möglich, bitte gib mir aber einige Tage Zeit. Bis ein Fix veröffentlicht ist, bitte nichts öffentlich machen. Auf Wunsch nenne ich dich im Changelog als Entdecker.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils **neueste Version** (Branch `main`).

## Was als Schwachstelle zählt

Zum Beispiel:

- Zugriff auf das Panel oder auf Dateien außerhalb des Server-Ordners ohne Anmeldung oder ohne passende Rolle
- Umgehen der Rollenprüfung (zum Beispiel ein Betrachter, der Befehle ausführen kann)
- Auslesen von Passwörtern, Sitzungen, 2FA-Schlüsseln, der Webhook-Adresse oder dem Discord-Secret
- Umgehen der Zwei-Faktor-Anmeldung oder der Anmelde-Sperre (außer über die bewusst vertrauenswürdige Discord-Anmeldung)
- Entpacken von Archiven, das Dateien außerhalb des Server-Ordners schreibt
- Einschleusen von Befehlen oder Skripten (Command Injection, XSS, CSRF)

Nicht dazu zählen: Probleme, die einen bereits angemeldeten Admin voraussetzen (er darf ohnehin Befehle ausführen), und fehlende Härtung durch eine ungeschützte Installation, etwa Betrieb ohne HTTPS im offenen Internet.

## Empfehlungen für den Betrieb

- Das Panel nur hinter HTTPS betreiben oder per SSH-Tunnel erreichen, nicht ungeschützt im Internet.
- Mit einem eigenen Benutzer starten, nie als `root`.
- Lange, einmalige Passwörter nutzen, die Zwei-Faktor-Anmeldung einschalten und den Hauptbenutzer schützen.
- Hinter einem Reverse-Proxy `MCPANEL_TRUST_PROXY` passend setzen (siehe INSTALLATION.de.md), damit die Anmelde-Sperre die echten Besucher zählt.
- `config.json` und `.env` nicht weitergeben. Sie enthalten Passwort-Hashes und Zugangsdaten.
- Das Panel und Node.js aktuell halten.

Mehr dazu steht in [INSTALLATION.de.md](INSTALLATION.de.md) im Abschnitt „Absichern und erreichbar machen“.
