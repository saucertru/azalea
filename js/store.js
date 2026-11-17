// Settings saved in the browser and (when logged in) synced to the profile.

// Storage keys keep the site's original spelling ("azelela") so people's
// saved settings and profiles survive the rename to Azalea.
const KEY = 'azelela.settings';

export const DEFAULTS = {
  theme: 'midnight',
  accent: null,       // null = theme's own accent
  font: 'Inter',
  background: null,   // image URL or data URL
  bgDim: 0.45,
  layout: 'browser',  // 'browser' | 'desktop'
  onboarded: false,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export const bus = new EventTarget();
export const on = (evt, fn) => {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(evt, handler);
  return () => bus.removeEventListener(evt, handler);
};
export const emit = (evt, detail) => bus.dispatchEvent(new CustomEvent(evt, { detail }));

let syncHook = null;
/** auth.js registers a function that pushes settings to the profile */
export function setSyncHook(fn) { syncHook = fn; }

let syncTimer;
export function saveSettings(patch, { sync = true } = {}) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage full (usually a big uploaded background) - drop the background
    if (settings.background?.startsWith('data:')) {
      settings.background = null;
      try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
    }
  }
  emit('settings', settings);
  if (sync && syncHook) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncHook(settings), 1200);
  }
}

// Small per-browser storage helpers (recently played etc.)
export function getLocal(key, fallback) {
  try {
    const v = localStorage.getItem(`azelela.${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function setLocal(key, value) {
  try {
    localStorage.setItem(`azelela.${key}`, JSON.stringify(value));
  } catch {}
}
