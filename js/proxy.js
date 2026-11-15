// Scramjet web proxy (needs the Node server: `npm start`, e.g. on Render).
const FILES = {
  wasm: '/scram/scramjet.wasm.wasm',
  all: '/scram/scramjet.all.js',
  sync: '/scram/scramjet.sync.js',
};
const TRANSPORT = '/libcurl/index.mjs';
export const SEARCH = 'https://duckduckgo.com/?q=%s';

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
      if (!(await proxyAvailable())) throw new Error('The web proxy isn’t running on this server.');
      if (!('serviceWorker' in navigator)) throw new Error('This browser blocks service workers (the site must be on https).');
      await loadScript(FILES.all);
      await loadScript('/baremux/index.js');
      const { ScramjetController } = window.$scramjetLoadController();
      controller = new ScramjetController({ files: FILES });
      await controller.init();
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const conn = new window.BareMux.BareMuxConnection('/baremux/worker.js');
      const wispUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wisp/`;
      if ((await conn.getTransport()) !== TRANSPORT) {
        await conn.setTransport(TRANSPORT, [{ websocket: wispUrl }]);
      }
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
