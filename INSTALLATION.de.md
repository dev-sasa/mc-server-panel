# Installation auf einem Linux-Server

**Deutsch** · [English](INSTALLATION.md)

Diese Anleitung bringt das MC Server Panel auf einen Linux-Server (getestet für Debian und Ubuntu) und richtet es so ein, dass es dauerhaft läuft und nach einem Neustart des Servers von selbst startet.

Die Schritte im Überblick:

1. [Voraussetzungen installieren](#1-voraussetzungen)
2. [Dateien auf den Server laden](#2-dateien-hochladen)
3. [Panel einrichten](#3-panel-einrichten)
4. [Als Dienst starten](#4-als-dienst-starten-systemd)
5. [Erster Start und Minecraft-Server einrichten](#5-erster-start)
6. [Absichern und von außen erreichbar machen](#6-absichern-und-erreichbar-machen)

---

## 1. Voraussetzungen

| Was | Version | Wofür |
|---|---|---|
| Node.js | 18 oder neuer | läuft das Panel |
| Java | 21 (für Minecraft ab 1.20.5), sonst 17 | läuft der Minecraft-Server |
| `tar` | beliebig | für Backups (auf jedem Linux vorhanden) |
| `unzip` | beliebig, optional | ZIP-Dateien im Dateimanager entpacken |
| `rsync` und `ssh` | beliebig, optional | Backups auf einen anderen Rechner kopieren |
| ca. 2 GB RAM frei | | Minecraft-Server selbst, je nach Spielerzahl mehr |

```bash
sudo apt update
sudo apt install -y openjdk-21-jre-headless rsync unzip curl
```

**Node.js:** Prüfe zuerst, was schon da ist.

```bash
node -v
```

Zeigt das nichts an oder eine Version unter 18 (zum Beispiel auf Ubuntu 22.04), installiere eine aktuelle Version:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # sollte jetzt v22.x anzeigen
```

**Eigener Benutzer:** Das Panel soll nicht als `root` laufen.

```bash
sudo useradd -r -m -d /opt/mcpanel -s /usr/sbin/nologin mcpanel
```

---

## Schnellweg: Installationsskript oder Docker

Wer die Schritte unten nicht einzeln gehen möchte, hat zwei Abkürzungen. Beide ersetzen die Abschnitte 3 bis 5; **Abschnitt 1 (Voraussetzungen)** und **Abschnitt 6 (Absichern)** gelten weiterhin.

**Installationsskript** (Linux mit systemd). Lade den Projektordner auf den Server hoch (Abschnitt 2) und führe dort aus:

```bash
cd /tmp/mcpanel
sudo bash install.sh
```

Das Skript legt den Benutzer `mcpanel` an, kopiert das Panel nach `/opt/mcpanel`, führt `npm ci` aus, richtet den Dienst `mcpanel` ein und zeigt am Ende das Startpasswort. Anpassen lässt es sich mit Umgebungsvariablen: `INSTALL_DIR`, `SERVICE_USER`, `PANEL_HOST` (Standard `127.0.0.1`, also nur lokal) und `PANEL_PORT`. Beispiel für Zugriff von außen: `sudo PANEL_HOST=0.0.0.0 bash install.sh`. Ein zweiter Aufruf aktualisiert das Panel; Benutzer, Einstellungen und der Minecraft-Server bleiben erhalten. Entfernen: `sudo bash install.sh --uninstall` (die Daten bleiben liegen).

**Docker:** Im Projektordner

```bash
docker compose up -d --build
docker compose logs panel      # beim ersten Start steht hier das Passwort für "admin"
```

Das Image enthält Node.js und Java 21 (für ältere Minecraft-Versionen: `docker build --build-arg JAVA_IMAGE=eclipse-temurin:17-jre .`). Welten, Backups und Einstellungen liegen im Volume `/data`; als Ordner statt Volume einbinden geht mit `./data:/data` (vorher `sudo chown 1000:1000 data`). Veröffentlicht werden Port 8080 (Panel) und 25565 (Minecraft); mit Reverse-Proxy besser `127.0.0.1:8080:8080`. Der Minecraft-Server läuft im Container, das Panel startet ihn also nicht „auf dem Host“.

> **Hinweis:** Das Installationsskript und das Docker-Image wurden mit Skriptprüfung und Compose-Syntaxprüfung getestet, aber nicht auf jedem System ausprobiert. Wenn etwas nicht klappt, sag Bescheid oder gehe die manuellen Schritte unten durch.

---

## 2. Dateien hochladen

Auf **deinem Rechner** (nicht auf dem Server), im Projektordner `MCServerPanel`:

```bash
rsync -av \
  --exclude node_modules --exclude .dev --exclude .env \
  --exclude config.json --exclude server --exclude backups --exclude 'audit.jsonl*' \
  ./ DEIN-USER@SERVER-IP:/tmp/mcpanel/
```

Die Ausnahmen sorgen dafür, dass deine lokalen Testdaten, Benutzer, Backups und Zugangsdaten **nicht** auf den Server gelangen.

Ohne `rsync` geht es auch als Archiv:

```bash
tar czf mcpanel.tar.gz --exclude node_modules --exclude .dev --exclude .env \
  --exclude config.json --exclude server --exclude backups .
scp mcpanel.tar.gz DEIN-USER@SERVER-IP:/tmp/
# auf dem Server:
mkdir -p /tmp/mcpanel && tar xzf /tmp/mcpanel.tar.gz -C /tmp/mcpanel
```

---

## 3. Panel einrichten

Auf dem **Server**:

```bash
sudo mkdir -p /opt/mcpanel
sudo cp -r /tmp/mcpanel/. /opt/mcpanel/
sudo chown -R mcpanel: /opt/mcpanel
cd /opt/mcpanel
sudo -u mcpanel npm install --omit=dev
```

### Optional: Einstellungen in einer `.env`

Lege `/opt/mcpanel/.env` an (Vorlage: `.env.example`). Beispiel:

```ini
# Nur lokal erreichbar (empfohlen, wenn ein Reverse-Proxy davor sitzt)
MCPANEL_HOST=127.0.0.1
MCPANEL_PORT=8080
# Startpasswort für den Benutzer "admin" (gilt nur beim allerersten Start)
MCPANEL_PASSWORD=ein-langes-sicheres-passwort
```

```bash
sudo chown mcpanel: /opt/mcpanel/.env && sudo chmod 600 /opt/mcpanel/.env
```

Alle Möglichkeiten:

| Variable | Bedeutung | Standard |
|---|---|---|
| `MCPANEL_HOST` | Adresse, an der das Panel lauscht (`127.0.0.1` = nur lokal) | `0.0.0.0` |
| `MCPANEL_PORT` | Port des Panels | `8080` |
| `MCPANEL_PASSWORD` | Passwort für `admin` beim ersten Start | zufällig |
| `MCPANEL_DATA` | Ordner für Einstellungen, Protokoll, `server/` und `backups/` | Programmordner |
| `MCPANEL_TRUST_PROXY` | siehe Abschnitt 6 (Reverse-Proxy) | `loopback` |
| `MCPANEL_COOKIE_SECURE` | `1` = Cookie immer mit `Secure`, `0` = nie | automatisch bei HTTPS |
| `DISCORD_WEBHOOK_URL` | Webhook für Benachrichtigungen | im Panel einstellbar |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | Discord-Login fest vorgeben | im Panel einstellbar |

> **Wichtig:** `MCPANEL_DEV` darf auf dem Server **nicht** gesetzt sein. Der Dev-Modus ist nur zum Testen.

---

## 4. Als Dienst starten (systemd)

Dem Projekt liegt eine fertige Dienstdatei bei (`mcpanel.service`).

```bash
sudo cp /opt/mcpanel/mcpanel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mcpanel
sudo systemctl status mcpanel
```

Liegt Node bei dir woanders als `/usr/bin/node` (`which node`), passe `ExecStart=` in der Datei an und lade systemd neu (`sudo systemctl daemon-reload`).

Nützliche Befehle:

```bash
sudo systemctl restart mcpanel     # neu starten
sudo systemctl stop mcpanel        # stoppen (der Minecraft-Server wird dabei sauber beendet)
sudo journalctl -u mcpanel -f      # Log live ansehen
```

---

## 5. Erster Start

**Zugangsdaten:** Beim allerersten Start legt das Panel den Benutzer `admin` an. Das Passwort steht im Log (oder ist das aus `MCPANEL_PASSWORD`):

```bash
sudo journalctl -u mcpanel | grep -A3 "Erster Start"
```

**Panel öffnen:** `http://SERVER-IP:8080` (oder per SSH-Tunnel, siehe unten) und anmelden.

**Minecraft-Server einrichten:**

1. **Installation** → Typ und Version wählen (Paper ist die beste Wahl für die meisten) → *Herunterladen & installieren*.
2. Auf derselben Seite die **EULA** akzeptieren.
3. **Konsole** → *Start*.
4. Unter **Panel** stellst du RAM, Auto-Neustart, Backups und einen täglichen Neustart ein, unter **Benutzer** legst du weitere Zugänge an.

Der Minecraft-Server liegt im Ordner `/opt/mcpanel/server`, Backups in `/opt/mcpanel/backups`.

**Bestehender Minecraft-Server?** Setze in `/opt/mcpanel/config.json` (entsteht beim ersten Start) den Eintrag `"serverDir"` auf den Pfad deines Servers, zum Beispiel `"/home/minecraft/server"`. Der Benutzer `mcpanel` braucht dort Lese- und Schreibrechte. Danach `sudo systemctl restart mcpanel`.

---

## 6. Absichern und erreichbar machen

Das Panel kann Dateien ändern und Befehle auf dem Server ausführen. Setze es deshalb nicht ungeschützt ins Internet.

### Variante A: SSH-Tunnel (am einfachsten, nichts öffnen)

Setze `MCPANEL_HOST=127.0.0.1` in der `.env`, dann `sudo systemctl restart mcpanel`. Auf deinem Rechner:

```bash
ssh -L 8080:localhost:8080 DEIN-USER@SERVER-IP
```

Danach öffnest du `http://localhost:8080` im Browser.

### Variante B: Reverse-Proxy mit HTTPS (für den Zugriff von überall)

Voraussetzung: eine Domain, die auf deinen Server zeigt, zum Beispiel `panel.deinedomain.de`. Das Panel lauscht dabei nur lokal (`MCPANEL_HOST=127.0.0.1`).

**Caddy** (holt das HTTPS-Zertifikat selbst):

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
panel.deinedomain.de {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy setzt `X-Forwarded-For` und `X-Forwarded-Proto` selbst.

**nginx** (mit Zertifikat über Certbot):

```nginx
server {
    server_name panel.deinedomain.de;
    client_max_body_size 4g;               # große Datei-Uploads erlauben

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;       # nötig für die Live-Konsole (WebSocket)
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d panel.deinedomain.de
```

Ergänze in der `location`-Zeile außerdem `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, damit das Panel die echte Adresse des Besuchers kennt.

**Echte Besucher-Adresse (Anmelde-Sperre) und `Secure`-Cookie:** Das Panel sperrt nach fünf falschen Anmeldungen die Adresse des Absenders für eine Minute. Hinter einem Reverse-Proxy sieht es sonst nur die Adresse des Proxys, und ein Angreifer würde alle Besucher mitsperren. Mit `MCPANEL_TRUST_PROXY` sagst du, welchen Proxys das Panel die Angabe `X-Forwarded-For` glauben darf:

| Wert | Bedeutung |
|---|---|
| `loopback` (Standard) | der Proxy läuft auf demselben Rechner (Caddy, nginx wie oben) |
| `1`, `2`, … | so viele Proxys stehen davor (zum Beispiel Cloudflare plus nginx = `2`) |
| `172.18.0.0/16` | Adresse oder Netz des Proxys, zum Beispiel das Docker-Netz |
| `false` | nie vertrauen (nur ohne Proxy sinnvoll) |

Vertraue nur Proxys, die den Header selbst setzen, sonst kann ein Angreifer die Adresse fälschen. Sendet der Proxy außerdem `X-Forwarded-Proto: https`, setzt das Panel das Sitzungs-Cookie automatisch mit `Secure`.

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 25565/tcp      # Minecraft (Java)
sudo ufw allow 80,443/tcp     # nur bei Reverse-Proxy
# sudo ufw allow 19132/udp    # nur bei Geyser/Bedrock
sudo ufw enable
```

Port 8080 bleibt **zu**, wenn du Variante A oder B nutzt.

### Discord-Login (optional)

Funktioniert nur mit einer erreichbaren HTTPS-Adresse (Variante B). Im Panel unter *Panel → Discord-Login* steht die Redirect-URI, die du im Discord Developer Portal eintragen musst, zum Beispiel `https://panel.deinedomain.de/auth/discord/callback`. Sie muss dort zeichengenau übereinstimmen.

---

### Backups auf einen anderen Rechner kopieren (optional)

Unter *Panel → Automatische Backups → Zusätzlich kopieren nach* trägst du ein Ziel ein: einen **Ordner** (`/mnt/nas/backups`) oder einen **anderen Rechner** per SSH (`benutzer@host:/ordner/backups`). Mit „Testen“ prüfst du es. Für SSH muss der Dienstbenutzer (`mcpanel`) einen Schlüssel **ohne Passwort** haben und den anderen Rechner **einmal von Hand bestätigt** haben:

```bash
sudo -u mcpanel ssh-keygen -t ed25519 -N "" -f /opt/mcpanel/.ssh/id_ed25519
sudo -u mcpanel ssh-copy-id -i /opt/mcpanel/.ssh/id_ed25519.pub benutzer@host   # fragt einmal nach dem Passwort
sudo -u mcpanel ssh benutzer@host true                                          # bestätigt den Server-Schlüssel
```

Auf dem Ziel muss `rsync` installiert sein. Das Panel räumt am Ziel nicht auf (die Aufbewahrung gilt nur für den eigenen Backup-Ordner).

## Aktualisieren

Auf deinem Rechner den `rsync`-Befehl aus Schritt 2 wiederholen, dann auf dem Server:

```bash
sudo cp -r /tmp/mcpanel/. /opt/mcpanel/
sudo chown -R mcpanel: /opt/mcpanel
cd /opt/mcpanel && sudo -u mcpanel npm install --omit=dev
sudo systemctl restart mcpanel
```

Benutzer, Einstellungen, Protokoll und der Minecraft-Server bleiben erhalten, denn `config.json`, `audit.jsonl`, `server/` und `backups/` werden nicht überschrieben. Beim Neustart des Panels werden alle Anmeldungen beendet, du meldest dich einfach neu an.

## Sichern

Wichtig sind diese Dateien in `/opt/mcpanel`:

| Pfad | Inhalt |
|---|---|
| `config.json` | Einstellungen, Benutzer (Passwörter nur als Hash), Discord-Zugang |
| `server/` | der Minecraft-Server mit Welt |
| `backups/` | Panel-Backups |
| `audit.jsonl` | Protokoll |

Beispiel für ein Backup des Panels selbst:

```bash
sudo tar czf ~/mcpanel-sicherung.tar.gz -C /opt mcpanel --exclude=mcpanel/node_modules
```

Für den Minecraft-Server nutzt du am besten die Backup-Funktion im Panel und lädst die Archive von dort herunter.

---

## Problemlösung

| Problem | Lösung |
|---|---|
| `Java konnte nicht gestartet werden` / Server startet nicht | `java -version` prüfen. Unter *Panel → Java-Pfad* den vollen Pfad eintragen (`which java`). |
| Panel startet nicht | `sudo journalctl -u mcpanel -n 50`. Häufig: Port 8080 belegt (`MCPANEL_PORT` ändern) oder falsche Rechte (`sudo chown -R mcpanel: /opt/mcpanel`). |
| `EACCES`/Schreibfehler | Der Benutzer `mcpanel` braucht Schreibrechte auf `/opt/mcpanel` und auf den Server-Ordner. |
| Seite lädt, aber Konsole bleibt leer | Reverse-Proxy leitet WebSockets nicht weiter. Bei nginx die `Upgrade`-Zeilen oben ergänzen. |
| Upload großer Dateien bricht ab | Bei nginx `client_max_body_size` erhöhen. |
| Discord-Login: „Invalid redirect_uri“ | Redirect-URI im Developer Portal stimmt nicht zeichengenau mit der im Panel angezeigten überein (http/https, Domain, Pfad). |
| Passwort vergessen | Siehe unten. |

**Passwort vergessen (alle Benutzer zurücksetzen):**

```bash
sudo systemctl stop mcpanel
sudo nano /opt/mcpanel/config.json    # den Eintrag  "users": [ ... ]  durch  "users": []  ersetzen
sudo systemctl start mcpanel
sudo journalctl -u mcpanel | grep -A3 "Erster Start"   # neues Passwort für "admin"
```

Das löscht **alle** Panel-Benutzer. Der Minecraft-Server und seine Daten sind davon nicht betroffen.

## Deinstallieren

```bash
sudo systemctl disable --now mcpanel
sudo rm /etc/systemd/system/mcpanel.service
sudo systemctl daemon-reload
# Daten und Programm entfernen (enthält auch den Minecraft-Server!):
# sudo rm -rf /opt/mcpanel
```
