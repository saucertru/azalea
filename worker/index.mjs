/*
 * Cloudflare Worker for Azalea.
 *
 * The site itself is plain static files in dist/ (built by
 * `npm run build:pages`), served straight from Cloudflare. This Worker only
 * answers /manifest.json: it merges the files that were in the repo at build
 * time (dist/content-index.json) with whatever is in the R2 bucket right now,
 * so files uploaded to R2 show up within a minute, with no redeploy and no
 * R2 keys. The bucket is connected in wrangler.jsonc (binding MEDIA).
 *
 * It also runs the admin API (/api/admin/...) that the Admin app uses to
 * upload and delete files in R2. Every request must carry a Supabase login
 * token for an account with is_admin = true.
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

// ------------------------------------------------------------ admin API
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

const adminCache = new Map(); // token -> { at, user }
/** Checks the Supabase token and that the account is an admin. */
async function getAdmin(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096) return null;
  const hit = adminCache.get(token);
  if (hit && Date.now() - hit.at < 60_000) return hit.user;
  const base = CONFIG.supabaseUrl.replace(/\/+$/, '');
  const headers = { apikey: CONFIG.supabaseAnonKey, authorization: `Bearer ${token}` };
  const u = await fetch(`${base}/auth/v1/user`, { headers });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user?.id) return null;
  const p = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin,banned`, { headers });
  const rows = p.ok ? await p.json() : [];
  const ok = rows[0]?.is_admin === true && rows[0]?.banned !== true;
  const result = ok ? { id: user.id } : null;
  if (adminCache.size > 200) adminCache.clear();
  adminCache.set(token, { at: Date.now(), user: result });
  return result;
}

// only the content folders, no tricks
const goodKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 512
  && /^(games|music|pdfs|videos)\//.test(k) && !k.includes('..') && !k.includes('//') && !/[\\\x00-\x1f]/.test(k);

async function adminApi(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.MEDIA) return json({ error: 'The R2 bucket is not connected (wrangler.jsonc)' }, 500);
  const admin = await getAdmin(request);
  if (!admin) return json({ error: 'Admins only. Log in with an admin account.' }, 403);
  const route = url.pathname.replace(/^\/api\/admin\/?/, '');

  if (route === 'check') return json({ ok: true, user: admin.id });

  if (route === 'files' && request.method === 'GET') {
    const prefix = url.searchParams.get('prefix') || '';
    if (prefix && !/^(games|music|pdfs|videos)\//.test(prefix)) return json({ error: 'Bad folder' }, 400);
    const files = [];
    let cursor;
    for (let i = 0; i < 50; i++) {
      const res = await env.MEDIA.list({ prefix: prefix || undefined, cursor, limit: 1000 });
      for (const o of res.objects) files.push({ key: o.key, size: o.size, uploaded: o.uploaded });
      if (!res.truncated) break;
      cursor = res.cursor;
    }
    return json({ files });
  }

  if (route === 'file') {
    const key = url.searchParams.get('key');
    if (request.method === 'PUT') {
      if (!goodKey(key)) return json({ error: 'Files must go in games/, music/, pdfs/ or videos/' }, 400);
      await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
      });
      cached = null;
      return json({ ok: true, key });
    }
    if (request.method === 'DELETE') {
      const prefix = url.searchParams.get('prefix');
      if (prefix) {
        // a whole game folder, e.g. games/html5/my-game/
        if (!goodKey(prefix) || !prefix.endsWith('/') || prefix.split('/').length < 4) return json({ error: 'Bad folder' }, 400);
        let n = 0, cursor;
        for (let i = 0; i < 50; i++) {
          const res = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
          if (res.objects.length) await env.MEDIA.delete(res.objects.map((o) => o.key));
          n += res.objects.length;
          if (!res.truncated) break;
          cursor = res.cursor;
        }
        cached = null;
        return json({ ok: true, deleted: n });
      }
      if (!goodKey(key)) return json({ error: 'Bad file name' }, 400);
      await env.MEDIA.delete(key);
      cached = null;
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/admin/')) {
      try {
        return await adminApi(request, env, url);
      } catch (e) {
        console.error('admin api:', e);
        return json({ error: e.message || 'Something went wrong' }, 500);
      }
    }
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
