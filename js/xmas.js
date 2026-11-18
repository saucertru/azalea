// Christmas decorations: string lights, holly and gentle snow.
// Decoration only: it doesn't change the theme colours, and it can be
// turned off in Settings (settings.xmas). It never catches clicks.
import { h } from './ui.js';
import { settings, on } from './store.js';

// turning them off in Settings hides them everywhere straight away
const sync = () => document.body.classList.toggle('no-xmas', settings.xmas === false);
sync();
on('settings', sync);

const BULBS = 18;
const COLORS = ['#e23b3b', '#f5c542', '#2fb465', '#3b8cf0', '#f07ad1'];

function lights() {
  // the wire sags between bulbs; each bulb hangs from a low point
  let d = 'M0 2';
  for (let i = 0; i < BULBS; i++) d += ` Q${(i + 0.5) * (100 / BULBS)} 14 ${(i + 1) * (100 / BULBS)} 2`;
  const wire = `<svg class="xm-wire" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  return h('div', { class: 'xm-lights' },
    h('div', { class: 'xm-wire-wrap', html: wire }),
    h('div', { class: 'xm-bulbs' }, Array.from({ length: BULBS }, (_, i) =>
      h('i', { style: `--c:${COLORS[i % COLORS.length]};--d:${((i * 0.37) % 2).toFixed(2)}s` }))));
}

const HOLLY = `<svg viewBox="0 0 64 40" aria-hidden="true">
  <path d="M30 22c-6-2-10-8-20-6 3 2 2 5 5 6-3 1-4 4-7 4 7 4 14 1 22-4z" fill="#2c8a4b"/>
  <path d="M34 22c6-2 10-8 20-6-3 2-2 5-5 6 3 1 4 4 7 4-7 4-14 1-22-4z" fill="#237a40"/>
  <circle cx="29" cy="24" r="4" fill="#d62f3a"/><circle cx="36" cy="24" r="4" fill="#e23b3b"/><circle cx="32.5" cy="29" r="4" fill="#c42531"/>
</svg>`;

/** A decoration layer. Put it inside an element with position: relative. */
export function xmasLayer({ snow = 36, garland = true } = {}) {
  const flakes = Array.from({ length: snow }, () => {
    const size = 2 + Math.random() * 4;
    const style = [
      `left:${(Math.random() * 100).toFixed(1)}%`,
      `width:${size.toFixed(1)}px`, `height:${size.toFixed(1)}px`,
      `opacity:${(0.35 + Math.random() * 0.5).toFixed(2)}`,
      `--dur:${(9 + Math.random() * 10).toFixed(1)}s`,
      `--delay:${(-Math.random() * 19).toFixed(1)}s`,
      `--dx:${(Math.random() * 60 - 30).toFixed(0)}px`,
    ].join(';');
    return h('i', { class: 'xm-flake', style });
  });
  return h('div', { class: 'xmas', 'aria-hidden': 'true' },
    h('div', { class: 'xm-snow' }, flakes),
    garland ? lights() : null,
    garland ? h('span', { class: 'xm-holly left', html: HOLLY }) : null,
    garland ? h('span', { class: 'xm-holly right', html: HOLLY }) : null);
}

/** Adds the decorations to `host` (hidden while turned off in Settings). */
export function decorate(host, opts) {
  const layer = xmasLayer(opts);
  host.prepend(layer);
  return layer;
}

/**
 * "37 days until Christmas" from 1 November, "Merry Christmas!" on the
 * 25th and 26th; empty the rest of the year.
 */
export function christmasText(now = new Date()) {
  const m = now.getMonth(), d = now.getDate();
  if (m === 11 && (d === 25 || d === 26)) return 'Merry Christmas! 🎄';
  if (!(m === 10 || (m === 11 && d < 25))) return '';
  const today = new Date(now.getFullYear(), m, d);
  const xmas = new Date(now.getFullYear(), 11, 25);
  const days = Math.round((xmas - today) / 86400000);
  if (days === 1) return '🎄 Christmas is tomorrow!';
  return `🎄 ${days} days until Christmas`;
}

/** A small countdown label that keeps itself up to date. Hidden with the decorations. */
export function countdownEl(cls = '') {
  const el = h('div', { class: `xmas-count ${cls}`.trim() });
  const tick = () => {
    if (!el.isConnected && el.dataset.started) return clearInterval(t);
    el.dataset.started = '1';
    const text = christmasText();
    el.textContent = text;
    el.hidden = !text;
  };
  const t = setInterval(tick, 60000);
  tick();
  return el;
}
