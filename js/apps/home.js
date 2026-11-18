import { CONFIG } from '../config.js';
import { h, icon, modal } from '../ui.js';
import { getManifest } from '../data.js';
import { getLocal, on } from '../store.js';
import { searchAll, webSearch, openGame, allAppsGrid } from '../appmeta.js';
import { onlineCount } from '../presence.js';
import { mountClock } from '../widgets.js';
import { gameCover } from './games.js';
import { APPS } from './index.js';
import { decorate, countdownEl } from '../xmas.js';

const QUICK = ['games', 'ai', 'music', 'chat', 'videos'];

export default {
  id: 'home',
  name: 'Home',
  icon: 'home',
  mount(el, params, ctx) {
    // ---- search with suggestions
    const input = h('input', { class: 'home-search-input', placeholder: 'Search games or the web', spellcheck: 'false', 'aria-label': 'Search' });
    const sugg = h('div', { class: 'home-sugg hidden' });
    let first = null;
    const go = async () => {
      const q = input.value.trim();
      if (!q) return;
      if (first) return first();
      const r = await searchAll(q);
      if (r.games.length) ctx.open('games', { q });
      else webSearch(q, ctx);
    };
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      first = null;
      if (!q) { sugg.classList.add('hidden'); return; }
      const r = await searchAll(q, 5);
      if (input.value.trim() !== q) return;
      const items = [
        ...r.apps.map((id) => ({ ic: APPS[id].icon, label: APPS[id].name, sub: 'App', run: () => ctx.open(id) })),
        ...r.games.map((g) => ({ ic: 'games', label: g.title, sub: 'Game', run: () => openGame(g, ctx) })),
        { ic: 'globe', label: `Search the web for “${q}”`, sub: 'Web', run: () => webSearch(q, ctx) },
      ];
      first = items.length > 1 ? items[0].run : null;
      sugg.replaceChildren(...items.map((it) => h('button', { class: 'sugg-item', onClick: it.run },
        h('span', { html: icon(it.ic, 16) }), h('span', { class: 'grow clamp1' }, it.label), h('span', { class: 'muted tiny' }, it.sub))));
      sugg.classList.remove('hidden');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
      if (e.key === 'Escape') { input.value = ''; sugg.classList.add('hidden'); }
    });
    input.addEventListener('blur', () => setTimeout(() => sugg.classList.add('hidden'), 150));

    // ---- quick buttons
    const quick = h('div', { class: 'quick' },
      QUICK.map((id) => h('button', { class: 'quick-btn', onClick: () => ctx.open(id) },
        h('span', { class: 'quick-ic', html: icon(APPS[id].icon, 20) }), h('span', {}, APPS[id].name))),
      h('button', { class: 'quick-btn', onClick: () => {
        const m = modal({ title: 'All apps', wide: true, content: allAppsGrid(ctx, () => m.close()) });
      } }, h('span', { class: 'quick-ic', html: icon('grid', 20) }), h('span', {}, 'All Apps')));

    const online = h('div', { class: 'online-pill' });
    const renderOnline = (n = onlineCount) => online.replaceChildren(h('span', { html: icon('user', 14) }), h('b', {}, String(n)), ` user${n === 1 ? '' : 's'} online`);
    renderOnline();

    const time = h('div', { class: 'clock-time' });
    const date = h('div', { class: 'clock-date' });
    const recent = h('div', { class: 'home-recent' });

    const host = h('div', { class: 'home-host' });
    el.append(host);
    decorate(host);
    host.append(h('div', { class: 'home2' },
      h('h1', { class: 'glow-logo' }, CONFIG.siteName.toLowerCase()),
      h('div', { class: 'home-search' }, h('span', { class: 'hs-ic', html: icon('search', 18) }), input,
        h('button', { class: 'hs-go', 'aria-label': 'Search', html: icon('back', 16), onClick: go }), sugg),
      quick, online,
      h('div', { class: 'clock-card' }, time, date, countdownEl('home')),
      recent));

    getManifest().then((m) => {
      const list = getLocal('games.recent', []).map((id) => m.games.find((g) => g.id === id)).filter(Boolean).slice(0, 6);
      if (!list.length) return;
      recent.replaceChildren(h('div', { class: 'muted tiny list-label center' }, 'Jump back in'),
        h('div', { class: 'recent-row' }, list.map((g) => h('button', { class: 'recent-game', title: g.title, onClick: () => openGame(g, ctx) },
          gameCover(g, 'recent-cover'), h('span', { class: 'clamp1' }, g.title)))));
    });

    const offs = [mountClock(time, date), on('online', renderOnline)];
    return () => offs.forEach((f) => f());
  },
};
