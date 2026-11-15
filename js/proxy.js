// Scramjet web proxy. The proxy files are served by the website itself;
// the Wisp server (what actually fetches sites) can be elsewhere, e.g. Render.
import { CONFIG } from './config.js';
const FILES = {
  wasm: '/scram/scramjet.wasm.wasm',
  all: '/scram/scramjet.all.js',
  sync: '/scram/scramjet.sync.js',
};
const TRANSPORT = '/libcurl/index.mjs';
export const SEARCH = 'https://duckduckgo.com/?q=%s';

/** The Wisp server: CONFIG.wispUrl, or this site's own /wisp/ */
export function wispUrl() {
  return CONFIG.wispUrl || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wisp/`;
}

let woke = false;
/** Free Render servers sleep after 15 minutes; poke it so it's awake by the time it's needed. */
export function wakeWisp() {
  if (woke || !CONFIG.wispUrl) return;
  woke = true;
  try {
    const u = new URL(CONFIG.wispUrl);
    u.protocol = u.protocol === 'ws:' ? 'http:' : 'https:';
    u.pathname = '/health';
    fetch(u, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch {}
}

let available = null;
let readyPromise = null;
let controller = null;

/** True when the server is hosting the proxy files (false on static hosts). */
export function proxyAvailable() {
  if (!available) {
    available = fetch(FILES.all, { method: 'HEAD', cache: 'no-store' })
      .then((r) => r.ok && /javascript/.test(r.headers.get('content-type') || ''))
      .catch(() => false);
  }
  return available;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

/** Sets everything up once: Scramjet, the service worker and the Wisp transport. */
export function proxyReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      wakeWisp();
      if (!(await proxyAvailable())) throw new Error('The web proxy files aren’t on this site (run the Pages build or the Node server).');
      if (!('serviceWorker' in navigator)) throw new Error('This browser blocks service workers (the site must be on https).');
      await loadScript(FILES.all);
      await loadScript('/baremux/index.js');
      const { ScramjetController } = window.$scramjetLoadController();
      controller = new ScramjetController({ files: FILES });
      await controller.init();
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      // First visit: wait until the worker controls this page, otherwise the
      // first site can load before the worker can reach the proxy connection.
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); resolve(); };
          const t = setTimeout(done, 4000);
          navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
        });
      }
      const conn = new window.BareMux.BareMuxConnection('/baremux/worker.js');
      // always (re)set: the Wisp address may have changed since last visit
      await conn.setTransport(TRANSPORT, [{ websocket: wispUrl() }]);
      return controller;
    })().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}

/** Turns what someone typed into a full URL (or a search URL). */
export function toUrl(input) {
  const s = input.trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  try {
    const u = new URL(`https://${s}`);
    if (u.hostname.includes('.') && !/\s/.test(s)) return u.toString();
  } catch {}
  return SEARCH.replace('%s', encodeURIComponent(s));
}

/** Does the text look like a website address (rather than a search)? */
export function looksLikeUrl(input) {
  return !toUrl(input).startsWith(SEARCH.split('%s')[0]);
}

export async function encode(url) {
  const c = await proxyReady();
  return c.encodeUrl(url);
}

/** The real URL behind a proxied one (or null). */
export function decode(proxied) {
  try {
    return controller ? controller.decodeUrl(proxied) : null;
  } catch {
    return null;
  }
}
