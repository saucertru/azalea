// Music: local files from /music, YouTube (official embed player) and
// synced lyrics from LRCLIB. The player lives outside the view so music
// keeps playing while you use other apps.
import { CONFIG } from '../config.js';
import { h, icon, esc, formatTime, toast, empty, spinner, debounce } from '../ui.js';
import { getManifest } from '../data.js';
import { getLocal, setLocal } from '../store.js';

// =====================================================================
// Player (singleton)
// =====================================================================
const events = new EventTarget();
const emitP = (type) => events.dispatchEvent(new Event(type));
const onP = (type, fn) => {
  events.addEventListener(type, fn);
  return () => events.removeEventListener(type, fn);
};

const audio = new Audio();
audio.preload = 'metadata';

export const player = {
  queue: [],
  index: -1,
  shuffle: getLocal('music.shuffle', false),
  repeat: getLocal('music.repeat', 'off'), // off | all | one
  volume: getLocal('music.volume', 0.8),
  lyrics: { key: null, status: 'idle', lines: [], plain: '' },
  yt: null,
  ytState: -1,

  get current() { return this.queue[this.index] || null; },
  get playing() {
    const c = this.current;
    if (!c) return false;
    return c.source === 'yt' ? this.ytState === 1 || this.ytState === 3 : !audio.paused;
  },
  get time() {
    const c = this.current;
    if (!c) return 0;
    if (c.source === 'yt') return this.yt?.getCurrentTime?.() || 0;
    return audio.currentTime || 0;
  },
  get duration() {
    const c = this.current;
    if (!c) return 0;
    if (c.source === 'yt') return this.yt?.getDuration?.() || 0;
    return isFinite(audio.duration) ? audio.duration : 0;
  },

  playQueue(list, i = 0) {
    this.queue = list.slice();
    this.index = Math.max(0, Math.min(i, this.queue.length - 1));
    this.load();
  },
  add(track) {
    this.queue.push(track);
    if (this.index < 0) {
      this.index = 0;
      this.load();
    }
    emitP('queue');
  },
  playNext(track) {
    if (this.index < 0) return this.add(track);
    this.queue.splice(this.index + 1, 0, track);
    emitP('queue');
  },
  async load() {
    const t = this.current;
    if (!t) return;
    if (t.source === 'yt') {
      audio.pause();
      await ensureYT();
      showDock(true);
      this.yt.loadVideoById(t.id);
      this.yt.setVolume(Math.round(this.volume * 100));
    } else {
      if (this.yt) this.yt.stopVideo?.();
      showDock(false);
      audio.src = t.src;
      audio.volume = this.volume;
      audio.play().catch(() => {});
    }
    updateMediaSession();
    emitP('track');
    fetchLyrics(t);
  },
  toggle() {
    const t = this.current;
    if (!t) return;
    if (t.source === 'yt') {
      if (this.playing) this.yt.pauseVideo();
      else this.yt.playVideo();
    } else if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  },
  next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') return this.seek(0, true);
    if (this.shuffle && this.queue.length > 1) {
      let n;
      do n = Math.floor(Math.random() * this.queue.length); while (n === this.index);
      this.index = n;
    } else if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === 'all' || !auto) this.index = 0;
    else return emitP('state');
    this.load();
  },
  prev() {
    if (this.time > 3) return this.seek(0);
    if (!this.queue.length) return;
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this.load();
  },
  seek(sec, play = false) {
    const t = this.current;
    if (!t) return;
    if (t.source === 'yt') {
      this.yt?.seekTo(sec, true);
      if (play) this.yt?.playVideo();
    } else {
      audio.currentTime = sec;
      if (play) audio.play().catch(() => {});
    }
    emitP('time');
  },
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    audio.volume = this.volume;
    this.yt?.setVolume?.(Math.round(this.volume * 100));
    setLocal('music.volume', this.volume);
    emitP('volume');
  },
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    setLocal('music.shuffle', this.shuffle);
    emitP('state');
  },
  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    setLocal('music.repeat', this.repeat);
    emitP('state');
  },
  stop() {
    audio.pause();
    audio.removeAttribute('src');
    this.yt?.stopVideo?.();
    showDock(false);
    this.queue = [];
    this.index = -1;
    emitP('track');
  },
};

audio.addEventListener('play', () => emitP('state'));
audio.addEventListener('pause', () => emitP('state'));
audio.addEventListener('timeupdate', () => emitP('time'));
audio.addEventListener('loadedmetadata', () => emitP('time'));
audio.addEventListener('ended', () => player.next(true));
audio.addEventListener('error', () => {
  if (player.current?.source === 'local' && audio.getAttribute('src')) toast(`Could not play ${player.current.title}`, 'error');
});

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = player.current;
  if (!t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '',
      artwork: t.cover ? [{ src: new URL(t.cover, location.href).href }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => player.toggle());
    navigator.mediaSession.setActionHandler('pause', () => player.toggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => player.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => player.prev());
  } catch {}
}

// ---------- YouTube dock (the official player must stay visible) ----------
let ytReady = null;
let dock = null;
let ytTimer = null;

function ensureYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    dock = h('div', { id: 'yt-dock', class: 'hidden' },
      h('div', { class: 'yt-dock-head' },
        h('span', { class: 'yt-dock-title' }, 'YouTube'),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Stop', html: icon('close', 14), onClick: () => player.stop() })),
      h('div', { class: 'yt-dock-body' }, h('div', { id: 'yt-player' })));
    document.body.append(dock);
    const create = () => {
      player.yt = new window.YT.Player('yt-player', {
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => {
            player.ytState = e.data;
            if (e.data === 0) player.next(true);
            clearInterval(ytTimer);
            if (e.data === 1) ytTimer = setInterval(() => emitP('time'), 400);
            emitP('state');
          },
          onError: () => {
            toast('That YouTube video can’t be played here (embedding disabled). Skipping.', 'error');
            setTimeout(() => player.next(true), 800);
          },
        },
      });
    };
    if (window.YT?.Player) create();
    else {
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prevCb?.(); create(); };
      const s = h('script', { src: 'https://www.youtube.com/iframe_api' });
      s.onerror = () => { ytReady = null; dock.remove(); reject(new Error('YouTube blocked')); toast('Could not load YouTube', 'error'); };
      document.head.append(s);
    }
  });
  return ytReady;
}

function showDock(show) {
  if (!dock) return;
  dock.classList.toggle('hidden', !show);
  const t = player.current;
  if (show && t) dock.querySelector('.yt-dock-title').textContent = t.title;
}

// =====================================================================
// Lyrics (LRCLIB)
// =====================================================================
function cleanTitle(s) {
  return s
    .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyrics?|visuali[sz]er|hd|4k|mv|remaster(ed)?|live)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*(ft\.?|feat\.?)\s.*$/i, '')
    .replace(/\s*\|.*$/, '')
    .trim();
}

function guessArtistTitle(t) {
  if (t.source !== 'yt' || t.artist?.trim() && !/ - Topic$|VEVO$/i.test(t.artist) && !t.title.includes(' - ')) {
    return { artist: (t.artist || '').replace(/ - Topic$/i, '').replace(/VEVO$/i, ''), title: cleanTitle(t.title) };
  }
  const parts = t.title.split(/\s+[-–—]\s+/);
  if (parts.length > 1) return { artist: cleanTitle(parts[0]), title: cleanTitle(parts.slice(1).join(' - ')) };
  return { artist: (t.artist || '').replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim(), title: cleanTitle(t.title) };
}

function parseLrc(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: +m[1] * 60 + +m[2], text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

async function fetchLyrics(track) {
  const key = `${track.source}:${track.id}`;
  player.lyrics = { key, status: 'loading', lines: [], plain: '' };
  emitP('lyrics');
  const { artist, title } = guessArtistTitle(track);
  const tries = [];
  if (artist) tries.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`);
  tries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}`);
  try {
    let best = null;
    for (const url of tries) {
      const r = await fetch(url);
      if (!r.ok) continue;
      const list = await r.json();
      best = list.find((x) => x.syncedLyrics) || list.find((x) => x.plainLyrics) || null;
      if (best) break;
    }
    if (player.lyrics.key !== key) return; // track changed meanwhile
    if (!best) player.lyrics = { key, status: 'none', lines: [], plain: '' };
    else if (best.instrumental) player.lyrics = { key, status: 'instrumental', lines: [], plain: '' };
    else player.lyrics = { key, status: 'ok', lines: best.syncedLyrics ? parseLrc(best.syncedLyrics) : [], plain: best.plainLyrics || '' };
  } catch {
    if (player.lyrics.key === key) player.lyrics = { key, status: 'error', lines: [], plain: '' };
  }
  emitP('lyrics');
}

// =====================================================================
// Mini player (topbar / taskbar)
// =====================================================================
export function mountMini(el, ctx, { pill = false } = {}) {
  if (pill) {
    // compact always-visible pill: ♪ title  ⏮ ▶ ⏭
    const renderPill = () => {
      const t = player.current;
      el.replaceChildren(
        h('button', { class: 'pill-info', title: 'Open music', onClick: () => ctx.open('music') },
          h('span', { html: icon('music', 14) }),
          h('span', { class: 'pill-text' }, t ? `${t.title}${t.artist ? ` · ${t.artist}` : ''}` : 'Nothing playing')),
        h('button', { class: 'pill-btn', 'aria-label': 'Previous', html: icon('prev', 12), onClick: () => player.prev() }),
        h('button', { class: 'pill-btn', 'aria-label': 'Play/pause', html: icon(player.playing ? 'pause' : 'play', 12), onClick: () => (t ? player.toggle() : ctx.open('music')) }),
        h('button', { class: 'pill-btn', 'aria-label': 'Next', html: icon('next', 12), onClick: () => player.next() }));
    };
    renderPill();
    const offs = [onP('track', renderPill), onP('state', renderPill)];
    return () => offs.forEach((f) => f());
  }
  const render = () => {
    const t = player.current;
    el.classList.toggle('hidden', !t);
    if (!t) return el.replaceChildren();
    el.replaceChildren(
      h('button', { class: 'mini-info', title: 'Open music', onClick: () => ctx.open('music') },
        t.cover ? h('img', { src: t.cover, alt: '' }) : h('span', { class: 'mini-art', html: icon(t.source === 'yt' ? 'youtube' : 'music', 16) }),
        h('span', { class: 'mini-text' }, h('b', {}, t.title), t.artist ? h('span', {}, t.artist) : null)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Previous', html: icon('prev', 16), onClick: () => player.prev() }),
      h('button', { class: 'icon-btn sm accent', 'aria-label': 'Play/pause', html: icon(player.playing ? 'pause' : 'play', 16), onClick: () => player.toggle() }),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Next', html: icon('next', 16), onClick: () => player.next() }),
      h('div', { class: 'mini-progress' }, h('i', { style: { width: `${player.duration ? (player.time / player.duration) * 100 : 0}%` } })));
  };
  const prog = () => {
    const bar = el.querySelector('.mini-progress i');
    if (bar) bar.style.width = `${player.duration ? (player.time / player.duration) * 100 : 0}%`;
  };
  render();
  const offs = [onP('track', render), onP('state', render), onP('time', prog)];
  return () => offs.forEach((f) => f());
}

// =====================================================================
// Music app view
// =====================================================================
function ytId(input) {
  const s = input.trim();
  const m = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}

function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

function ytTrack(id, title = 'YouTube video', channel = '', thumb = null) {
  return { source: 'yt', id, title, artist: channel, cover: thumb || `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
}

async function ytOembedTitle(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title, channel: j.author_name };
  } catch {
    return null;
  }
}

export default {
  id: 'music',
  name: 'Music',
  icon: 'music',
  mount(el, params, ctx) {
    let tab = params.tab === 'youtube' ? 'youtube' : 'library';
    let side = 'lyrics';
    let library = [];
    let ytResults = getLocal('music.ytRecent', []);

    const listPane = h('div', { class: 'music-list' });
    const nowPane = h('div', { class: 'music-now' });
    const tabs = h('div', { class: 'seg' });
    el.append(
      h('div', { class: 'music-layout' },
        h('div', { class: 'music-left' }, tabs, listPane),
        nowPane));

    function renderTabs() {
      tabs.replaceChildren(
        h('button', { class: tab === 'library' ? 'on' : '', onClick: () => { tab = 'library'; renderTabs(); renderList(); } }, h('span', { html: icon('folder', 16) }), 'Library'),
        h('button', { class: tab === 'youtube' ? 'on' : '', onClick: () => { tab = 'youtube'; renderTabs(); renderList(); } }, h('span', { html: icon('youtube', 16) }), 'YouTube'));
    }

    const trackRow = (t, i, onPlay, extra) => {
      const cur = player.current;
      const active = cur && cur.source === t.source && cur.id === t.id;
      return h('div', { class: `track${active ? ' active' : ''}`, onClick: onPlay },
        t.cover ? h('img', { class: 'track-art', src: t.cover, alt: '', loading: 'lazy' }) : h('span', { class: 'track-art ph', html: icon('music', 16) }),
        h('div', { class: 'track-text' }, h('b', {}, t.title), h('span', {}, t.artist || '')),
        extra || h('span', { class: 'track-num' }, active && player.playing ? '▶' : String(i + 1)));
    };

    let libQuery = '';
    function renderLibrary() {
      const search = h('input', { class: 'input', placeholder: 'Search your music', value: libQuery });
      const list = h('div', { class: 'tracks' });
      const draw = () => {
        const q = libQuery.toLowerCase();
        const items = library.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q));
        if (!library.length) list.replaceChildren(empty('No music yet', 'Drop audio files into the /music folder, named "Artist - Title.mp3".'));
        else if (!items.length) list.replaceChildren(empty('No matches'));
        else list.replaceChildren(...items.map((t, i) => trackRow(t, i, () => player.playQueue(items, i))));
      };
      search.oninput = debounce(() => { libQuery = search.value; draw(); }, 150);
      draw();
      const playAll = h('button', { class: 'btn primary sm', disabled: !library.length, onClick: () => player.playQueue(library, 0) }, h('span', { html: icon('play', 14) }), 'Play all');
      const shuffleAll = h('button', { class: 'btn sm', disabled: !library.length, onClick: () => { if (!player.shuffle) player.toggleShuffle(); player.playQueue(library, Math.floor(Math.random() * library.length)); } }, h('span', { html: icon('shuffle', 14) }), 'Shuffle');
      listPane.replaceChildren(h('div', { class: 'row gap' }, search, playAll, shuffleAll), list);
    }

    function renderYouTube() {
      const hasKey = Boolean(CONFIG.youtubeApiKey);
      const input = h('input', { class: 'input', placeholder: hasKey ? 'Search YouTube or paste a link' : 'Paste a YouTube link' });
      const out = h('div', { class: 'tracks' });
      const remember = (t) => {
        ytResults = [t, ...ytResults.filter((x) => x.id !== t.id)].slice(0, 30);
        setLocal('music.ytRecent', ytResults);
      };
      const showResults = (items, label, isSearch = false) => {
        if (!items.length) { out.replaceChildren(empty(label || 'Nothing here yet', hasKey ? 'Search for a song or paste a link.' : 'Paste a YouTube link to play it. Add a YouTube API key in js/config.js to turn on search.')); return; }
        out.replaceChildren(
          label ? h('div', { class: 'muted small list-label' }, label) : '',
          ...items.map((t, i) => trackRow(t, i, () => { if (isSearch) remember(t); player.playQueue(items, i); },
            h('button', { class: 'icon-btn sm', title: 'Add to queue', html: icon('plus', 16), onClick: (e) => { e.stopPropagation(); if (isSearch) remember(t); player.add(t); toast('Added to queue'); } }))));
      };
      const go = async () => {
        const v = input.value.trim();
        if (!v) return;
        const id = ytId(v);
        if (id) {
          const meta = await ytOembedTitle(id);
          const t = ytTrack(id, meta?.title, meta?.channel);
          remember(t);
          player.playQueue([t], 0);
          input.value = '';
          showResults(ytResults, 'Recently played');
          return;
        }
        if (!hasKey) { toast('Paste a full YouTube link (search needs an API key in config.js)', 'error'); return; }
        out.replaceChildren(spinner());
        try {
          const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=20&q=${encodeURIComponent(v)}&key=${CONFIG.youtubeApiKey}`);
          const j = await r.json();
          if (j.error) throw new Error(j.error.message);
          const items = j.items.map((it) => ytTrack(it.id.videoId, decodeEntities(it.snippet.title), decodeEntities(it.snippet.channelTitle), it.snippet.thumbnails?.medium?.url));
          showResults(items, `Results for “${v}”`, true);
        } catch (e) {
          out.replaceChildren(empty('Search failed', e.message));
        }
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      showResults(ytResults, ytResults.length ? 'Recently played' : '');
      listPane.replaceChildren(
        h('div', { class: 'row gap' }, input, h('button', { class: 'btn primary', onClick: go }, h('span', { html: icon(hasKey ? 'search' : 'play', 16) }), hasKey ? 'Search' : 'Play')),
        out);
    }

    function renderList() {
      if (tab === 'library') renderLibrary();
      else renderYouTube();
    }

    // ---------- now playing ----------
    const seek = h('input', { type: 'range', class: 'range', min: 0, max: 1000, value: 0 });
    const tCur = h('span', { class: 'small muted' }, '0:00');
    const tDur = h('span', { class: 'small muted' }, '0:00');
    let seeking = false;
    seek.addEventListener('input', () => { seeking = true; tCur.textContent = formatTime((seek.value / 1000) * player.duration); });
    seek.addEventListener('change', () => { player.seek((seek.value / 1000) * player.duration); seeking = false; });
    const vol = h('input', { type: 'range', class: 'range vol', min: 0, max: 100, value: Math.round(player.volume * 100), 'aria-label': 'Volume' });
    vol.oninput = () => player.setVolume(vol.value / 100);
    const lyricsBox = h('div', { class: 'lyrics' });
    const art = h('div', { class: 'now-art' });
    const meta = h('div', { class: 'now-meta' });
    const ctrls = h('div', { class: 'now-ctrls' });
    const sideTabs = h('div', { class: 'seg sm' });

    function renderNow() {
      const t = player.current;
      art.replaceChildren(t?.cover ? h('img', { src: t.cover, alt: '' }) : h('span', { html: icon('music', 48) }));
      meta.replaceChildren(h('b', {}, t ? t.title : 'Nothing playing'), h('span', { class: 'muted' }, t ? t.artist || (t.source === 'yt' ? 'YouTube' : '') : 'Pick a song to start'));
      renderCtrls();
      renderSideTabs();
      renderSide();
      updateTime();
    }

    function renderSideTabs() {
      sideTabs.replaceChildren(
        h('button', { class: side === 'lyrics' ? 'on' : '', onClick: () => { side = 'lyrics'; renderSideTabs(); renderSide(); updateTime(); } }, 'Lyrics'),
        h('button', { class: side === 'queue' ? 'on' : '', onClick: () => { side = 'queue'; renderSideTabs(); renderSide(); } }, `Queue (${player.queue.length})`));
    }

    function renderCtrls() {
      ctrls.replaceChildren(
        h('button', { class: `icon-btn${player.shuffle ? ' on' : ''}`, title: 'Shuffle', html: icon('shuffle', 18), onClick: () => player.toggleShuffle() }),
        h('button', { class: 'icon-btn', title: 'Previous', html: icon('prev', 20), onClick: () => player.prev() }),
        h('button', { class: 'play-big', title: 'Play/pause', html: icon(player.playing ? 'pause' : 'play', 24), onClick: () => player.toggle() }),
        h('button', { class: 'icon-btn', title: 'Next', html: icon('next', 20), onClick: () => player.next() }),
        h('button', { class: `icon-btn${player.repeat !== 'off' ? ' on' : ''}`, title: `Repeat: ${player.repeat}`, onClick: () => player.cycleRepeat(), html: icon('repeat', 18) + (player.repeat === 'one' ? '<small class="rep1">1</small>' : '') }));
    }

    let lastLine = -1;
    function renderSide() {
      lastLine = -1;
      if (side === 'queue') {
        lyricsBox.className = 'lyrics queue';
        lyricsBox.replaceChildren(...(player.queue.length
          ? player.queue.map((t, i) => trackRow(t, i, () => { player.index = i; player.load(); },
            h('button', { class: 'icon-btn sm', title: 'Remove', html: icon('close', 14), onClick: (e) => {
              e.stopPropagation();
              player.queue.splice(i, 1);
              if (i < player.index) player.index--;
              else if (i === player.index) { if (player.queue.length) { player.index = Math.min(i, player.queue.length - 1); player.load(); } else player.stop(); }
              renderSideTabs();
              renderSide();
            } })))
          : [empty('Queue is empty')]));
        return;
      }
      lyricsBox.className = 'lyrics';
      const L = player.lyrics;
      if (!player.current) return lyricsBox.replaceChildren(empty('Lyrics show up here'));
      if (L.status === 'loading') return lyricsBox.replaceChildren(spinner());
      if (L.status === 'instrumental') return lyricsBox.replaceChildren(empty('Instrumental'));
      if (L.status !== 'ok') return lyricsBox.replaceChildren(empty('No lyrics found', 'Lyrics come from LRCLIB. Name files "Artist - Title" for better matches.'));
      if (L.lines.length) {
        lyricsBox.replaceChildren(...L.lines.map((l) => h('p', { class: 'lline', onClick: () => player.seek(l.t, true) }, l.text || '♪')));
      } else {
        lyricsBox.replaceChildren(h('div', { class: 'muted small list-label' }, 'Not synced'), ...L.plain.split('\n').map((s) => h('p', { class: 'lline plain' }, s || ' ')));
      }
    }

    function updateTime() {
      const d = player.duration, t = player.time;
      if (!seeking) {
        seek.value = d ? Math.round((t / d) * 1000) : 0;
        tCur.textContent = formatTime(t);
      }
      tDur.textContent = formatTime(d);
      const L = player.lyrics;
      if (side === 'lyrics' && L.status === 'ok' && L.lines.length) {
        let idx = -1;
        for (let i = 0; i < L.lines.length; i++) { if (L.lines[i].t <= t + 0.25) idx = i; else break; }
        if (idx !== lastLine) {
          const ps = lyricsBox.querySelectorAll('.lline');
          ps[lastLine]?.classList.remove('on');
          if (ps[idx]) {
            ps[idx].classList.add('on');
            const box = lyricsBox;
            const top = ps[idx].offsetTop - box.clientHeight / 2 + ps[idx].clientHeight / 2;
            box.scrollTo({ top, behavior: 'smooth' });
          }
          lastLine = idx;
        }
      }
    }

    nowPane.append(art, meta,
      h('div', { class: 'seek-row' }, tCur, seek, tDur),
      ctrls,
      h('div', { class: 'vol-row' }, h('span', { html: icon('volume', 16) }), vol),
      sideTabs, lyricsBox);

    const refreshListActive = debounce(() => renderList(), 50);
    const offs = [
      onP('track', () => { renderNow(); refreshListActive(); }),
      onP('state', () => { renderCtrls(); refreshListActive(); }),
      onP('time', updateTime),
      onP('lyrics', () => side === 'lyrics' && renderSide()),
      onP('queue', () => { renderSideTabs(); if (side === 'queue') renderSide(); }),
      onP('volume', () => { vol.value = Math.round(player.volume * 100); }),
    ];

    renderTabs();
    listPane.replaceChildren(spinner());
    renderNow();
    getManifest().then((m) => {
      library = m.music.map((t) => ({ ...t, source: 'local' }));
      renderList();
      if (params.play) {
        const i = library.findIndex((t) => t.id === params.play);
        if (i >= 0) player.playQueue(library, i);
      }
    });

    return () => offs.forEach((f) => f());
  },
};
