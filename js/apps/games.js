import { h, icon, empty, spinner, debounce, toast } from '../ui.js';
import { getManifest } from '../data.js';
import { getLocal, setLocal } from '../store.js';

const TYPE_LABEL = { html5: 'HTML5', webport: 'Webport', flash: 'Flash', rom: 'ROM' };

export function gameUrl(g) {
  if (g.type === 'flash' || g.type === 'rom') {
    const q = new URLSearchParams({ type: g.type, src: decodeURI(g.src), title: g.title });
    if (g.core) q.set('core', g.core);
    return `play.html?${q}`;
  }
  return g.src;
}

export function gameCover(g, cls = 'game-cover') {
  if (g.cover) return h('img', { class: cls, src: g.cover, alt: '', loading: 'lazy' });
  // plain coloured cover from the title
  let hash = 0;
  for (const c of g.title) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return h('div', { class: `${cls} gen`, style: { background: `hsl(${hue} 45% 38%)` } },
    h('span', {}, g.title.slice(0, 2).toUpperCase()));
}

export function markPlayed(g) {
  const recent = getLocal('games.recent', []).filter((id) => id !== g.id);
  recent.unshift(g.id);
  setLocal('games.recent', recent.slice(0, 20));
}

/** Opens a game: its own window in desktop mode, or inside `el` in browser mode. */
export function launchGame(g, ctx, el, onBack) {
  markPlayed(g);
  const url = gameUrl(g);
  if (ctx.openFrame(g.title, url, { iconName: 'games', width: 1000, height: 680 })) return;
  const frame = h('iframe', { class: 'game-frame', src: url, allow: 'autoplay; fullscreen; gamepad; clipboard-write', allowfullscreen: true, title: g.title });
  const wrap = h('div', { class: 'game-player' },
    h('div', { class: 'gp-bar' },
      h('button', { class: 'btn sm', onClick: onBack }, h('span', { html: icon('back', 16) }), 'Back'),
      h('b', { class: 'gp-title' }, g.title),
      h('span', { class: 'chip' }, g.system || TYPE_LABEL[g.type]),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', title: 'Share to chat', onClick: () => ctx.open('chat', { share: g.id }) }, h('span', { html: icon('share', 16) }), 'Share'),
      h('button', { class: 'btn sm', title: 'Open in new tab', onClick: () => window.open(url, '_blank') }, h('span', { html: icon('external', 16) })),
      h('button', { class: 'btn sm primary', title: 'Fullscreen', onClick: () => (frame.requestFullscreen?.() || frame.webkitRequestFullscreen?.()) }, h('span', { html: icon('fullscreen', 16) }), 'Fullscreen')),
    frame);
  el.replaceChildren(wrap);
}

export default {
  id: 'games',
  name: 'Games',
  icon: 'games',
  mount(el, params, ctx) {
    let games = [];
    let filter = 'all';
    let query = params.q || '';
    let favs = new Set(getLocal('games.favs', []));

    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search games', value: query });
    const chips = h('div', { class: 'chips' });
    const grid = h('div', { class: 'grid games-grid' });
    const browse = h('div', { class: 'games-browse' },
      h('div', { class: 'toolbar' }, search,
        h('button', { class: 'icon-btn', title: 'Rescan games', html: icon('refresh', 18), onClick: () => load(true) })),
      chips, grid);
    el.append(browse);

    const showBrowse = () => el.replaceChildren(browse);

    function filters() {
      const f = [['all', 'All'], ['favs', '★ Favourites'], ['recent', 'Recent']];
      for (const t of ['html5', 'webport', 'flash', 'rom']) if (games.some((g) => g.type === t)) f.push([t, TYPE_LABEL[t]]);
      const systems = [...new Set(games.filter((g) => g.type === 'rom').map((g) => g.system))];
      if (systems.length > 1) systems.forEach((s) => f.push([`sys:${s}`, s]));
      return f;
    }

    function renderChips() {
      chips.replaceChildren(...filters().map(([id, label]) =>
        h('button', { class: `chip-btn${filter === id ? ' on' : ''}`, onClick: () => { filter = id; renderChips(); renderGrid(); } }, label)));
    }

    function renderGrid() {
      const q = query.toLowerCase();
      let list = games;
      if (filter === 'favs') list = list.filter((g) => favs.has(g.id));
      else if (filter === 'recent') {
        const recent = getLocal('games.recent', []);
        list = recent.map((id) => games.find((g) => g.id === id)).filter(Boolean);
      } else if (filter.startsWith('sys:')) list = list.filter((g) => g.system === filter.slice(4));
      else if (filter !== 'all') list = list.filter((g) => g.type === filter);
      if (q) list = list.filter((g) => `${g.title} ${g.description} ${g.system || ''}`.toLowerCase().includes(q));

      if (!games.length) return grid.replaceChildren(empty('No games yet', 'Drop games into games/html5, games/webports, games/flash or games/roms, then rebuild.'));
      if (!list.length) return grid.replaceChildren(empty(filter === 'favs' ? 'No favourites yet' : 'No games found'));

      grid.replaceChildren(...list.map((g) => {
        const fav = favs.has(g.id);
        return h('div', { class: 'card game-card', tabindex: 0, onClick: () => play(g), onKeydown: (e) => e.key === 'Enter' && play(g) },
          gameCover(g),
          h('button', {
            class: `fav${fav ? ' on' : ''}`, title: fav ? 'Unfavourite' : 'Favourite',
            onClick: (e) => {
              e.stopPropagation();
              fav ? favs.delete(g.id) : favs.add(g.id);
              setLocal('games.favs', [...favs]);
              renderGrid();
            },
          }, fav ? '★' : '☆'),
          h('div', { class: 'card-body' },
            h('b', { class: 'clamp1' }, g.title),
            h('span', { class: 'chip sm' }, g.system || TYPE_LABEL[g.type])));
      }));
    }

    function play(g) {
      launchGame(g, ctx, el, showBrowse);
    }

    search.addEventListener('input', debounce(() => { query = search.value; renderGrid(); }, 120));

    async function load(force) {
      grid.replaceChildren(spinner());
      const m = await getManifest(force);
      games = m.games;
      renderChips();
      renderGrid();
      if (force) toast(`${games.length} games found`);
      if (params.play) {
        const g = games.find((x) => x.id === params.play);
        if (g) play(g);
        else toast('That game isn’t on this site anymore', 'error');
        params = {};
      }
    }
    load(false);
  },
};
