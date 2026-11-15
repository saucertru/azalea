// Azelela server for Render (or any Node host).
// Serves the site, the Scramjet web proxy files, and a Wisp server at /wisp/.
//   npm start   ->  http://localhost:8080 (or $PORT)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { server as wisp, logging } from '@mercuryworkshop/wisp-js/server';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { libcurlPath } from '@mercuryworkshop/libcurl-transport';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';

const require = createRequire(import.meta.url);
const { buildManifest } = require('../scripts/build-manifest.cjs');
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

// manifest.json is built on every request, so new files show up on refresh
fastify.get('/manifest.json', (req, reply) => {
  reply.header('Cache-Control', 'no-store').send(buildManifest());
});

// proxy files
fastify.register(fastifyStatic, { root: scramjetPath, prefix: '/scram/', decorateReply: false });
fastify.register(fastifyStatic, { root: libcurlPath, prefix: '/libcurl/', decorateReply: false });
fastify.register(fastifyStatic, { root: baremuxPath, prefix: '/baremux/', decorateReply: false });

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
