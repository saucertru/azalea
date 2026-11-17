/*
 * Cloudflare Worker for Azalea.
 *
 * The site itself is plain static files in dist/ (built by
 * `npm run build:pages`), served straight from Cloudflare. This Worker only
 * answers /manifest.json: it merges the files that were in the repo at build
 * time (dist/content-index.json) with whatever is in the R2 bucket right now,
 * so files uploaded to R2 show up within a minute, with no redeploy and no
 * R2 keys. The bucket is connected in wrangler.jsonc (binding MEDIA).
 */
import { CONFIG } from '../js/config.js';
import { classify, TOP, baseOf, encodePath } from '../scripts/manifest-classify.cjs';

const CACHE_MS = 60_000;
let cached = null; // { at, body }

async function listR2(bucket) {
  const files = [];
  let cursor;
  for (let page = 0; page < 100; page++) {
    const res = await bucket.list({ cursor, limit: 1000 });
    for (const o of res.objects) {
      const key = o.key;
      if (key.endsWith('/') || !TOP.includes(key.split('/')[0])) continue;
      if (baseOf(key).startsWith('.') || baseOf(key) === 'README.txt') continue;
      files.push({ rel: key, size: o.size });
    }
    if (!res.truncated) break;
    cursor = res.cursor;
  }
  return files;
}

async function buildManifest(env) {
  const idx = await env.ASSETS.fetch(new Request('https://assets.local/content-index.json'));
  const { files: local, metas: localMetas } = idx.ok ? await idx.json() : { files: [], metas: {} };
  const metas = new Map(Object.entries(localMetas || {}));
  let files = local;

  const base = (CONFIG.mediaUrl || '').replace(/\/+$/, '');
  if (env.MEDIA && base) {
    const have = new Set(local.map((f) => f.rel));
    const remote = (await listR2(env.MEDIA))
      .filter((f) => !have.has(f.rel)) // a file in the repo wins
      .map((f) => ({ ...f, url: `${base}/${encodePath(f.rel)}` }));
    for (const f of remote) {
      if (baseOf(f.rel) !== 'game.json') continue;
      try {
        const obj = await env.MEDIA.get(f.rel);
        metas.set(f.rel, obj ? JSON.parse(await obj.text()) : {});
      } catch {
        metas.set(f.rel, {});
      }
    }
    files = [...local, ...remote];
  }
  return JSON.stringify(classify(files, metas));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/manifest.json') return env.ASSETS.fetch(request);

    if (!cached || Date.now() - cached.at > CACHE_MS) {
      try {
        cached = { at: Date.now(), body: await buildManifest(env) };
      } catch (e) {
        console.error('manifest:', e);
        // fall back to the manifest made at build time (repo files only)
        if (!cached) return env.ASSETS.fetch(request);
      }
    }
    return new Response(cached.body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  },
};
