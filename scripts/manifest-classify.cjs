/*
 * Turns a list of content files into the site's manifest (games, music,
 * PDFs, videos). No Node-only code here: it's shared by the build scripts,
 * the Node server and the Cloudflare Worker (worker/index.mjs).
 * Each file is { rel: 'games/roms/x.gba', url, size }.
 */
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
const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const extOf = (rel) => {
  const b = baseOf(rel);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i).toLowerCase() : '';
};
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
  const inFolder = (dirRel, p) => p && !p.startsWith('/') && !p.includes('..') && byRel.has(`${dirRel}/${p}`);
  // html5 + webports
  for (const [sub, type] of [['html5', 'html5'], ['webports', 'webport']]) {
    const prefix = `games/${sub}/`;
    // group files by their first-level folder (or '' for a loose html file)
    const dirs = new Map();
    for (const f of files) {
      if (!f.rel.startsWith(prefix)) continue;
      const rest = f.rel.slice(prefix.length);
      const slash = rest.indexOf('/');
      const dir = slash === -1 ? '' : rest.slice(0, slash);
      (dirs.get(dir) || dirs.set(dir, []).get(dir)).push(slash === -1 ? rest : rest.slice(slash + 1));
    }
    for (const [dir, rels] of dirs) {
      // a single html file sitting loose in the folder (no sub-folder)
      if (dir === '') {
        for (const r of rels) {
          if (/^[^/]+\.html?$/i.test(r)) games.push({ id: `${type}-${slug(r)}`, type, title: pretty(r), description: '', src: byRel.get(prefix + r).url, cover: sideImage(prefix + r) });
        }
        continue;
      }
      const dirRel = prefix + dir;
      const meta = metas.get(`${dirRel}/game.json`) || {};
      // launch file: an explicit "entry", else index.html, else the one loose html in the folder
      let entry = inFolder(dirRel, meta.entry) ? meta.entry : null;
      if (!entry) entry = rels.find((r) => /^index\.html?$/i.test(r));
      if (!entry) { const tops = rels.filter((r) => /^[^/]+\.html?$/i.test(r)); if (tops.length === 1) entry = tops[0]; }
      if (!entry) continue;
      // cover: an explicit "cover", else the game's own "icon", else any
      // cover/thumbnail/icon/logo file in the folder. Keep it inside the folder.
      const pick = meta.cover || meta.icon;
      const coverRel = inFolder(dirRel, pick) ? `${dirRel}/${pick}` : null;
      games.push({
        id: `${type}-${slug(dir)}`, type,
        title: meta.title || meta.name || pretty(dir),
        description: meta.description || '',
        src: byRel.get(`${dirRel}/${entry}`).url,
        cover: (coverRel && byRel.get(coverRel).url) || folderCover(dirRel),
      });
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

module.exports = { classify, TOP, baseOf, encodePath, decodeXml };
