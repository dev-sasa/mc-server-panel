# Installation on a Linux server

[Deutsch](INSTALLATION.de.md) · **English**

This guide gets the MC Server Panel onto a Linux server (tested on Debian and Ubuntu) and sets it up so that it runs permanently and starts by itself after the server reboots.

The steps at a glance:

1. [Install the prerequisites](#1-prerequisites)
2. [Upload the files to the server](#2-uploading-the-files)
3. [Set up the panel](#3-setting-up-the-panel)
4. [Start it as a service](#4-starting-as-a-service-systemd)
5. [First start and setting up the Minecraft server](#5-first-start)
6. [Securing it and making it reachable](#6-securing-and-making-it-reachable)

---

## 1. Prerequisites

| What | Version | Used for |
|---|---|---|
| Node.js | 18 or newer | runs the panel |
| Java | 21 (for Minecraft 1.20.5 and later), otherwise 17 | runs the Minecraft server |
| `tar` | any | for backups (present on every Linux) |
| `unzip` | any, optional | extract ZIP files in the file manager |
| `rsync` and `ssh` | any, optional | copy backups to another machine |
| about 2 GB RAM free | | the Minecraft server itself, more depending on player count |

```bash
sudo apt update
sudo apt install -y openjdk-21-jre-headless rsync unzip curl
```

**Node.js:** First check what is already there.

```bash
node -v
```

If that shows nothing or a version below 18 (for example on Ubuntu 22.04), install a current version:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should now show v22.x
```

**Dedicated user:** The panel should not run as `root`.

```bash
sudo useradd -r -m -d /opt/mcpanel -s /usr/sbin/nologin mcpanel
```

---

## Shortcut: installation script or Docker

If you do not want to go through the steps below one by one, there are two shortcuts. Both replace sections 3 to 5; **section 1 (prerequisites)** and **section 6 (securing)** still apply.

**Installation script** (Linux with systemd). Upload the project folder to the server (section 2) and run there:

```bash
cd /tmp/mcpanel
sudo bash install.sh
```

The script creates the user `mcpanel`, copies the panel to `/opt/mcpanel`, runs `npm ci`, sets up the `mcpanel` service and shows the initial password at the end. You can customize it with environment variables: `INSTALL_DIR`, `SERVICE_USER`, `PANEL_HOST` (default `127.0.0.1`, i.e. local only) and `PANEL_PORT`. Example for access from outside: `sudo PANEL_HOST=0.0.0.0 bash install.sh`. A second run updates the panel; users, settings and the Minecraft server are kept. To remove it: `sudo bash install.sh --uninstall` (the data stays in place).

**Docker:** In the project folder

```bash
docker compose up -d --build
docker compose logs panel      # on first start, the password for "admin" appears here
```

The image contains Node.js and Java 21 (for older Minecraft versions: `docker build --build-arg JAVA_IMAGE=eclipse-temurin:17-jre .`). Worlds, backups and settings live in the `/data` volume; to mount a folder instead of a volume, use `./data:/data` (run `sudo chown 1000:1000 data` first). Ports 8080 (panel) and 25565 (Minecraft) are published; with a reverse proxy, prefer `127.0.0.1:8080:8080`. The Minecraft server runs inside the container, so the panel does not start it "on the host".

> **Note:** The installation script and the Docker image were tested with script checking and Compose syntax checking, but not tried out on every system. If something does not work, let us know or go through the manual steps below.

---

## 2. Uploading the files

On **your computer** (not on the server), in the `MCServerPanel` project folder:

```bash
rsync -av \
  --exclude node_modules --exclude .dev --exclude .env \
  --exclude config.json --exclude server --exclude backups --exclude 'audit.jsonl*' \
  ./ DEIN-USER@SERVER-IP:/tmp/mcpanel/
```

The exclusions make sure that your local test data, users, backups and credentials do **not** end up on the server.

Without `rsync`, an archive works too:

```bash
tar czf mcpanel.tar.gz --exclude node_modules --exclude .dev --exclude .env \
  --exclude config.json --exclude server --exclude backups .
scp mcpanel.tar.gz DEIN-USER@SERVER-IP:/tmp/
# on the server:
mkdir -p /tmp/mcpanel && tar xzf /tmp/mcpanel.tar.gz -C /tmp/mcpanel
```

---

## 3. Setting up the panel

On the **server**:

```bash
sudo mkdir -p /opt/mcpanel
sudo cp -r /tmp/mcpanel/. /opt/mcpanel/
sudo chown -R mcpanel: /opt/mcpanel
cd /opt/mcpanel
sudo -u mcpanel npm install --omit=dev
```

### Optional: settings in a `.env`

Create `/opt/mcpanel/.env` (template: `.env.example`). Example:

```ini
# Reachable locally only (recommended when a reverse proxy sits in front)
MCPANEL_HOST=127.0.0.1
MCPANEL_PORT=8080
# Initial password for the user "admin" (applies only on the very first start)
MCPANEL_PASSWORD=ein-langes-sicheres-passwort
```

```bash
sudo chown mcpanel: /opt/mcpanel/.env && sudo chmod 600 /opt/mcpanel/.env
```

All options:

| Variable | Meaning | Default |
|---|---|---|
| `MCPANEL_HOST` | Address the panel listens on (`127.0.0.1` = local only) | `0.0.0.0` |
| `MCPANEL_PORT` | Port of the panel | `8080` |
| `MCPANEL_PASSWORD` | Password for `admin` on first start | random |
| `MCPANEL_DATA` | Folder for settings, activity log, `server/` and `backups/` | program folder |
| `MCPANEL_TRUST_PROXY` | see section 6 (reverse proxy) | `loopback` |
| `MCPANEL_COOKIE_SECURE` | `1` = cookie always with `Secure`, `0` = never | automatic with HTTPS |
| `DISCORD_WEBHOOK_URL` | Webhook for notifications | configurable in the panel |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | Preset the Discord login | configurable in the panel |

> **Important:** `MCPANEL_DEV` must **not** be set on the server. Dev mode is for testing only.

---

## 4. Starting as a service (systemd)

The project includes a ready-made service file (`mcpanel.service`).

```bash
sudo cp /opt/mcpanel/mcpanel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mcpanel
sudo systemctl status mcpanel
```

If Node is somewhere other than `/usr/bin/node` on your system (`which node`), adjust `ExecStart=` in the file and reload systemd (`sudo systemctl daemon-reload`).

Useful commands:

```bash
sudo systemctl restart mcpanel     # restart
sudo systemctl stop mcpanel        # stop (the Minecraft server is shut down cleanly)
sudo journalctl -u mcpanel -f      # follow the log live
```

---

## 5. First start

**Credentials:** On the very first start, the panel creates the user `admin`. The password is in the log (or is the one from `MCPANEL_PASSWORD`):

```bash
sudo journalctl -u mcpanel | grep -A3 "Erster Start"
```

(The log is written in German; "Erster Start" means "first start".)

**Open the panel:** `http://SERVER-IP:8080` (or via SSH tunnel, see below) and sign in.

**Set up the Minecraft server:**

1. **Install** → choose type and version (Paper is the best choice for most people) → *Download & install*.
2. On the same page, accept the **EULA**.
3. **Console** → *Start*.
4. Under **Panel** you configure RAM, auto-restart, backups and a daily restart; under **Users** you create additional accounts.

The Minecraft server lives in the folder `/opt/mcpanel/server`, backups in `/opt/mcpanel/backups`.

**Existing Minecraft server?** In `/opt/mcpanel/config.json` (created on first start), set the entry `"serverDir"` to the path of your server, for example `"/home/minecraft/server"`. The user `mcpanel` needs read and write permissions there. Then run `sudo systemctl restart mcpanel`.

---

## 6. Securing and making it reachable

The panel can change files and run commands on the server. Therefore, do not expose it unprotected to the internet.

### Option A: SSH tunnel (simplest, nothing to open)

Set `MCPANEL_HOST=127.0.0.1` in the `.env`, then `sudo systemctl restart mcpanel`. On your computer:

```bash
ssh -L 8080:localhost:8080 DEIN-USER@SERVER-IP
```

Then open `http://localhost:8080` in your browser.

### Option B: Reverse proxy with HTTPS (for access from anywhere)

Prerequisite: a domain pointing to your server, for example `panel.deinedomain.de`. The panel listens only locally (`MCPANEL_HOST=127.0.0.1`).

**Caddy** (obtains the HTTPS certificate by itself):

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

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` itself.

**nginx** (with a certificate via Certbot):

```nginx
server {
    server_name panel.deinedomain.de;
    client_max_body_size 4g;               # allow large file uploads

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;       # required for the live console (WebSocket)
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d panel.deinedomain.de
```

Also add `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` to the `location` block so the panel knows the visitor's real address.

**Real visitor address (login lockout) and `Secure` cookie:** After five failed logins, the panel blocks the sender's address for one minute. Behind a reverse proxy it would otherwise only see the proxy's address, and an attacker would lock out all visitors along with themselves. With `MCPANEL_TRUST_PROXY` you tell the panel which proxies it may believe when they send `X-Forwarded-For`:

| Value | Meaning |
|---|---|
| `loopback` (default) | the proxy runs on the same machine (Caddy, nginx as above) |
| `1`, `2`, … | that many proxies sit in front (for example Cloudflare plus nginx = `2`) |
| `172.18.0.0/16` | address or network of the proxy, for example the Docker network |
| `false` | never trust (only sensible without a proxy) |

Trust only proxies that set the header themselves, otherwise an attacker can forge the address. If the proxy also sends `X-Forwarded-Proto: https`, the panel automatically sets the session cookie with `Secure`.

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 25565/tcp      # Minecraft (Java)
sudo ufw allow 80,443/tcp     # only with a reverse proxy
# sudo ufw allow 19132/udp    # only for Geyser/Bedrock
sudo ufw enable
```

Port 8080 stays **closed** if you use option A or B.

### Discord login (optional)

Works only with a reachable HTTPS address (option B). In the panel under *Panel → Discord login* you will find the redirect URI that you must enter in the Discord Developer Portal, for example `https://panel.deinedomain.de/auth/discord/callback`. It must match there character for character.

---

### Copying backups to another machine (optional)

Under *Panel → Automatic backups → Additionally copy to* you enter a destination: a **folder** (`/mnt/nas/backups`) or **another machine** via SSH (`benutzer@host:/ordner/backups`). Use "Test" to check it. For SSH, the service user (`mcpanel`) needs a key **without a passphrase** and must have **confirmed the other machine once by hand**:

```bash
sudo -u mcpanel ssh-keygen -t ed25519 -N "" -f /opt/mcpanel/.ssh/id_ed25519
sudo -u mcpanel ssh-copy-id -i /opt/mcpanel/.ssh/id_ed25519.pub benutzer@host   # asks for the password once
sudo -u mcpanel ssh benutzer@host true                                          # confirms the server key
```

`rsync` must be installed on the destination. The panel does not clean up at the destination (retention applies only to its own backup folder).

## Updating

On your computer, repeat the `rsync` command from step 2, then on the server:

```bash
sudo cp -r /tmp/mcpanel/. /opt/mcpanel/
sudo chown -R mcpanel: /opt/mcpanel
cd /opt/mcpanel && sudo -u mcpanel npm install --omit=dev
sudo systemctl restart mcpanel
```

Users, settings, activity log and the Minecraft server are kept, because `config.json`, `audit.jsonl`, `server/` and `backups/` are not overwritten. When the panel restarts, all sessions are ended; just sign in again.

## Backing up

These files in `/opt/mcpanel` are the important ones:

| Path | Content |
|---|---|
| `config.json` | Settings, users (passwords only as hashes), Discord credentials |
| `server/` | the Minecraft server with world |
| `backups/` | Panel backups |
| `audit.jsonl` | Activity log |

Example of a backup of the panel itself:

```bash
sudo tar czf ~/mcpanel-sicherung.tar.gz -C /opt mcpanel --exclude=mcpanel/node_modules
```

For the Minecraft server, it is best to use the panel's backup feature and download the archives from there.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Java konnte nicht gestartet werden` / server does not start | Check `java -version`. Under *Panel → Java path* enter the full path (`which java`). |
| Panel does not start | `sudo journalctl -u mcpanel -n 50`. Common causes: port 8080 in use (change `MCPANEL_PORT`) or wrong permissions (`sudo chown -R mcpanel: /opt/mcpanel`). |
| `EACCES`/write error | The user `mcpanel` needs write permissions on `/opt/mcpanel` and on the server folder. |
| Page loads, but console stays empty | The reverse proxy does not forward WebSockets. With nginx, add the `Upgrade` lines from above. |
| Upload of large files aborts | With nginx, increase `client_max_body_size`. |
| Discord login: "Invalid redirect_uri" | The redirect URI in the Developer Portal does not match the one shown in the panel character for character (http/https, domain, path). |
| Forgot password | See below. |

**Forgot password (reset all users):**

```bash
sudo systemctl stop mcpanel
sudo nano /opt/mcpanel/config.json    # replace the entry  "users": [ ... ]  with  "users": []
sudo systemctl start mcpanel
sudo journalctl -u mcpanel | grep -A3 "Erster Start"   # new password for "admin"
```

This deletes **all** panel users. The Minecraft server and its data are not affected.

## Uninstalling

```bash
sudo systemctl disable --now mcpanel
sudo rm /etc/systemd/system/mcpanel.service
sudo systemctl daemon-reload
# Remove data and program (also contains the Minecraft server!):
# sudo rm -rf /opt/mcpanel
```
