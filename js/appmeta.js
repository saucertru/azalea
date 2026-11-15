// Shared look + search helpers for the shells and home page.
import { h, icon } from './ui.js';
import { APPS, APP_ORDER } from './apps/index.js';
import { getManifest } from './data.js';
import { launchGame } from './apps/games.js';

// gradient colours for app icons (desktop + home)
export const APP_COLORS = {
  home: ['#60a5fa', '#2563eb'],
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
};

/** Coloured rounded-square app icon. */
export function appTile(id, size = 48) {
  const [a, b] = APP_COLORS[id] || APP_COLORS.home;
  return h('span', {
    class: 'app-tile',
    style: { width: `${size}px`, height: `${size}px`, background: `linear-gradient(160deg, ${a}, ${b})`, borderRadius: `${Math.round(size * 0.28)}px` },
    html: icon(APPS[id]?.icon || 'grid', Math.round(size * 0.5)),
  });
}

export function findApp(text) {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  return APP_ORDER.find((id) => id === q || APPS[id].name.toLowerCase() === q) || null;
}

export async function searchAll(text, limit = 6) {
  const q = text.trim().toLowerCase();
  if (!q) return { apps: [], games: [] };
  const m = await getManifest();
  return {
    apps: APP_ORDER.filter((id) => APPS[id].name.toLowerCase().includes(q) || id.includes(q)),
    games: m.games.filter((g) => g.title.toLowerCase().includes(q)).slice(0, limit),
  };
}

export function webSearch(text) {
  window.open(`https://duckduckgo.com/?q=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export function openGame(g, ctx) {
  if (ctx.layout === 'desktop') launchGame(g, ctx, null, () => {});
  else ctx.open('games', { play: g.id });
}

/** All apps grid (used by "All Apps" on the home page). */
export function allAppsGrid(ctx, onPick) {
  return h('div', { class: 'all-apps' }, APP_ORDER.map((id) =>
    h('button', { class: 'all-app', onClick: () => { onPick?.(); ctx.open(id); } }, appTile(id, 52), h('span', {}, APPS[id].name))));
}

// Desktop wallpaper mark: a tilted chrome ring with a four-point star
export const LOGO_SVG = `<svg viewBox="0 0 520 360" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs>
  <linearGradient id="azc" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".28" stop-color="#9ea6b8"/>
    <stop offset=".5" stop-color="#f5f7fc"/><stop offset=".75" stop-color="#6b7284"/><stop offset="1" stop-color="#d9dde7"/>
  </linearGradient>
  <linearGradient id="azs" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".42" stop-color="#c3c9d6"/><stop offset=".55" stop-color="#7d8598"/><stop offset="1" stop-color="#eef0f6"/>
  </linearGradient>
  <clipPath id="azfront"><rect x="-40" y="180" width="600" height="220"/></clipPath>
  <filter id="azg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
</defs>
<g opacity=".35" filter="url(#azg)"><ellipse cx="260" cy="180" rx="210" ry="58" fill="none" stroke="#c9d0e0" stroke-width="6" transform="rotate(-22 260 180)"/></g>
<ellipse cx="260" cy="180" rx="210" ry="58" fill="none" stroke="url(#azc)" stroke-width="11" transform="rotate(-22 260 180)"/>
<path d="M262 52 C270 140 282 160 372 178 C282 196 270 216 262 308 C254 216 242 196 152 178 C242 160 254 140 262 52Z" fill="url(#azs)"/>
<g clip-path="url(#azfront)"><ellipse cx="260" cy="180" rx="210" ry="58" fill="none" stroke="url(#azc)" stroke-width="11" transform="rotate(-22 260 180)"/></g>
</svg>`;
