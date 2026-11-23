# Changelog

[Deutsch](CHANGELOG.de.md) · **English**

All notable changes to this project are listed here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.2] – 2026-11-23

### Added
- `CHANGELOG`, `SECURITY` and `CONTRIBUTING` are now available in English (default) and German (`*.de.md`). The Changelog page in the panel shows the language of the interface.
- The changelog has a button with the version number at the top right.
- Screenshots for both languages (`docs/screenshots/de/` and `en/`).

### Changed
- The language is now only switched under "My account → Language" (and on the sign-in page). The toggle in the header bar is gone; the header shows the changelog button and the status in consistent pills.
- The "Changelog" menu item in the sidebar is gone; open the page via the button at the top right.
- The English interface texts were reviewed page by page and completed.
- `.claude/` (local tool settings) is now in `.gitignore`.

## [1.0.1] – 2026-11-23

### Added
- The documentation is now bilingual: `README.md` and `INSTALLATION.md` are in English (the default on GitHub), and the German versions are named `README.de.md` and `INSTALLATION.de.md`.
- **Retroactive player statistics:** New view "All players & statistics" with playtime, deaths and mob kills (from the world's statistics files, so it also covers the time before the panel), last seen, first visit and joins (from logs and player data, plus a memory file `playerlog.json`). Clicking a player shows details and the **ban history** with reasons, drawn from current bans, logs and the panel's activity log.
- **Import an existing server:** On the "Install" page, "Check server folder" detects the start file, server software and Minecraft version (including Forge and NeoForge via the arguments file) and applies them on request.
- The uptime is shown next to "Running" in the status display (seconds always two digits). Mods can be filtered by "runs on the server" or "client only", and every result has an "Open on Modrinth" button. The player selection in the logs shows avatars.
- **Direct messages (DMs)** on Discord: With a bot token (Panel → Notifications), every user can choose under "My account" to receive notifications privately, including a test message. The token is never displayed.
- Language switch as a "DE | EN" toggle (on the sign-in page and under "My account"). The "Logs" menu item is now in the "Server" group.
- **Logs page:** read and search all log files (current, compressed, crash reports), with filters by player, type, level and date, highlighting of matches and download. New permission "Search server logs" (moderators have it).
- **My account** as its own page: Minecraft account, Discord ID (with password), password, 2FA, "Sign out everywhere" and **personal notifications** (notice in the panel, browser notification, selectable per event).
- **Panel page revised:** sections as tabs (Server, Automation & backups, Notifications, Sign-in), short descriptions and a marker for unsaved changes.
- **Two-factor sign-in** (TOTP, RFC 6238) with an authenticator app, QR code and eight recovery codes. Admins can reset it for users. Sign-in via Discord remains without a second factor.
- **Mods and plugins:** search Modrinth and install with one click (including required dependencies, SHA-512 verification, update check, removal). New page `/mods`.
- **TPS and MSPT** on the dashboard (Paper family via `tps`/`mspt`, Vanilla and Fabric via `tick query`). The uptime is now in the card header, and the system RAM is shown on the RAM tile.
- The **player list** is reconciled with `list` every 90 seconds so that nobody is missing or stuck. The responses to the automatic queries do not appear in the console.
- **Discord notifications** via webhook (online, stopped, crash, backup, lag, players joining and leaving) with a test button.
- Backups: **free-space check** before saving, **archive verification** afterwards (corrupt backups are discarded), display of free storage, a button to check again, and an **optional copy** to another folder or to another machine via rsync/SSH.
- File manager: **upload with progress** and **drag & drop**, **multi-select** (delete, download as `.tar.gz`), **extract archives** (`.zip`, `.tar.gz`, `.tgz`, `.tar`; unsafe archives with paths pointing outside or symlinks are rejected) and a filter.
- **German and English** (toggle at the top right and on the sign-in page).
- **Docker:** `Dockerfile` and `docker-compose.yml` (panel and Java 21 in one image). **`install.sh`** sets up the panel as a systemd service.
- **Automated tests** (`npm test`, around 50 tests) and a CI stage that runs them, plus a Docker build.
- Environment variables `MCPANEL_DATA` (data folder), `MCPANEL_TRUST_PROXY`, `MCPANEL_COOKIE_SECURE`, `DISCORD_WEBHOOK_URL`.
- **Custom roles with individual permissions** (eleven permissions, for example control server, files, settings, activity log). Admins create, edit and delete roles and assign them to users. Anyone who may manage users can only assign roles and edit users whose permissions they hold themselves.

### Changed
- The source code is split into modules (`lib/` and `routes/`); behavior stays the same. The split is backed by the new tests.
- **Security:** The session cookie gets the `Secure` flag over HTTPS. The sign-in lockout counts per real visitor address (`X-Forwarded-For`, only from trusted proxies, default `loopback`) instead of per proxy address. The redirect URI for Discord follows the same protection.
- When reading a missing file, the file manager reports "not found" (404) instead of a server error.
- Menu, pages and buttons follow the individual permissions instead of three levels.
- Backups: Besides the interval there are now **fixed times** (for example daily at 04:00).
- Backups: Folders and files can be **excluded** from the backup (default: `logs`, `crash-reports`, `cache`).
- Restore: **everything** or a **selection** of folders and files can be restored. The previous state of the selected entries is kept in `server.before-restore`; on an error it is rolled back automatically.
- A scheduled restart waits until a running backup has finished.

## [1.0.0] – 2026-11-23

First published version.

### Added
- Dashboard with status, player heads, CPU and RAM graphs, live console with filter and search, sending commands, start/stop/restart/kill.
- Installation of Paper, Purpur, Folia, Fabric, Forge, NeoForge and Vanilla.
- `server.properties` as a grouped list with switches and explanations.
- File manager with text editor, upload and download.
- Player management (whitelist, OP, kick, ban) with Mojang verification; detection of Bedrock players (Geyser/Floodgate), whitelist via `/fwhitelist`.
- Backups: manual and automatic, download and restore.
- Automation: restart after a crash, scheduled daily restart with chat warning, backup schedule.
- Users with roles (Admin, Moderator, Viewer), a protected main user, Minecraft avatar and Discord login.
- Log of all actions for admins (without IP addresses).
- Light and dark design, collapsible side menu, mobile view.
- Dev mode with a simulated Minecraft server (`npm run dev`).
- Guide for installation on a Linux server (`INSTALLATION.md`).

[1.0.2]: https://github.com/dev-sasa/mc-server-panel/releases/tag/v1.0.2
[1.0.1]: https://github.com/dev-sasa/mc-server-panel/releases/tag/v1.0.1
[1.0.0]: https://github.com/dev-sasa/mc-server-panel/releases/tag/v1.0.0
