// Azelela server for Render (or any Node host).
// Serves the site, the Scramjet web proxy files, and a Wisp server at /wisp/.
//   npm start   ->  http://localhost:8080 (or $PORT)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { buildManifestAsync, proxyDirs } = require('../scripts/build-manifest.cjs');
const ROOT = fileURLToPath(new URL('../', import.meta.url));

// ---- Wisp (the part that actually fetches websites)
logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: false,   // nobody can reach Render's internal network
  allow_loopback_ips: false,
  // Cloudflare "family" DNS: blocks malware and adult sites.
  // Set the env var SAFE_DNS=off on Render to use normal DNS instead.
  ...(process.env.SAFE_DNS === 'off' ? {} : { dns_method: 'resolve', dns_servers: ['1.1.1.3', '1.0.0.3'] }),
  // add sites to block here, e.g. /(^|\.)example\.com$/
  hostname_blacklist: [],
});

const fastify = Fastify({
  serverFactory: (handler) =>
    createServer()
      .on('request', handler)
      .on('upgrade', (req, socket, head) => {
        if (req.url.endsWith('/wisp/')) wisp.routeRequest(req, socket, head);
        else socket.end();
      }),
});

// manifest.json: local files + R2 (when R2_* env vars are set), rebuilt at
// most once a minute so new files show up without redeploying
let manifestCache = null;
let manifestAt = 0;
fastify.get('/manifest.json', async (req, reply) => {
  if (!manifestCache || Date.now() - manifestAt > 60_000) {
    manifestCache = buildManifestAsync().then((r) => r.manifest);
    manifestAt = Date.now();
  }
  reply.header('Cache-Control', 'no-store');
  return manifestCache;
});

// the website (e.g. on Cloudflare Pages) calls this to wake Render up early
fastify.get('/health', (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store').send('ok');
});

// web proxy files (Scramjet 2, its controller, the libcurl transport)
for (const [name, dir] of Object.entries(proxyDirs())) {
  fastify.register(fastifyStatic, { root: dir, prefix: `/${name}/`, decorateReply: false });
}

// Install Chrome extensions from a Web Store link: downloads the .crx from
// Google for the browser (Google doesn't allow that cross-origin directly).
fastify.get('/api/crx/:id', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  const { id } = req.params;
  if (!/^[a-p]{32}$/.test(id)) return reply.code(400).send('Not a Chrome Web Store extension id');
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=138.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return reply.code(r.status).send('Download failed');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 50 * 1024 * 1024) return reply.code(413).send('Extension too big');
    return reply.type('application/x-chrome-extension').send(buf);
  } catch {
    return reply.code(502).send('Could not reach the Chrome Web Store');
  }
});

// the site itself (but never server code, packages or hidden files)
const PRIVATE = /^\/(node_modules|server|scripts|supabase)(\/|$)|\/\.|^\/package(-lock)?\.json$|^\/render\.yaml$/;
fastify.register(fastifyStatic, {
  root: ROOT,
  prefix: '/',
  allowedPath: (pathName) => !PRIVATE.test(pathName),
});

fastify.setNotFoundHandler((req, reply) => reply.code(404).type('text/plain').send('Not found'));

const shutdown = () => fastify.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const port = Number.parseInt(process.env.PORT || '', 10) || 8080;
fastify.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Azelela running on http://localhost:${port}`);
});
