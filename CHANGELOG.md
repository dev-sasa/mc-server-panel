# Changelog

Alle wichtigen Änderungen an diesem Projekt stehen hier. Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [1.0.1] – 2026-11-23

### Hinzugefügt
- Die Dokumentation ist jetzt zweisprachig: `README.md` und `INSTALLATION.md` sind englisch (Standard auf GitHub), die deutschen Fassungen heißen `README.de.md` und `INSTALLATION.de.md`.
- **Spielerstatistik rückwirkend:** Neue Ansicht „Alle Spieler & Statistik“ mit Spielzeit, Toden und Mob-Kills (aus den Statistikdateien der Welt, also auch für die Zeit vor dem Panel), zuletzt gesehen, erstem Besuch und Beitritten (aus Logs und Spielerdaten, dazu eine Merkdatei `playerlog.json`). Ein Klick auf einen Spieler zeigt Details und den **Ban-Verlauf** mit Begründung, aus aktuellen Bans, Logs und dem Panel-Protokoll.
- **Vorhandenen Server einbinden:** Auf der Seite „Installation“ erkennt „Server-Ordner prüfen“ Start-Datei, Server-Software und Minecraft-Version (auch Forge und NeoForge über die Argumentdatei) und übernimmt sie auf Wunsch.
- Die Laufzeit steht neben „Läuft“ in der Statusanzeige (Sekunden immer zweistellig). Mods lassen sich nach „läuft auf dem Server“ oder „nur Client“ filtern, jeder Treffer hat einen Knopf „Bei Modrinth öffnen“. Die Spielerauswahl in den Logs zeigt Avatare.
- **Direktnachrichten (DM)** in Discord: Mit einem Bot-Token (Panel → Benachrichtigungen) kann jeder Benutzer unter „Mein Konto“ wählen, Hinweise privat zu bekommen, inklusive Test-Nachricht. Der Token wird nie angezeigt.
- Sprachumschalter als Feld „DE | EN“ (oben, auf der Anmeldeseite und unter „Mein Konto“). Der Menüpunkt „Logs“ steht jetzt in der Gruppe „Server“.
- **Logs-Seite:** alle Logdateien (aktuell, gepackt, Absturzberichte) lesen und durchsuchen, mit Filtern nach Spieler, Art, Ebene und Datum, Hervorhebung der Treffer und Download. Neues Recht „Server-Logs durchsuchen“ (Moderatoren haben es).
- **Mein Konto** als eigene Seite: Minecraft-Account, Discord-ID (mit Passwort), Passwort, 2FA, „Überall abmelden“ und **persönliche Benachrichtigungen** (Hinweis im Panel, Browser-Mitteilung, je Ereignis wählbar).
- **Panel-Seite überarbeitet:** Bereiche als Reiter (Server, Automatik & Backups, Benachrichtigungen, Anmeldung), Kurzbeschreibungen und eine Markierung bei ungespeicherten Änderungen.
- **Zwei-Faktor-Anmeldung** (TOTP, RFC 6238) mit Authenticator-App, QR-Code und acht Wiederherstellungscodes. Admins können sie für Benutzer zurücksetzen. Die Anmeldung per Discord bleibt ohne zweiten Faktor.
- **Mods und Plugins** über Modrinth suchen und mit einem Klick installieren (inklusive Pflicht-Abhängigkeiten, SHA-512-Prüfung, Update-Prüfung, Entfernen). Neue Seite `/mods`.
- **TPS und MSPT** im Dashboard (Paper-Familie über `tps`/`mspt`, Vanilla und Fabric über `tick query`). Die Laufzeit steht jetzt im Kopf der Karte, der System-RAM bei der RAM-Kachel.
- Die **Spielerliste** wird alle 90 Sekunden mit `list` abgeglichen, damit niemand fehlt oder hängen bleibt. Die Antworten der automatischen Abfragen erscheinen nicht in der Konsole.
- **Discord-Benachrichtigungen** per Webhook (online, gestoppt, Absturz, Backup, Lag, Spieler kommen und gehen) mit Testknopf.
- Backups: **Speicherplatz-Prüfung** vor dem Sichern, **Prüfung des Archivs** danach (defekte Backups werden verworfen), Anzeige des freien Speichers, Schaltfläche zum erneuten Prüfen und **optionale Kopie** in einen anderen Ordner oder per rsync/SSH auf einen anderen Rechner.
- Dateimanager: **Upload mit Fortschritt** und **Drag & Drop**, **Mehrfachauswahl** (löschen, als `.tar.gz` laden), **Archive entpacken** (`.zip`, `.tar.gz`, `.tgz`, `.tar`; unsichere Archive mit Pfaden nach außen oder Symlinks werden abgelehnt) und Filter.
- **Deutsch und Englisch** (Schalter oben rechts und auf der Anmeldeseite).
- **Docker:** `Dockerfile` und `docker-compose.yml` (Panel und Java 21 in einem Image). **`install.sh`** richtet das Panel als systemd-Dienst ein.
- **Automatische Tests** (`npm test`, rund 50 Tests) und eine CI-Stufe, die sie ausführt, dazu ein Docker-Build.
- Umgebungsvariablen `MCPANEL_DATA` (Datenordner), `MCPANEL_TRUST_PROXY`, `MCPANEL_COOKIE_SECURE`, `DISCORD_WEBHOOK_URL`.
- **Eigene Rollen mit einzelnen Rechten** (elf Rechte, zum Beispiel Server steuern, Dateien, Einstellungen, Protokoll). Admins legen Rollen an, ändern und löschen sie und weisen sie Benutzern zu. Wer Benutzer verwalten darf, kann nur Rollen vergeben und Benutzer bearbeiten, deren Rechte er selbst hat.

### Geändert
- Der Quelltext ist in Module aufgeteilt (`lib/` und `routes/`); das Verhalten bleibt gleich. Die Aufteilung ist durch die neuen Tests abgesichert.
- **Sicherheit:** Das Sitzungs-Cookie bekommt bei HTTPS das `Secure`-Flag. Die Anmelde-Sperre zählt je echter Besucher-Adresse (`X-Forwarded-For`, nur von vertrauenswürdigen Proxys, Standard `loopback`) statt je Proxy-Adresse. Die Redirect-URI für Discord folgt demselben Schutz.
- Beim Lesen einer fehlenden Datei meldet der Dateimanager „nicht gefunden“ (404) statt eines Serverfehlers.
- Menü, Seiten und Schaltflächen richten sich nach den einzelnen Rechten statt nach drei Stufen.
- Backups: Neben dem Intervall gibt es jetzt **feste Uhrzeiten** (zum Beispiel täglich 04:00).
- Backups: Ordner und Dateien lassen sich vom Backup **ausschließen** (Standard: `logs`, `crash-reports`, `cache`).
- Wiederherstellen: Es lässt sich **alles** oder eine **Auswahl** von Ordnern und Dateien zurückspielen. Der bisherige Stand der gewählten Einträge bleibt in `server.before-restore`; bei einem Fehler wird automatisch zurückgerollt.
- Ein geplanter Neustart wartet, bis ein laufendes Backup fertig ist.

## [1.0.0] – 2026-11-23

Erste veröffentlichte Version.

### Hinzugefügt
- Dashboard mit Status, Spielerköpfen, CPU- und RAM-Kurven, Live-Konsole mit Filter und Suche, Befehle senden, Start/Stop/Neustart/Kill.
- Installation von Paper, Purpur, Folia, Fabric, Forge, NeoForge und Vanilla.
- `server.properties` als gruppierte Liste mit Schaltern und Erklärungen.
- Dateimanager mit Texteditor, Upload und Download.
- Spielerverwaltung (Whitelist, OP, Kick, Ban) mit Mojang-Prüfung; Erkennung von Bedrock-Spielern (Geyser/Floodgate), Whitelist über `/fwhitelist`.
- Backups: manuell und automatisch, Download und Wiederherstellung.
- Automatik: Neustart nach Absturz, geplanter täglicher Neustart mit Chat-Warnung, Backup-Zeitplan.
- Benutzer mit Rollen (Admin, Moderator, Betrachter), geschütztem Hauptbenutzer, Minecraft-Avatar und Discord-Login.
- Protokoll aller Aktionen für Admins (ohne IP-Adressen).
- Helles und dunkles Design, einklappbares Seitenmenü, mobile Ansicht.
- Dev-Modus mit simuliertem Minecraft-Server (`npm run dev`).
- Anleitung für die Installation auf einem Linux-Server (`INSTALLATION.de.md`).

[1.0.1]: https://github.com/dev-sasa/mc-server-panel/releases/tag/v1.0.1
[1.0.0]: https://github.com/dev-sasa/mc-server-panel/releases/tag/v1.0.0
