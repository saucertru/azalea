import { settings } from './store.js';

export const THEMES = {
  midnight: { name: 'Midnight', bg: '#0b1020', bg2: '#10172b', panel: '#151d36', panel2: '#1c2645', text: '#e7ecff', muted: '#8d98bf', border: '#26315a', accent: '#7c8cff' },
  obsidian: { name: 'Obsidian', bg: '#09090b', bg2: '#0f0f12', panel: '#16161a', panel2: '#1f1f24', text: '#f4f4f5', muted: '#8b8b95', border: '#2a2a31', accent: '#22d3ee' },
  grape:    { name: 'Grape',    bg: '#130e1d', bg2: '#191226', panel: '#1f1630', panel2: '#2a1e40', text: '#f1e9ff', muted: '#a593c4', border: '#382952', accent: '#c084fc' },
  forest:   { name: 'Forest',   bg: '#0b130f', bg2: '#0f1a14', panel: '#13211a', panel2: '#1a2c22', text: '#e3f5ea', muted: '#86a895', border: '#24392d', accent: '#4ade80' },
  ocean:    { name: 'Ocean',    bg: '#06131a', bg2: '#0a1b24', panel: '#0e2330', panel2: '#132e3e', text: '#e0f4fb', muted: '#7fa6b6', border: '#1c3d50', accent: '#22d3ee' },
  sunset:   { name: 'Sunset',   bg: '#170d0b', bg2: '#1f1210', panel: '#271714', panel2: '#331f1b', text: '#ffece4', muted: '#bf9384', border: '#452a24', accent: '#fb923c' },
  rose:     { name: 'Rose',     bg: '#170b10', bg2: '#1f0f16', panel: '#27131c', panel2: '#331a25', text: '#ffe8ef', muted: '#c48a9d', border: '#472534', accent: '#fb7185' },
  mocha:    { name: 'Mocha',    bg: '#16120f', bg2: '#1d1814', panel: '#241e19', panel2: '#2e2620', text: '#f3e9de', muted: '#ad9b88', border: '#3e342b', accent: '#d6a46c' },
  arctic:   { name: 'Arctic',   bg: '#eef3f8', bg2: '#e4ebf3', panel: '#ffffff', panel2: '#f2f6fa', text: '#0f1b2a', muted: '#5b6b80', border: '#d3dce7', accent: '#2563eb', light: true },
  paper:    { name: 'Paper',    bg: '#f5efe3', bg2: '#ede5d5', panel: '#fffdf8', panel2: '#f8f2e6', text: '#2b2418', muted: '#7a6e5c', border: '#e2d7c2', accent: '#c2410c', light: true },
};

export const FONTS = [
  'Inter', 'Poppins', 'Nunito', 'Outfit', 'Space Grotesk', 'Lexend',
  'Comic Neue', 'JetBrains Mono', 'Press Start 2P', 'System',
];

export function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [124, 140, 255];
}

function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#0b0b0f' : '#ffffff';
}

let loadedFont = null;
function loadFont(font) {
  if (font === 'System' || font === loadedFont) return;
  loadedFont = font;
  let link = document.getElementById('font-link');
  if (!link) {
    link = document.createElement('link');
    link.id = 'font-link';
    link.rel = 'stylesheet';
    document.head.append(link);
  }
  const fam = font.replace(/ /g, '+');
  const weights = font === 'Press Start 2P' ? '' : ':wght@400;500;600;700';
  link.href = `https://fonts.googleapis.com/css2?family=${fam}${weights}&display=swap`;
}

/** Apply theme/accent/font/background from settings (or an override for previews). */
export function applyTheme(over = {}) {
  const s = { ...settings, ...over };
  const t = THEMES[s.theme] || THEMES.midnight;
  const accent = s.accent || t.accent;
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--bg2', t.bg2);
  root.setProperty('--panel', t.panel);
  root.setProperty('--panel2', t.panel2);
  root.setProperty('--text', t.text);
  root.setProperty('--muted', t.muted);
  root.setProperty('--border', t.border);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-rgb', hexToRgb(accent).join(','));
  root.setProperty('--panel-rgb', hexToRgb(t.panel).join(','));
  root.setProperty('--bg-rgb', hexToRgb(t.bg).join(','));
  root.setProperty('--accent-text', contrastText(accent));
  document.documentElement.style.colorScheme = t.light ? 'light' : 'dark';
  document.documentElement.dataset.light = t.light ? '1' : '0';

  const font = s.font || 'Inter';
  loadFont(font);
  const stack = font === 'System' ? 'system-ui' : `'${font}', system-ui`;
  root.setProperty('--font', `${stack}, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  root.setProperty('--font-scale', font === 'Press Start 2P' ? '0.78' : '1');

  if (s.background) {
    root.setProperty('--bg-image', `url("${String(s.background).replace(/"/g, '%22')}")`);
    document.body.classList.add('has-bg');
  } else {
    root.setProperty('--bg-image', 'none');
    document.body.classList.remove('has-bg');
  }
  root.setProperty('--bg-dim', String(s.bgDim ?? 0.45));
}
