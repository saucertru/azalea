// Web: browse websites through the Scramjet proxy.
import { h, icon, empty, spinner, toast } from '../ui.js';
import { proxyAvailable, proxyReady, encode, decode, toUrl } from '../proxy.js';

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export default {
  id: 'web',
  name: 'Web',
  icon: 'globe',
  mount(el, params, ctx) {
    let alive = true;
    const desktop = ctx.layout === 'desktop';

    // ---- start page (no URL yet)
    if (!params.url) {
      const input = h('input', { class: 'home-search-input', placeholder: 'Search or type a website', spellcheck: 'false' });
      const go = () => { if (input.value.trim()) ctx.open('web', { url: toUrl(input.value) }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      const status = h('div', { class: 'muted small web-status' });
      el.append(h('div', { class: 'home2 web-start' },
        h('div', { class: 'web-globe', html: icon('globe', 44) }),
        h('h2', {}, 'Browse the web'),
        h('div', { class: 'home-search' }, h('span', { class: 'hs-ic', html: icon('search', 18) }), input,
          h('button', { class: 'hs-go', 'aria-label': 'Go', html: icon('back', 16), onClick: go })),
        status));
      proxyAvailable().then((ok) => {
        if (!alive) return;
        status.textContent = ok
          ? 'Sites open through the built-in proxy.'
          : 'The web proxy needs the Node server (npm start, e.g. on Render). Websites will open in a normal browser tab instead.';
      });
      setTimeout(() => input.focus(), 50);
      return () => { alive = false; };
    }

    // ---- a page
    const frame = h('iframe', { class: 'web-frame', title: host(params.url), allow: 'autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture', allowfullscreen: true });
    const urlInput = h('input', { class: 'input sm web-url', value: params.url, spellcheck: 'false' });
    const nav = (fn) => { try { fn(frame.contentWindow); } catch {} };
    const bar = desktop
      ? h('div', { class: 'web-bar' },
        h('button', { class: 'icon-btn sm', title: 'Back', html: icon('back', 16), onClick: () => nav((w) => w.history.back()) }),
        h('button', { class: 'icon-btn sm flip', title: 'Forward', html: icon('back', 16), onClick: () => nav((w) => w.history.forward()) }),
        h('button', { class: 'icon-btn sm', title: 'Reload', html: icon('refresh', 15), onClick: () => nav((w) => w.location.reload()) }),
        urlInput)
      : null;
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && urlInput.value.trim()) ctx.open('web', { url: toUrl(urlInput.value) }); });
    urlInput.addEventListener('focus', () => urlInput.select());

    const loading = h('div', { class: 'web-loading' }, spinner(), h('div', { class: 'muted small' }, `Opening ${host(params.url)}…`));
    el.classList.add('app-web-page');
    el.append(h('div', { class: 'web-page' }, bar, h('div', { class: 'web-frame-wrap' }, frame, loading)));

    // keep the address bar / tab title in step as you click around
    frame.addEventListener('load', () => {
      loading.remove();
      let real = null;
      let title = '';
      try {
        real = decode(frame.contentWindow.location.href);
        title = frame.contentDocument?.title || '';
      } catch {}
      if (real && /^https?:/.test(real)) {
        urlInput.value = real;
        ctx.webNavigated?.(el, real, title || host(real));
      }
    });

    proxyAvailable().then(async (ok) => {
      if (!alive) return;
      if (!ok) {
        loading.replaceChildren(empty('The web proxy isn’t running here', 'It needs the Node server (npm start, e.g. on Render). Opened the site in a new browser tab instead.'));
        window.open(params.url, '_blank', 'noopener');
        return;
      }
      try {
        await proxyReady();
        if (!alive) return;
        frame.src = await encode(params.url);
      } catch (e) {
        console.error(e);
        loading.replaceChildren(empty('Couldn’t start the web proxy', e.message || String(e)));
        toast('Web proxy failed to start', 'error');
      }
    });

    return () => {
      alive = false;
      frame.src = 'about:blank';
    };
  },
};
