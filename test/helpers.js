'use strict';
// Gemeinsame Hilfen für die Tests: startet das Panel als eigenen Prozess im Dev-Modus (ohne Java, eigener Datenordner, freier Port)
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Ein kleiner HTTP-Client mit Cookie (Sitzung)
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async request(method, url, body, headers = {}) {
    const opt = { method, headers: { ...headers }, redirect: 'manual' };
    if (this.cookie) opt.headers.cookie = this.cookie;
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(this.base + url, opt);
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of setCookie) {
      const m = c.match(/^mcp_session=([^;]*)/);
      if (m) this.cookie = m[1] ? 'mcp_session=' + m[1] : '';
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers, setCookie };
  }
  get(url) { return this.request('GET', url); }
  post(url, body = {}) { return this.request('POST', url, body); }
  put(url, body = {}) { return this.request('PUT', url, body); }
  del(url) { return this.request('DELETE', url); }
  async login(username, password) {
    const r = await this.post('/api/login', { username, password });
    if (r.status !== 200) throw new Error(`Login von ${username} fehlgeschlagen: ${r.status} ${r.text}`);
    return this;
  }
}

async function startPanel(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpanel-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      MCPANEL_DEV: '1', MCPANEL_DEV_AUTOSTART: '0', MCPANEL_DATA: dir, MCPANEL_PORT: String(port), MCPANEL_PASSWORD: 'dev',
      DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: '', DISCORD_REDIRECT_URI: '', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/login')).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error('Panel startet nicht:\n' + log);
    await new Promise((r) => setTimeout(r, 200));
    if (i === 59) throw new Error('Panel antwortet nicht:\n' + log);
  }
  return {
    base, port, dir, serverDir: path.join(dir, 'server'), backupDir: path.join(dir, 'backups'),
    log: () => log,
    client: () => new Client(base),
    admin: async () => new Client(base).login('admin', 'dev'),
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((r) => { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 8000); });
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startPanel, Client };
