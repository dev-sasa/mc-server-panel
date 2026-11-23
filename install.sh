#!/usr/bin/env bash
# MC Server Panel auf einem Linux-Server als systemd-Dienst einrichten.
#
#   sudo bash install.sh              einrichten oder aktualisieren
#   sudo bash install.sh --uninstall  Dienst entfernen (Daten bleiben erhalten)
#
# Einstellbar über Umgebungsvariablen (Standardwerte in Klammern):
#   INSTALL_DIR  (/opt/mcpanel)   wohin das Panel kopiert wird; hier liegen auch config.json, server/ und backups/
#   SERVICE_USER (mcpanel)        unter diesem Benutzer läuft das Panel (wird angelegt, falls es ihn nicht gibt)
#   PANEL_HOST   (127.0.0.1)      0.0.0.0 = von außen erreichbar, 127.0.0.1 = nur lokal (z. B. hinter einem Reverse-Proxy)
#   PANEL_PORT   (8080)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/mcpanel}"
SERVICE_USER="${SERVICE_USER:-mcpanel}"
PANEL_HOST="${PANEL_HOST:-127.0.0.1}"
PANEL_PORT="${PANEL_PORT:-8080}"
UNIT=/etc/systemd/system/mcpanel.service
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen:  sudo bash install.sh"
command -v systemctl >/dev/null || die "systemd wird gebraucht (systemctl nicht gefunden). Auf anderen Systemen: siehe INSTALLATION.de.md."

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now mcpanel 2>/dev/null || true
  rm -f "$UNIT"; systemctl daemon-reload
  say "Dienst entfernt. Programm und Daten liegen weiter in $INSTALL_DIR (bei Bedarf selbst löschen)."
  exit 0
fi

# --- Voraussetzungen ---
command -v node >/dev/null || die "Node.js fehlt. Installiere Node.js 18 oder neuer (siehe INSTALLATION.de.md, Abschnitt 1)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js $NODE_MAJOR ist zu alt, gebraucht wird 18 oder neuer."
command -v npm >/dev/null || die "npm fehlt (meist ein eigenes Paket: sudo apt install npm)."
command -v tar >/dev/null || die "tar fehlt."
command -v java >/dev/null || warn "Java wurde nicht gefunden. Der Minecraft-Server braucht es (Java 21 für Minecraft ab 1.20.5). Das Panel selbst läuft auch ohne."
command -v unzip >/dev/null || warn "unzip fehlt – ZIP-Dateien lassen sich im Dateimanager dann nicht entpacken (sudo apt install unzip)."
NODE_BIN="$(command -v node)"

# --- Benutzer ---
if id "$SERVICE_USER" >/dev/null 2>&1; then
  say "Benutzer $SERVICE_USER ist schon vorhanden."
else
  say "Lege Benutzer $SERVICE_USER an."
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# --- Dateien kopieren (Daten wie config.json, server/ und backups/ bleiben unberührt) ---
mkdir -p "$INSTALL_DIR"
if [ "$(cd "$INSTALL_DIR" && pwd)" != "$SRC" ]; then
  say "Kopiere das Panel nach $INSTALL_DIR."
  for item in server.js CHANGELOG.md CHANGELOG.de.md package.json package-lock.json lib routes public dev mcpanel.service LICENSE; do
    [ -e "$SRC/$item" ] && { rm -rf "${INSTALL_DIR:?}/$item"; cp -R "$SRC/$item" "$INSTALL_DIR/$item"; }
  done
fi
chown -R "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" "$INSTALL_DIR"

# --- Abhängigkeiten ---
say "Installiere Abhängigkeiten (npm ci)."
if command -v runuser >/dev/null; then RUN_AS=(runuser -u "$SERVICE_USER" --); else RUN_AS=(su -s /bin/sh "$SERVICE_USER" -c); fi
if [ "${RUN_AS[0]}" = runuser ]; then
  (cd "$INSTALL_DIR" && "${RUN_AS[@]}" npm ci --omit=dev --no-audit --no-fund)
else
  "${RUN_AS[@]}" "cd '$INSTALL_DIR' && npm ci --omit=dev --no-audit --no-fund"
fi

# --- systemd ---
say "Richte den Dienst ein ($UNIT)."
cat > "$UNIT" <<UNITEOF
[Unit]
Description=MC Server Panel
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=MCPANEL_HOST=$PANEL_HOST
Environment=MCPANEL_PORT=$PANEL_PORT
ExecStart=$NODE_BIN server.js
Restart=on-failure
RestartSec=5
# Gibt dem Minecraft-Server Zeit zum sauberen Speichern beim Beenden
TimeoutStopSec=60
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable mcpanel >/dev/null 2>&1
systemctl restart mcpanel

# --- Ergebnis ---
say "Fertig. Das Panel läuft auf http://$PANEL_HOST:$PANEL_PORT"
sleep 3
PW="$(journalctl -u mcpanel --no-pager -n 50 2>/dev/null | sed -n 's/.*Passwort: //p' | tail -n1 || true)"
if [ -n "$PW" ]; then
  echo
  echo "  Erster Start – Benutzer: admin"
  echo "  Passwort: $PW   (nach dem Anmelden unter „Benutzer“ ändern)"
  echo
fi
echo "Status:   systemctl status mcpanel"
echo "Log:      journalctl -u mcpanel -f"
[ "$PANEL_HOST" = "127.0.0.1" ] && echo "Hinweis:  Nur lokal erreichbar. Zugriff von außen: SSH-Tunnel oder Reverse-Proxy (INSTALLATION.de.md, Abschnitt 6) – oder mit PANEL_HOST=0.0.0.0 erneut ausführen."
exit 0
