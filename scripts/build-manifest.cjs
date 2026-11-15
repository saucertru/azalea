#!/usr/bin/env node
/*
 * Scans the content folders and writes manifest.json.
 * Drop files into games/, music/, pdfs/ or videos/, then run `npm run build`
 * (Vercel/Netlify run this automatically on every deploy).
 *
 *   games/html5/<name>/index.html   or games/html5/<name>.html
 *   games/webports/<name>/index.html
 *   games/flash/<name>.swf
 *   games/roms/<anything>.<ext>     (system picked from the extension,
 *                                    or from a folder name like games/roms/gba/)
 *   music/*.mp3|ogg|wav|m4a|flac|opus  ("Artist - Title.mp3" gets artist + title)
 *   pdfs/*.pdf
 *   videos/*.mp4|webm|ogv|mov|m4v      (same-name .vtt is used as subtitles)
 *
 * Any item can have a same-name image (png/jpg/jpeg/webp/gif) as its cover.
 * A game folder can contain cover.png / thumbnail.png and an optional
 * game.json: { "title": "...", "description": "..." }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const AUDIO = ['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.opus', '.aac'];
const VIDEO = ['.mp4', '.webm', '.ogv', '.mov', '.m4v'];

// extension -> EmulatorJS core
const ROM_EXT = {
  '.nes': 'nes', '.fds': 'nes', '.unf': 'nes',
  '.sfc': 'snes', '.smc': 'snes', '.fig': 'snes', '.swc': 'snes',
  '.gba': 'gba',
  '.gb': 'gb', '.gbc': 'gb',
  '.n64': 'n64', '.z64': 'n64', '.v64': 'n64',
  '.nds': 'nds',
  '.md': 'segaMD', '.gen': 'segaMD', '.smd': 'segaMD', '.32x': 'sega32x',
  '.sms': 'segaMS', '.gg': 'segaGG',
  '.a26': 'atari2600', '.a78': 'atari7800', '.lnx': 'lynx', '.j64': 'jaguar',
  '.pce': 'pce', '.ngp': 'ngp', '.ngc': 'ngp', '.ws': 'ws', '.wsc': 'ws',
  '.vb': 'vb', '.col': 'coleco',
  '.pbp': 'psx', '.chd': 'psx', '.cue': 'psx',
};
// folder name -> EmulatorJS core (lets ambiguous files like .zip/.bin work)
const ROM_DIR = {
  nes: 'nes', famicom: 'nes', snes: 'snes', gba: 'gba', gb: 'gb', gbc: 'gb',
  n64: 'n64', nds: 'nds', ds: 'nds', genesis: 'segaMD', megadrive: 'segaMD',
  segamd: 'segaMD', sms: 'segaMS', mastersystem: 'segaMS', gamegear: 'segaGG',
  gg: 'segaGG', psx: 'psx', ps1: 'psx', atari2600: 'atari2600',
  atari7800: 'atari7800', lynx: 'lynx', jaguar: 'jaguar', pce: 'pce',
  ngp: 'ngp', ws: 'ws', vb: 'vb', arcade: 'arcade', mame: 'mame2003',
  coleco: 'coleco', '32x': 'sega32x', segacd: 'segaCD', psp: 'psp',
};
const SYSTEM_NAME = {
  nes: 'NES', snes: 'SNES', gba: 'Game Boy Advance', gb: 'Game Boy', n64: 'N64',
  nds: 'Nintendo DS', segaMD: 'Sega Genesis', segaMS: 'Master System',
  segaGG: 'Game Gear', sega32x: 'Sega 32X', segaCD: 'Sega CD', psx: 'PlayStation',
  atari2600: 'Atari 2600', atari7800: 'Atari 7800', lynx: 'Atari Lynx',
  jaguar: 'Atari Jaguar', pce: 'PC Engine', ngp: 'Neo Geo Pocket',
  ws: 'WonderSwan', vb: 'Virtual Boy', arcade: 'Arcade', mame2003: 'Arcade',
  coleco: 'ColecoVision', psp: 'PSP',
};

const toUrl = (abs) =>
  path.relative(ROOT, abs).split(path.sep).map(encodeURIComponent).join('/');

const pretty = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

function list(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && d.name !== 'README.txt');
  } catch {
    return [];
  }
}

function walk(dir, depth = 0) {
  if (depth > 4) return [];
  let out = [];
  for (const d of list(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p, depth + 1));
    else out.push(p);
  }
  return out;
}

function sideImage(file) {
  const base = file.replace(/\.[^.]+$/, '');
  for (const ext of IMG) {
    if (fs.existsSync(base + ext)) return toUrl(base + ext);
  }
  return null;
}

function folderCover(dir) {
  for (const n of ['cover', 'thumbnail', 'thumb', 'icon', 'logo']) {
    for (const ext of IMG) {
      const p = path.join(dir, n + ext);
      if (fs.existsSync(p)) return toUrl(p);
    }
  }
  return null;
}

function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
  } catch {
    return {};
  }
}

function scanWebGames(sub, type) {
  const dir = path.join(ROOT, 'games', sub);
  const items = [];
  for (const d of list(dir)) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      const entry = ['index.html', 'index.htm'].map((f) => path.join(p, f)).find(fs.existsSync);
      if (!entry) continue;
      const meta = readMeta(p);
      items.push({
        id: `${type}-${slug(d.name)}`,
        type,
        title: meta.title || pretty(d.name),
        description: meta.description || '',
        src: toUrl(entry),
        cover: meta.cover ? toUrl(path.join(p, meta.cover)) : folderCover(p),
      });
    } else if (/\.html?$/i.test(d.name)) {
      items.push({
        id: `${type}-${slug(d.name)}`,
        type,
        title: pretty(d.name),
        description: '',
        src: toUrl(p),
        cover: sideImage(p),
      });
    }
  }
  return items;
}

function scanFlash() {
  return walk(path.join(ROOT, 'games', 'flash'))
    .filter((f) => /\.swf$/i.test(f))
    .map((f) => ({
      id: `flash-${slug(path.relative(path.join(ROOT, 'games', 'flash'), f))}`,
      type: 'flash',
      title: pretty(path.basename(f)),
      description: 'Flash game (Ruffle)',
      src: toUrl(f),
      cover: sideImage(f),
    }));
}

function scanRoms() {
  const base = path.join(ROOT, 'games', 'roms');
  const items = [];
  for (const f of walk(base)) {
    const ext = path.extname(f).toLowerCase();
    if (IMG.includes(ext) || ext === '.txt' || ext === '.json') continue;
    const parts = path.relative(base, f).split(path.sep);
    const folderCore = parts.length > 1 ? ROM_DIR[parts[0].toLowerCase()] : null;
    const core = folderCore || ROM_EXT[ext];
    if (!core) continue; // unknown extension and no system folder
    items.push({
      id: `rom-${slug(path.relative(base, f))}`,
      type: 'rom',
      title: pretty(path.basename(f)),
      description: SYSTEM_NAME[core] || core,
      system: SYSTEM_NAME[core] || core,
      core,
      src: toUrl(f),
      cover: sideImage(f),
    });
  }
  return items;
}

function scanMusic() {
  return walk(path.join(ROOT, 'music'))
    .filter((f) => AUDIO.includes(path.extname(f).toLowerCase()))
    .map((f) => {
      const name = path.basename(f).replace(/\.[^.]+$/, '');
      const m = name.split(/\s+-\s+/);
      const artist = m.length > 1 ? m[0].trim() : '';
      const title = m.length > 1 ? m.slice(1).join(' - ').trim() : name.trim();
      return {
        id: `music-${slug(path.relative(ROOT, f))}`,
        title,
        artist,
        src: toUrl(f),
        cover: sideImage(f),
      };
    });
}

function scanPdfs() {
  return walk(path.join(ROOT, 'pdfs'))
    .filter((f) => /\.pdf$/i.test(f))
    .map((f) => ({
      id: `pdf-${slug(path.relative(ROOT, f))}`,
      title: pretty(path.basename(f)),
      src: toUrl(f),
      cover: sideImage(f),
      size: fs.statSync(f).size,
    }));
}

function scanVideos() {
  return walk(path.join(ROOT, 'videos'))
    .filter((f) => VIDEO.includes(path.extname(f).toLowerCase()))
    .map((f) => {
      const vtt = f.replace(/\.[^.]+$/, '.vtt');
      return {
        id: `video-${slug(path.relative(ROOT, f))}`,
        title: pretty(path.basename(f)),
        src: toUrl(f),
        cover: sideImage(f),
        subtitles: fs.existsSync(vtt) ? toUrl(vtt) : null,
      };
    });
}

function buildManifest() {
  const games = [
    ...scanWebGames('html5', 'html5'),
    ...scanWebGames('webports', 'webport'),
    ...scanFlash(),
    ...scanRoms(),
  ].sort((a, b) => a.title.localeCompare(b.title));

  // make ids unique even if two files slug the same
  const seen = new Map();
  for (const g of games) {
    const n = seen.get(g.id) || 0;
    seen.set(g.id, n + 1);
    if (n) g.id = `${g.id}-${n + 1}`;
  }

  return {
    generated: new Date().toISOString(),
    games,
    music: scanMusic().sort((a, b) => a.title.localeCompare(b.title)),
    pdfs: scanPdfs().sort((a, b) => a.title.localeCompare(b.title)),
    videos: scanVideos().sort((a, b) => a.title.localeCompare(b.title)),
  };
}

module.exports = { buildManifest };

if (require.main === module) {
  const m = buildManifest();
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(m, null, 2));
  console.log(
    `manifest.json: ${m.games.length} games, ${m.music.length} songs, ` +
      `${m.pdfs.length} PDFs, ${m.videos.length} videos`
  );
}
