#!/usr/bin/env node
/*
 * Builds manifest.json: the list of games, music, PDFs and videos.
 *
 * Files come from the local folders, and (during a Cloudflare Pages build)
 * from your Cloudflare R2 bucket for anything over 25 MB. Use the same
 * folder layout in both places:
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
 * Any item can have a same-name image (png/jpg/jpeg/webp/gif/svg) as its cover.
 * A game folder can contain cover.png / thumbnail.png and an optional
 * game.json: { "title": "...", "description": "..." }
 *
 * R2 needs these environment variables (set them in Cloudflare Pages):
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * and the bucket's public URL as mediaUrl in js/config.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TOP = ['games', 'music', 'pdfs', 'videos'];
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

// ---------------------------------------------------------------- helpers
const extOf = (rel) => path.posix.extname(rel).toLowerCase();
const baseOf = (rel) => path.posix.basename(rel);
const noExt = (rel) => rel.replace(/\.[^./]+$/, '');
const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

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

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** The R2 bucket's public URL: env R2_PUBLIC_URL, else mediaUrl in js/config.js */
function mediaBase() {
  let url = process.env.R2_PUBLIC_URL || '';
  if (!url) {
    try {
      const m = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8').match(/mediaUrl:\s*['"]([^'"]*)['"]/);
      url = m ? m[1] : '';
    } catch {}
  }
  return url.replace(/\/+$/, '');
}

// ---------------------------------------------------------------- sources
// Each file is { rel: 'games/roms/x.gba', url, size, abs? (local only) }

function localFiles() {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (d.name.startsWith('.') || d.name === 'README.txt') continue;
      const abs = path.join(dir, d.name);
      const r = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(abs, r, depth + 1);
      else if (d.isFile()) out.push({ rel: r, url: encodePath(r), size: fs.statSync(abs).size, abs });
    }
  };
  for (const top of TOP) walk(path.join(ROOT, top), top, 0);
  return out;
}

/** Lists the R2 bucket. Returns { files, error }. Skipped (no error) when not configured. */
async function r2Files() {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env;
  if (!R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || (!R2_ACCOUNT_ID && !R2_ENDPOINT)) {
    return { files: [], skipped: true };
  }
  const base = mediaBase();
  if (!base) return { files: [], error: 'R2 keys are set but mediaUrl in js/config.js (or R2_PUBLIC_URL) is empty.' };
  const { AwsClient } = require('aws4fetch');
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const endpoint = (R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
  const files = [];
  let token = null;
  try {
    for (let page = 0; page < 200; page++) {
      let url = `${endpoint}/${encodeURIComponent(R2_BUCKET)}?list-type=2&max-keys=1000`;
      if (token) url += `&continuation-token=${encodeURIComponent(token)}`;
      const res = await client.fetch(url);
      const xml = await res.text();
      if (!res.ok) throw new Error(`R2 said ${res.status}: ${(xml.match(/<Message>([^<]*)/) || [])[1] || xml.slice(0, 200)}`);
      for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = decodeXml((block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || '');
        const size = +((block.match(/<Size>(\d+)<\/Size>/) || [])[1] || 0);
        if (!key || key.endsWith('/') || !TOP.includes(key.split('/')[0])) continue;
        if (baseOf(key).startsWith('.') || baseOf(key) === 'README.txt') continue;
        files.push({ rel: key, url: `${base}/${encodePath(key)}`, size, r2: `${endpoint}/${encodeURIComponent(R2_BUCKET)}/${encodePath(key)}` });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = decodeXml((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || '');
      if (!token) break;
    }
  } catch (e) {
    const msg = /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(`${e.message} ${e.cause?.code || ''}`)
      ? `couldn't connect to ${endpoint} - check R2_ACCOUNT_ID`
      : e.message;
    return { files, error: msg };
  }
  return { files, client };
}

// ---------------------------------------------------------------- game.json
function readLocalMeta(file) {
  try { return JSON.parse(fs.readFileSync(file.abs, 'utf8')); } catch { return {}; }
}
async function readRemoteMeta(file, client) {
  try {
    // read through the signed R2 API (works even before the bucket is public)
    const r = client && file.r2 ? await client.fetch(file.r2) : await fetch(file.url);
    return r.ok ? JSON.parse(await r.text()) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- classify
function classify(files, metas) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const sideImage = (rel) => {
    const b = noExt(rel);
    for (const e of IMG) if (byRel.has(b + e)) return byRel.get(b + e).url;
    return null;
  };
  const folderCover = (dirRel) => {
    for (const n of ['cover', 'thumbnail', 'thumb', 'icon', 'logo']) {
      for (const e of IMG) if (byRel.has(`${dirRel}/${n}${e}`)) return byRel.get(`${dirRel}/${n}${e}`).url;
    }
    return null;
  };

  const games = [];
  // html5 + webports
  for (const [sub, type] of [['html5', 'html5'], ['webports', 'webport']]) {
    const prefix = `games/${sub}/`;
    for (const f of files) {
      if (!f.rel.startsWith(prefix)) continue;
      const rest = f.rel.slice(prefix.length);
      let m;
      if ((m = rest.match(/^([^/]+)\/index\.html?$/i))) {
        const dirRel = prefix + m[1];
        const meta = metas.get(`${dirRel}/game.json`) || {};
        const coverRel = meta.cover ? `${dirRel}/${meta.cover}` : null;
        games.push({
          id: `${type}-${slug(m[1])}`, type,
          title: meta.title || pretty(m[1]),
          description: meta.description || '',
          src: f.url,
          cover: (coverRel && byRel.get(coverRel)?.url) || folderCover(dirRel),
        });
      } else if (/^[^/]+\.html?$/i.test(rest)) {
        games.push({ id: `${type}-${slug(rest)}`, type, title: pretty(rest), description: '', src: f.url, cover: sideImage(f.rel) });
      }
    }
  }
  // flash
  for (const f of files) {
    if (!f.rel.startsWith('games/flash/') || extOf(f.rel) !== '.swf') continue;
    games.push({
      id: `flash-${slug(f.rel.slice('games/flash/'.length))}`, type: 'flash',
      title: pretty(baseOf(f.rel)), description: 'Flash game (Ruffle)', src: f.url, cover: sideImage(f.rel),
    });
  }
  // roms
  for (const f of files) {
    if (!f.rel.startsWith('games/roms/')) continue;
    const ext = extOf(f.rel);
    if (IMG.includes(ext) || ext === '.txt' || ext === '.json') continue;
    const parts = f.rel.slice('games/roms/'.length).split('/');
    const folderCore = parts.length > 1 ? ROM_DIR[parts[0].toLowerCase()] : null;
    const core = folderCore || ROM_EXT[ext];
    if (!core) continue;
    games.push({
      id: `rom-${slug(parts.join('/'))}`, type: 'rom',
      title: pretty(baseOf(f.rel)),
      description: SYSTEM_NAME[core] || core, system: SYSTEM_NAME[core] || core, core,
      src: f.url, cover: sideImage(f.rel),
    });
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  const seen = new Map();
  for (const g of games) {
    const n = seen.get(g.id) || 0;
    seen.set(g.id, n + 1);
    if (n) g.id = `${g.id}-${n + 1}`;
  }

  const music = files.filter((f) => f.rel.startsWith('music/') && AUDIO.includes(extOf(f.rel))).map((f) => {
    const name = noExt(baseOf(f.rel));
    const m = name.split(/\s+-\s+/);
    return {
      id: `music-${slug(f.rel)}`,
      title: m.length > 1 ? m.slice(1).join(' - ').trim() : name.trim(),
      artist: m.length > 1 ? m[0].trim() : '',
      src: f.url, cover: sideImage(f.rel),
    };
  });
  const pdfs = files.filter((f) => f.rel.startsWith('pdfs/') && extOf(f.rel) === '.pdf').map((f) => ({
    id: `pdf-${slug(f.rel)}`, title: pretty(baseOf(f.rel)), src: f.url, cover: sideImage(f.rel), size: f.size,
  }));
  const videos = files.filter((f) => f.rel.startsWith('videos/') && VIDEO.includes(extOf(f.rel))).map((f) => {
    const vtt = byRel.get(`${noExt(f.rel)}.vtt`);
    return { id: `video-${slug(f.rel)}`, title: pretty(baseOf(f.rel)), src: f.url, cover: sideImage(f.rel), subtitles: vtt ? vtt.url : null };
  });
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  return { generated: new Date().toISOString(), games, music: music.sort(byTitle), pdfs: pdfs.sort(byTitle), videos: videos.sort(byTitle) };
}

// ---------------------------------------------------------------- public API
/** Local folders only (used by the dev server and the Node server). */
function buildManifest() {
  const files = localFiles();
  const metas = new Map(files.filter((f) => baseOf(f.rel) === 'game.json').map((f) => [f.rel, readLocalMeta(f)]));
  return classify(files, metas);
}

/**
 * Local folders + R2. Options: { maxLocalSize } drops local files bigger than
 * that (Cloudflare Pages rejects files over 25 MiB).
 * Returns { manifest, report: { local, r2, tooBig: [rel], r2Error } }
 */
async function buildManifestAsync({ maxLocalSize = Infinity } = {}) {
  const all = localFiles();
  const tooBig = all.filter((f) => f.size > maxLocalSize).map((f) => f.rel);
  const local = all.filter((f) => f.size <= maxLocalSize);
  const r2 = await r2Files();
  const have = new Set(local.map((f) => f.rel));
  const remote = r2.files.filter((f) => !have.has(f.rel)); // a local file wins
  const files = [...local, ...remote];
  const metas = new Map();
  for (const f of files) {
    if (baseOf(f.rel) !== 'game.json') continue;
    metas.set(f.rel, f.abs ? readLocalMeta(f) : await readRemoteMeta(f, r2.client));
  }
  return {
    manifest: classify(files, metas),
    report: { local: local.length, r2: remote.length, r2Skipped: Boolean(r2.skipped), r2Error: r2.error || null, tooBig },
  };
}

module.exports = { buildManifest, buildManifestAsync, ROOT };

if (require.main === module) {
  buildManifestAsync().then(({ manifest: m, report }) => {
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(m, null, 2));
    if (report.r2Error) console.warn(`⚠ R2: ${report.r2Error}`);
    console.log(
      `manifest.json: ${m.games.length} games, ${m.music.length} songs, ` +
        `${m.pdfs.length} PDFs, ${m.videos.length} videos` +
        (report.r2 ? ` (${report.r2} files from R2)` : '')
    );
  });
}
