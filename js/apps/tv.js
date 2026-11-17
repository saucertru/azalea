// Free TV: official live streams that public broadcasters publish
// themselves (YouTube embeds). Channels are listed in js/config.js.
import { CONFIG } from '../config.js';
import { h, icon } from '../ui.js';
import { player as musicPlayer } from './music.js';

export default {
  id: 'tv',
  name: 'TV',
  icon: 'tv',
  mount(el, params, ctx) {
    const browse = h('div', {},
      h('p', { class: 'muted small' }, 'Official free live streams published by the broadcasters. A channel only plays while it’s live.'),
      h('div', { class: 'grid tv-grid' }, CONFIG.liveChannels.map((c) =>
        h('div', { class: 'card tv-card', tabindex: 0,
          onClick: () => watch(c.name, `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(c.channel)}&autoplay=1`),
          onKeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
        h('div', { class: 'tv-logo' }, h('span', { class: 'live-dot' }), h('b', {}, c.name)),
        h('div', { class: 'card-body' }, h('span', { class: 'muted small' }, 'Live stream'))))));
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
  },
};
