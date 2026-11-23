# Mitmachen

**Deutsch** · [English](CONTRIBUTING.md)

Danke, dass du helfen möchtest. Fehler melden, Ideen vorschlagen und Pull Requests sind willkommen.

## Fehler und Wünsche

- Suche zuerst in den [Issues](../../issues), ob es das Thema schon gibt.
- Nutze die Vorlagen für **Fehler** und **Funktionswünsche**.
- **Sicherheitslücken** meldest du nicht als Issue, sondern wie in [SECURITY.de.md](SECURITY.de.md) beschrieben.

## Entwicklung einrichten

Du brauchst nur Node.js ≥ 18. Java und ein echter Minecraft-Server sind nicht nötig.

```bash
git clone https://github.com/dev-sasa/mc-server-panel.git
cd mc-server-panel
npm install
npm run dev
```

Das Panel läuft dann auf `http://127.0.0.1:8080` (Benutzer `admin`, Passwort `dev`) mit einem simulierten Server. Alle Daten liegen in `.dev/`.

## Vor dem Pull Request

1. Lege einen Branch an: `git checkout -b mein-feature`.
2. Halte dich an den bestehenden Stil: reines JavaScript ohne Build-Schritt, zwei Leerzeichen Einrückung (siehe `.editorconfig`), deutsche Texte in der Oberfläche. Die englischen Texte kommen nach `public/i18n-en.js`; `node dev/i18n-extract.js` zeigt, was noch fehlt.
3. Prüfe die Syntax und die Tests: `npm run check` und `npm test`. Neue Endpunkte und Regeln sollten einen Test bekommen (siehe `test/`).
4. Probiere deine Änderung im Dev-Modus aus, auch im hellen und dunklen Design und in der schmalen (mobilen) Ansicht, wenn du die Oberfläche anfasst.
5. Rechte und Eingaben prüft der **Server**, nicht nur die Oberfläche. Neue Endpunkte brauchen daher einen Eintrag in `requiredPerm` in `lib/auth.js` und eine Prüfung der Eingaben.
6. Schreibe in die Beschreibung, was du geändert hast und wie du es getestet hast.

## Grundsätze

- **Keine IP-Adressen** oder andere personenbezogene Daten ins Protokoll schreiben.
- **Keine neuen externen Dienste** und keine Skripte oder Schriften von Dritten einbinden, ohne es in der README.de.md unter „Datenschutz und externe Dienste“ aufzuführen.
- Neue Abhängigkeiten nur, wenn sie wirklich nötig sind. Das Projekt soll klein und leicht zu prüfen bleiben.
- Passwörter, Zugangsdaten und die Dateien `config.json`, `.env`, `audit.jsonl` gehören nie in einen Commit.
