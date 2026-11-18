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
const { classify, TOP, baseOf, encodePath, decodeXml } = require('./manifest-classify.cjs');

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

/** Web proxy files to serve, by URL folder: /scramjet/, /controller/, /libcurl/ */
function proxyDirs() {
  return {
    scramjet: path.dirname(require.resolve('@mercuryworkshop/scramjet/bundled')),
    controller: path.dirname(require.resolve('@mercuryworkshop/scramjet-controller')),
    libcurl: path.dirname(require.resolve('@mercuryworkshop/libcurl-transport')),
  };
}
// only these files are needed in the browser (skips source maps etc.)
const PROXY_FILES = {
  scramjet: ['scramjet.js', 'scramjet.wasm'],
  controller: ['controller.api.js', 'controller.inject.js', 'controller.sw.js'],
  libcurl: ['index.mjs'],
};

module.exports = { buildManifest, buildManifestAsync, localFiles, readLocalMeta, ROOT, proxyDirs, PROXY_FILES };

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
