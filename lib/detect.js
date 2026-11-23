'use strict';
// Erkennt, was in einem vorhandenen Serverordner liegt: Start-Datei, Server-Software und Minecraft-Version
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { config, run } = require('./core');

const exists = (p) => fs.existsSync(p);
const readText = async (p) => { try { return await fsp.readFile(p, 'utf8'); } catch { return ''; } };

async function findArgsFile(base) {
  // Forge/NeoForge ab 1.17: libraries/net/<minecraftforge|neoforged>/<forge|neoforge>/<Version>/unix_args.txt
  for (const [grp, art, type] of [['net/neoforged', 'neoforge', 'neoforge'], ['net/minecraftforge', 'forge', 'forge']]) {
    const dir = path.join(base, 'libraries', grp, art);
    let vers = []; try { vers = await fsp.readdir(dir); } catch { continue; }
    for (const v of vers.sort().reverse()) {
      const f = path.join(dir, v, 'unix_args.txt');
      if (exists(f)) {
        const rel = path.relative(base, f).split(path.sep).join('/');
        // Forge: 1.20.1-47.2.0 (Minecraft-Version vorne), NeoForge: 21.1.65 (21.1 = 1.21.1)
        let mc = '';
        const m = v.match(/^(\d+\.\d+(?:\.\d+)?)-/);
        if (type === 'forge' && m) mc = m[1];
        if (type === 'neoforge') { const n = v.match(/^(\d+)\.(\d+)/); if (n) mc = `1.${n[1]}${n[2] !== '0' ? '.' + n[2] : ''}`; }
        return { rel, type, mc, loaderVersion: v };
      }
    }
  }
  return null;
}

async function versionFromJar(jar) {
  try { const j = JSON.parse(await run('unzip', ['-p', jar, 'version.json'])); if (j.id) return String(j.id); } catch {}
  return '';
}

async function detect(dir = config.serverDir) {
  const base = path.resolve(dir);
  const names = await fsp.readdir(base).catch(() => []);
  const out = { dir: base, empty: !names.length, hasWorld: false, level: 'world', candidates: [], suggestion: null, notes: [] };
  const props = await readText(path.join(base, 'server.properties'));
  out.level = (props.match(/^level-name=(.*)$/m) || [])[1] || 'world';
  out.hasWorld = exists(path.join(base, out.level, 'level.dat'));
  out.hasProps = !!props;
  const jars = [];
  for (const n of names.filter((x) => /\.jar$/i.test(x))) {
    const st = await fsp.stat(path.join(base, n)).catch(() => null);
    if (st && st.isFile()) jars.push({ file: n, size: st.size });
  }
  out.candidates = jars.sort((a, b) => b.size - a.size);

  // Software: Konfigurationsdateien verraten sie am sichersten
  let type = '';
  const has = (f) => exists(path.join(base, f));
  const args = await findArgsFile(base);
  if (args) { type = args.type; }
  else if (has('purpur.yml')) type = 'purpur';
  else if (has('config/paper-global.yml') || has('paper.yml') || has('paper-global.yml')) type = 'paper';
  else if (has('.fabric') || has('fabric-server-launcher.properties') || jars.some((j) => /fabric/i.test(j.file))) type = 'fabric';
  else if (has('spigot.yml') && has('bukkit.yml')) type = 'spigot';
  else if (jars.some((j) => /folia/i.test(j.file))) type = 'folia';
  else if (jars.some((j) => /paper/i.test(j.file))) type = 'paper';
  else if (jars.some((j) => /purpur/i.test(j.file))) type = 'purpur';
  else if (jars.length) type = 'vanilla';

  // Start-Datei
  let jarFile = '';
  if (!args) {
    const score = (j) => (/installer|launcher-meta|forge-.*-installer/i.test(j.file) ? -100 : 0) + (/server|paper|purpur|folia|fabric|spigot|minecraft/i.test(j.file) ? 10 : 0) + (type && j.file.toLowerCase().includes(type) ? 5 : 0) + (/^server\.jar$/i.test(j.file) ? 3 : 0);
    const best = [...jars].sort((a, b) => score(b) - score(a) || b.size - a.size)[0];
    if (best) jarFile = best.file;
    if (type === 'fabric' && jars.some((j) => j.file === 'fabric-server-launch.jar')) jarFile = 'fabric-server-launch.jar';
  }

  // Version
  let version = args ? args.mc : '';
  if (!version) { const h = JSON.parse((await readText(path.join(base, 'version_history.json'))) || '{}'); const m = String(h.currentVersion || '').match(/MC: (\d+\.\d+(?:\.\d+)?)/); if (m) version = m[1]; }
  if (!version && jarFile) { const m = jarFile.match(/(\d+\.\d+(?:\.\d+)?)/); if (m) version = m[1]; }
  if (!version && jarFile) version = await versionFromJar(path.join(base, jarFile));
  if (!version) { const log = await readText(path.join(base, 'logs', 'latest.log')); const m = log.match(/Starting minecraft server version (\S+)/); if (m) version = m[1]; }

  if (!args && !jarFile) out.notes.push(names.length ? 'Im Ordner liegt keine .jar-Datei. Prüfe, ob der Server direkt im Ordner liegt und nicht in einem Unterordner.' : 'Der Ordner ist leer.');
  if (args) out.notes.push('Forge/NeoForge startet über eine Argumentdatei statt mit -jar. Das wird für dich eingestellt.');
  if (args || jarFile) out.suggestion = { jarFile, launchArgsFile: args ? args.rel : '', type, version };
  return out;
}

module.exports = { detect };
