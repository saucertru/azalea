// Free TV: official live streams from public broadcasters (YouTube embeds)
// and public-domain shows/films from the Internet Archive.
import { CONFIG } from '../config.js';
import { h, icon, empty, spinner } from '../ui.js';
import { player as musicPlayer } from './music.js';

export default {
  id: 'tv',
  name: 'TV',
  icon: 'tv',
  mount(el, params, ctx) {
    let alive = true;
    let tab = 'live';
    let collection = CONFIG.archiveCollections[0]?.id;
    let reqId = 0;
    const tabs = h('div', { class: 'seg' });
    const body = h('div', { class: 'tv-body' });
    const browse = h('div', {}, tabs, body);
    el.append(browse);

    function watch(title, url) {
      if (musicPlayer.playing) musicPlayer.toggle();
      if (ctx.openFrame(title, url, { iconName: 'tv', width: 960, height: 600 })) return;
      el.replaceChildren(h('div', { class: 'viewer' },
        h('div', { class: 'row gap' },
          h('button', { class: 'btn sm', onClick: () => el.replaceChildren(browse) }, h('span', { html: icon('back', 16) }), 'Back'),
          h('b', { class: 'grow clamp1' }, title)),
        h('div', { class: 'tv-frame-wrap' }, h('iframe', { class: 'tv-frame', src: url, title, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true }))));
    }

    function renderTabs() {
      tabs.replaceChildren(
        h('button', { class: tab === 'live' ? 'on' : '', onClick: () => { tab = 'live'; renderTabs(); render(); } }, 'Live channels'),
        h('button', { class: tab === 'archive' ? 'on' : '', onClick: () => { tab = 'archive'; renderTabs(); render(); } }, 'Classic TV & films'));
    }

    function renderLive() {
      body.replaceChildren(
        h('p', { class: 'muted small' }, 'Official free live streams published by the broadcasters. A channel only plays while it’s live.'),
        h('div', { class: 'grid tv-grid' }, CONFIG.liveChannels.map((c) =>
          h('div', { class: 'card tv-card', tabindex: 0,
            onClick: () => watch(c.name, `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(c.channel)}&autoplay=1`),
            onKeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
          h('div', { class: 'tv-logo' }, h('span', { class: 'live-dot' }), h('b', {}, c.name)),
          h('div', { class: 'card-body' }, h('span', { class: 'muted small' }, 'Live stream'))))));
    }

    async function renderArchive(q = '') {
      const input = h('input', { class: 'input', type: 'search', placeholder: 'Search this collection', value: q });
      const sel = h('select', { class: 'input' }, CONFIG.archiveCollections.map((c) => h('option', { value: c.id, selected: c.id === collection }, c.name)));
      const grid = h('div', { class: 'grid video-grid' }, spinner());
      sel.onchange = () => { collection = sel.value; renderArchive(input.value); };
      input.onkeydown = (e) => { if (e.key === 'Enter') renderArchive(input.value); };
      body.replaceChildren(h('div', { class: 'toolbar' }, sel, input), h('p', { class: 'muted small' }, 'Public-domain shows and films from the Internet Archive.'), grid);
      const id = ++reqId;
      const query = `collection:(${collection}) AND mediatype:(movies)${q.trim() ? ` AND (${q.trim().replace(/[()":]/g, ' ')})` : ''}`;
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=year&sort[]=downloads+desc&rows=60&page=1&output=json`;
      try {
        const r = await fetch(url);
        const j = await r.json();
        if (!alive || id !== reqId) return;
        const docs = j.response?.docs || [];
        if (!docs.length) return grid.replaceChildren(empty('Nothing found'));
        grid.replaceChildren(...docs.map((d) => h('div', { class: 'card video-card', tabindex: 0,
          onClick: () => watch(d.title, `https://archive.org/embed/${encodeURIComponent(d.identifier)}`),
          onKeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
        h('div', { class: 'vid-thumb-wrap' }, h('img', { class: 'vid-thumb', src: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, alt: '', loading: 'lazy' })),
        h('div', { class: 'card-body' }, h('b', { class: 'clamp2' }, Array.isArray(d.title) ? d.title[0] : d.title), d.year ? h('span', { class: 'muted small' }, String(d.year)) : null))));
      } catch (e) {
        if (alive && id === reqId) grid.replaceChildren(empty('Could not reach the Internet Archive', e.message));
      }
    }

    function render() {
      if (tab === 'live') renderLive();
      else renderArchive();
    }
    renderTabs();
    render();
    return () => { alive = false; };
  },
};
