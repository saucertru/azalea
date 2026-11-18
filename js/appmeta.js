// Shared look + search helpers for the shells and home page.
import { h, icon } from './ui.js';
import { APPS, visibleApps } from './apps/index.js';
import { getManifest } from './data.js';
import { launchGame } from './apps/games.js';
import { proxyAvailable, toUrl } from './proxy.js';

// app icon colours [light, solid]; icons use the solid one
export const APP_COLORS = {
  home: ['#60a5fa', '#2563eb'],
  web: ['#818cf8', '#3b48d6'],
  games: ['#a78bfa', '#6d28d9'],
  music: ['#f472b6', '#db2777'],
  videos: ['#f87171', '#dc2626'],
  pdfs: ['#38bdf8', '#0369a1'],
  books: ['#fbbf24', '#b45309'],
  tv: ['#fb923c', '#c2410c'],
  ai: ['#22d3ee', '#0891b2'],
  chat: ['#4ade80', '#16a34a'],
  profile: ['#818cf8', '#4f46e5'],
  settings: ['#64748b', '#334155'],
  admin: ['#f87171', '#b91c1c'],
};

/** Coloured rounded-square app icon. */
export function appTile(id, size = 48) {
  const [, b] = APP_COLORS[id] || APP_COLORS.home;
  return h('span', {
    class: 'app-tile',
    style: { width: `${size}px`, height: `${size}px`, background: b, borderRadius: `${Math.round(size * 0.22)}px` },
    html: icon(APPS[id]?.icon || 'grid', Math.round(size * 0.5)),
  });
}

export function findApp(text) {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  return visibleApps().find((id) => id === q || APPS[id].name.toLowerCase() === q) || null;
}

export async function searchAll(text, limit = 6) {
  const q = text.trim().toLowerCase();
  if (!q) return { apps: [], games: [] };
  const m = await getManifest();
  return {
    apps: visibleApps().filter((id) => APPS[id].name.toLowerCase().includes(q) || id.includes(q)),
    games: m.games.filter((g) => g.title.toLowerCase().includes(q)).slice(0, limit),
  };
}

/** Opens a website or web search: through the proxy when the server has it, else a normal tab. */
export async function webSearch(text, ctx) {
  const url = toUrl(text);
  if (ctx && (await proxyAvailable())) ctx.open('web', { url });
  else window.open(url, '_blank', 'noopener');
}

export function openGame(g, ctx) {
  if (ctx.layout === 'desktop') launchGame(g, ctx, null, () => {});
  else ctx.open('games', { play: g.id });
}

/** All apps grid (used by "All Apps" on the home page). */
export function allAppsGrid(ctx, onPick) {
  return h('div', { class: 'all-apps' }, visibleApps().map((id) =>
    h('button', { class: 'all-app', onClick: () => { onPick?.(); ctx.open(id); } }, appTile(id, 52), h('span', {}, APPS[id].name))));
}

