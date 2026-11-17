#!/usr/bin/env node
/*
 * Build for Cloudflare (or any static host): puts everything the
 * website needs into dist/.
 *   npm run build:pages    ->  dist/
 *
 * - copies the site and your small content files
 * - copies the web proxy files (/scramjet, /controller, /libcurl)
 * - writes dist/manifest.json, including big files from your R2 bucket
 * - leaves out any local file over 25 MiB (Pages rejects them) and tells you
 */
const fs = require('fs');
const path = require('path');
const { buildManifestAsync, localFiles, readLocalMeta, ROOT, proxyDirs, PROXY_FILES } = require('./build-manifest.cjs');

const OUT = path.join(ROOT, 'dist');
const MAX = 25 * 1024 * 1024; // Cloudflare Pages per-file limit
const SITE = ['index.html', 'play.html', 'sw.js', 'assets', 'css', 'js', 'games', 'music', 'pdfs', 'videos'];

const skipped = [];
let copied = 0;

function copy(src, dest, rel) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name.startsWith('.')) continue;
      copy(path.join(src, name), path.join(dest, name), `${rel}/${name}`);
    }
    return;
  }
  if (st.size > MAX) {
    skipped.push(rel);
    return;
  }
  fs.copyFileSync(src, dest);
  copied++;
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const item of SITE) {
    const src = path.join(ROOT, item);
    if (fs.existsSync(src)) copy(src, path.join(OUT, item), item);
  }

  // web proxy files (same paths the Node server uses)
  for (const [name, dir] of Object.entries(proxyDirs())) {
    fs.mkdirSync(path.join(OUT, name), { recursive: true });
    for (const f of PROXY_FILES[name]) copy(path.join(dir, f), path.join(OUT, name, f), `${name}/${f}`);
  }

  const { manifest: m, report } = await buildManifestAsync({ maxLocalSize: MAX });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(m));

  // For the Cloudflare Worker (worker/index.mjs): the local content files, so
  // it can merge them with whatever is in R2 right now.
  const local = localFiles().filter((f) => f.size <= MAX);
  const metas = {};
  for (const f of local) if (f.rel.endsWith('/game.json')) metas[f.rel] = readLocalMeta(f);
  fs.writeFileSync(
    path.join(OUT, 'content-index.json'),
    JSON.stringify({ files: local.map(({ rel, url, size }) => ({ rel, url, size })), metas })
  );

  console.log(`dist/: ${copied} files`);
  console.log(`manifest: ${m.games.length} games, ${m.music.length} songs, ${m.pdfs.length} PDFs, ${m.videos.length} videos`);
  if (report.r2) console.log(`R2: ${report.r2} files added from your bucket`);
  else if (report.r2Skipped) console.log('R2: not set up (no R2_* environment variables) - skipped');
  if (report.r2Error) console.warn(`⚠ R2 could not be listed: ${report.r2Error}`);
  if (skipped.length) {
    console.warn(`⚠ Left out ${skipped.length} file(s) over 25 MiB (Cloudflare Pages limit). Upload these to R2 instead:`);
    for (const s of skipped) console.warn(`   ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
