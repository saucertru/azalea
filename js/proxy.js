// Web proxy: Scramjet 2 (controller + libcurl transport over Wisp) with
// Sapphire for Chrome extensions. The proxy files are served by the website
// itself; the Wisp server (what actually fetches sites) can be elsewhere,
// e.g. Render.
import { CONFIG } from './config.js';
import { emit, on } from './store.js';

const FILES = {
  scramjet: '/scramjet/scramjet.js',
  controller: '/controller/controller.api.js',
  libcurl: '/libcurl/index.mjs',
  sapphire: '/js/vendor/sapphire.js',
};
export const SEARCH = 'https://duckduckgo.com/?q=%s';

// ---------------------------------------------------------------- wisp
/** The Wisp server: CONFIG.wispUrl, or this site's own /wisp/ */
export function wispUrl() {
  return CONFIG.wispUrl || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wisp/`;
}

/** http(s) origin of the server that runs Wisp (also serves /api/crx). */
export function serverOrigin() {
  try {
    const u = new URL(wispUrl());
    return `${u.protocol === 'ws:' ? 'http:' : 'https:'}//${u.host}`;
  } catch {
    return location.origin;
  }
}

let woke = false;
/** Free Render servers sleep after 15 minutes; poke it so it's awake by the time it's needed. */
export function wakeWisp() {
  if (woke || !CONFIG.wispUrl) return;
  woke = true;
  fetch(`${serverOrigin()}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

// ---------------------------------------------------------------- helpers
let available = null;
/** True when this site hosts the proxy files (false on the plain dev server). */
export function proxyAvailable() {
  if (!available) {
    available = fetch(FILES.scramjet, { method: 'HEAD', cache: 'no-store' })
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

// ---------------------------------------------------------------- tabs
// Every Web app page registers a tab here so Sapphire (chrome.tabs etc.)
// can see and control it.
const tabs = new Map(); // id -> { id, iframe, frame, hooks }
let nextTabId = 1;
let activeTabId = null;
let opener = null; // (url, { active }) => Promise<tabId>, set by the shell
const pendingCreates = new Map(); // token -> resolve(tabId)

export function setOpener(fn) { opener = fn; }

function tabUrl(tab) {
  try {
    const loc = tab.iframe.contentWindow?.location;
    if (!loc) return '';
    if (!loc.pathname.startsWith(tab.frame.prefix)) return loc.href;
    return decodeURIComponent(loc.pathname.slice(tab.frame.prefix.length)) + loc.hash;
  } catch {
    return '';
  }
}
function tabTitle(tab) {
  try { return tab.iframe.contentDocument?.title ?? ''; } catch { return ''; }
}
function tabInfo(tab) {
  return { id: tab.id, windowId: 1, url: tabUrl(tab), title: tabTitle(tab), active: tab.id === activeTabId, index: [...tabs.keys()].indexOf(tab.id) };
}

// ---------------------------------------------------------------- setup
let readyPromise = null;
let controller = null;
let sapphire = null;
export const getSapphire = () => sapphire;

const ui = () => import('./extensions.js');

function createSapphire(Sapphire) {
  return new Sapphire({
    host: {
      ensureController: () => { proxyReady().catch(() => {}); },
      getTabId: (win) => {
        for (const t of tabs.values()) if (t.iframe.contentWindow === win) return t.id;
        return null;
      },
      getTab: (id) => (tabs.has(id) ? tabInfo(tabs.get(id)) : null),
      getAllTabs: () => [...tabs.values()].map(tabInfo),
      getActiveTabId: () => activeTabId,
      getTabWindow: (id) => tabs.get(id)?.iframe.contentWindow ?? null,
      createTab: (url, { active }) => openNewTab(url, active),
      navigateTab: (id, url) => (id === null || !tabs.has(id) ? void openNewTab(url, true) : tabs.get(id).go(url)),
      closeTab: (id) => tabs.get(id)?.hooks.close?.(),
      reloadTab: (id) => tabs.get(id)?.frame.reload(),
      activateTab: (id) => tabs.get(id)?.hooks.activate?.(),
      goBack: (id) => tabs.get(id)?.frame.back(),
      goForward: (id) => tabs.get(id)?.frame.forward(),
      openPopup: (extId, tabId) => { ui().then((m) => m.showPopup(extId, tabId)); return true; },
      closePopup: () => { ui().then((m) => m.hidePopup()); },
      openSidePanel: (extId, path) => { ui().then((m) => m.notice(`An extension wanted to open a side panel (${path}), which isn't supported here.`)); },
      createNotification: (extId, id, options, callbacks) => { ui().then((m) => m.notify(extId, options, callbacks)); },
      showContextMenu: (request) => { ui().then((m) => m.showContextMenu(request, tabs.get(request.tabId)?.iframe)); },
      requestPermissions: (extId, perms, origins) => ui().then((m) => m.askPermissions(extId, perms, origins)),
      search: (text) => { void openNewTab(toUrl(text), true); },
    },
  });
}

function openNewTab(url, active = true) {
  if (!opener) return null;
  const token = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const p = new Promise((resolve) => {
    pendingCreates.set(token, resolve);
    setTimeout(() => { if (pendingCreates.delete(token)) resolve(null); }, 15000);
  });
  opener(url, { active, token });
  return p;
}

/** Sets everything up once: Scramjet, the service worker, the Wisp transport and Sapphire. */
export function proxyReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      wakeWisp();
      if (!(await proxyAvailable())) throw new Error('The web proxy files aren’t on this site (run the Pages build or the Node server).');
      if (!('serviceWorker' in navigator)) throw new Error('This browser blocks service workers (the site must be on https).');
      await loadScript(FILES.scramjet);
      await loadScript(FILES.controller);
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      // First visit: wait until the worker controls this page
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); resolve(); };
          const t = setTimeout(done, 4000);
          navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
        });
      }
      const { default: LibcurlTransport } = await import(FILES.libcurl);
      const transport = new LibcurlTransport({ wisp: wispUrl() });
      await transport.init();
      controller = new window.$scramjetController.Controller({
        serviceworker: navigator.serviceWorker.controller ?? reg.active,
        transport,
      });
      await controller.wait();

      try {
        const { Sapphire } = await import(FILES.sapphire);
        sapphire = createSapphire(Sapphire);
        sapphire.attachController(controller);
        await sapphire.init();
        sapphire.onChange(() => emit('extensions', sapphire));
        document.addEventListener('keydown', (e) => {
          try { if (sapphire.handleKeyboardEvent(e)) e.preventDefault(); } catch {}
        });
      } catch (e) {
        // the proxy still works without extensions
        console.error('Extensions (Sapphire) failed to start', e);
        sapphire = null;
      }
      return { controller, sapphire };
    })().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}

/**
 * Creates a proxied frame in `iframe` and registers it as a tab.
 * hooks: { activate(), close(), token } (token = from an extension's tabs.create)
 */
export async function registerTab(iframe, hooks = {}) {
  await proxyReady();
  const id = nextTabId++;
  const plugins = [navErrorPlugin((err) => hooks.navError?.(err))];
  if (sapphire) plugins.push(sapphire.createPlugin(id));
  const frame = controller.createFrame(iframe, { plugins });
  const tab = {
    id, iframe, frame, hooks,
    go: (url) => frame.go(sapphire ? sapphire.resolveUrl(url) : url),
    url: () => tabUrl(tab),
    title: () => tabTitle(tab),
    activate: () => setActiveTab(id),
    updated: (info) => { try { sapphire?.notifyTabUpdated(id, info); } catch {} },
    dispose: () => {
      tabs.delete(id);
      try { sapphire?.notifyTabRemoved(id); } catch {}
      if (activeTabId === id) activeTabId = [...tabs.keys()].pop() ?? null;
    },
  };
  tabs.set(id, tab);
  try { sapphire?.notifyTabCreated(id); } catch {}
  setActiveTab(id);
  if (hooks.token && pendingCreates.has(hooks.token)) {
    pendingCreates.get(hooks.token)(id);
    pendingCreates.delete(hooks.token);
  }
  return tab;
}

/** Tells the Web app when a page (not an image or script) fails to load, so it can retry. */
function navErrorPlugin(onError) {
  const { ManagedPlugin } = window.$scramjetController;
  class NavErrorPlugin extends ManagedPlugin {
    constructor() { super('azalea-nav-errors', []); }
    install(frame) {
      super.install(frame);
      this.tap(frame.hooks.error.request, (data) => {
        const r = data?.rawrequest || {};
        const nav = r.mode === 'navigate' || r.destination === 'document' || r.destination === 'iframe' || r.rawDestination === 'document' || r.rawDestination === 'iframe';
        if (nav) onError(data?.error);
      });
    }
  }
  return new NavErrorPlugin();
}

export function setActiveTab(id) {
  if (!tabs.has(id) || activeTabId === id) return;
  activeTabId = id;
  try { sapphire?.notifyTabActivated(id); } catch {}
  emit('extensions', sapphire);
}

export const getActiveTabId = () => activeTabId;
export const onExtensionsChange = (fn) => on('extensions', fn);
