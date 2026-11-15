import { h, icon, empty, spinner, debounce, formatTime } from '../ui.js';
import { getManifest } from '../data.js';
import { getLocal, setLocal } from '../store.js';
import { player as musicPlayer } from './music.js';

function thumb(v) {
  return v.cover
    ? h('img', { class: 'vid-thumb', src: v.cover, alt: '', loading: 'lazy' })
    : h('div', { class: 'vid-thumb ph', html: icon('video', 32) });
}

export default {
  id: 'videos',
  name: 'Videos',
  icon: 'video',
  mount(el, params) {
    let videos = [];
    let query = '';
    const progress = getLocal('videos.progress', {});

    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search videos' });
    const grid = h('div', { class: 'grid video-grid' });
    const browse = h('div', {}, h('div', { class: 'toolbar' }, search), grid);
    el.append(browse);

    function renderGrid() {
      const q = query.toLowerCase();
      const list = videos.filter((v) => !q || v.title.toLowerCase().includes(q));
      if (!videos.length) return grid.replaceChildren(empty('No videos yet', 'Drop video files into the /videos folder, then rebuild.'));
      if (!list.length) return grid.replaceChildren(empty('No matches'));
      grid.replaceChildren(...list.map((v) => {
        const p = progress[v.id];
        return h('div', { class: 'card video-card', tabindex: 0, onClick: () => open(v), onKeydown: (e) => e.key === 'Enter' && open(v) },
          h('div', { class: 'vid-thumb-wrap' }, thumb(v),
            p?.d ? h('div', { class: 'vid-prog' }, h('i', { style: { width: `${Math.min(100, (p.t / p.d) * 100)}%` } })) : null),
          h('div', { class: 'card-body' }, h('b', { class: 'clamp2' }, v.title),
            p?.d ? h('span', { class: 'muted small' }, `${formatTime(p.t)} / ${formatTime(p.d)}`) : null));
      }));
    }

    let saveT;
    function open(v) {
      if (musicPlayer.playing) musicPlayer.toggle(); // don't play two things at once
      // subtitles from another site (R2) only load when the video is fetched with CORS
      const remoteSubs = v.subtitles && /^https?:/.test(v.subtitles) && !v.subtitles.startsWith(location.origin);
      const video = h('video', { class: 'video-el', src: v.src, controls: true, autoplay: true, playsinline: true, preload: 'metadata', crossorigin: remoteSubs ? 'anonymous' : null });
      if (v.subtitles) video.append(h('track', { kind: 'subtitles', src: v.subtitles, srclang: 'en', label: 'Subtitles', default: true }));
      const saved = progress[v.id];
      video.addEventListener('loadedmetadata', () => {
        if (saved && saved.t > 5 && saved.t < video.duration - 10) video.currentTime = saved.t;
      }, { once: true });
      const save = () => {
        progress[v.id] = { t: Math.floor(video.currentTime), d: Math.floor(video.duration || 0) };
        setLocal('videos.progress', progress);
      };
      video.addEventListener('timeupdate', () => { clearTimeout(saveT); saveT = setTimeout(save, 1000); });
      video.addEventListener('pause', save);

      const speed = h('select', { class: 'input sm', title: 'Speed' },
        [0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => h('option', { value: s, selected: s === 1 }, `${s}x`)));
      speed.onchange = () => { video.playbackRate = +speed.value; };
      const autoNext = h('input', { type: 'checkbox', checked: getLocal('videos.autonext', true) });
      autoNext.onchange = () => setLocal('videos.autonext', autoNext.checked);
      const others = videos.filter((x) => x.id !== v.id);
      video.addEventListener('ended', () => {
        delete progress[v.id];
        setLocal('videos.progress', progress);
        if (autoNext.checked) {
          const i = videos.findIndex((x) => x.id === v.id);
          if (videos[i + 1]) open(videos[i + 1]);
        }
      });

      el.replaceChildren(h('div', { class: 'video-page' },
        h('div', { class: 'video-main' },
          h('div', { class: 'row gap' },
            h('button', { class: 'btn sm', onClick: () => { save(); video.pause(); el.replaceChildren(browse); renderGrid(); } }, h('span', { html: icon('back', 16) }), 'Back'),
            h('b', { class: 'grow clamp1' }, v.title)),
          h('div', { class: 'video-box' }, video),
          h('div', { class: 'row gap wrap' },
            h('label', { class: 'row gap small' }, 'Speed', speed),
            h('label', { class: 'row gap small' }, autoNext, 'Autoplay next'))),
        others.length ? h('div', { class: 'video-side' }, h('div', { class: 'muted small list-label' }, 'More videos'),
          ...others.map((o) => h('div', { class: 'side-vid', onClick: () => { save(); open(o); } }, thumb(o), h('span', { class: 'clamp2' }, o.title)))) : null));
    }

    search.addEventListener('input', debounce(() => { query = search.value; renderGrid(); }, 120));
    grid.replaceChildren(spinner());
    getManifest().then((m) => {
      videos = m.videos;
      renderGrid();
      const v = params.play && videos.find((x) => x.id === params.play);
      if (v) open(v);
    });
    return () => {
      clearTimeout(saveT);
      el.querySelector('video')?.pause();
    };
  },
};
