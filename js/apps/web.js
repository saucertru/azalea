// Web: browse websites through the Scramjet proxy, with Chrome extensions
// (Sapphire) shown in a small toolbar.
import { h, icon, empty, spinner } from '../ui.js';
import { on } from '../store.js';
import { proxyAvailable, registerTab, toUrl } from '../proxy.js';
import { renderExtButtons, openManager } from '../extensions.js';

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// The first connection can fail while the Wisp server wakes up (free Render
// servers sleep) or the proxy is still starting: retry quietly for ~60s.
const RETRY_DELAYS = [1000, 2500, 5000, 8000, 12000, 15000, 18000];

export default {
  id: 'web',
  name: 'Web',
  icon: 'globe',
  mount(el, params, ctx) {
    let alive = true;
    const desktop = ctx.layout === 'desktop';
    const offs = [];

    const extButtons = h('div', { class: 'ext-buttons' });
    const extBtn = h('button', { class: 'icon-btn sm', title: 'Extensions', 'aria-label': 'Extensions', html: icon('puzzle', 16), onClick: () => openManager(ctx) });

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
        status,
        h('button', { class: 'btn sm web-ext-link', onClick: () => openManager(ctx) }, h('span', { html: icon('puzzle', 14) }), 'Extensions')));
      proxyAvailable().then((ok) => {
        if (!alive) return;
        status.textContent = ok
          ? 'Sites open through the built-in proxy. Add Chrome extensions like ad blockers with the Extensions button.'
          : 'The web proxy needs the Node server (npm start) or the Pages build. Websites will open in a normal browser tab instead.';
      });
      setTimeout(() => input.focus(), 50);
      return () => { alive = false; };
    }

    // ---- a page
    let tab = null;
    const frame = h('iframe', { class: 'web-frame', title: host(params.url), allow: 'autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture', allowfullscreen: true });
    const urlInput = h('input', { class: 'input sm web-url', value: params.url, spellcheck: 'false' });
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && urlInput.value.trim()) { tab ? tab.go(toUrl(urlInput.value)) : ctx.open('web', { url: toUrl(urlInput.value) }); urlInput.blur(); } });
    urlInput.addEventListener('focus', () => urlInput.select());
    const bar = desktop
      ? h('div', { class: 'web-bar' },
        h('button', { class: 'icon-btn sm', title: 'Back', html: icon('back', 16), onClick: () => tab?.frame.back() }),
        h('button', { class: 'icon-btn sm flip', title: 'Forward', html: icon('back', 16), onClick: () => tab?.frame.forward() }),
        h('button', { class: 'icon-btn sm', title: 'Reload', html: icon('refresh', 15), onClick: () => tab?.frame.reload() }),
        urlInput, extButtons, extBtn)
      : h('div', { class: 'web-bar slim' }, h('span', { class: 'grow' }), extButtons, extBtn);
    bar.addEventListener('pointerdown', () => tab?.activate());

    const loadingText = h('div', { class: 'muted small' }, `Opening ${host(params.url)}…`);
    const loading = h('div', { class: 'web-loading' }, spinner(), loadingText);
    el.classList.add('app-web-page');
    el.append(h('div', { class: 'web-page' }, bar, h('div', { class: 'web-frame-wrap' }, frame, loading)));

    // ---- navigation tracking (address bar, tab title, extensions)
    let lastUrl = '';
    let lastTitle = '';
    const sync = (status) => {
      if (!tab) return;
      const url = tab.url();
      const title = tab.title();
      if (!/^https?:|^chrome-extension:/.test(url)) return;
      if (url === lastUrl && title === lastTitle && !status) return;
      lastUrl = url;
      lastTitle = title;
      if (document.activeElement !== urlInput) urlInput.value = url;
      ctx.webNavigated?.(el, url, title || host(url));
      tab.updated({ status: status || undefined, url, title });
    };
    const poll = setInterval(() => alive && sync(), 1500);

    let navFailed = false;
    let tries = 0;
    frame.addEventListener('load', () => {
      if (!alive) return;
      if (navFailed && tries < RETRY_DELAYS.length) {
        navFailed = false;
        const wait = RETRY_DELAYS[tries++];
        if (!loading.isConnected) frame.parentElement.append(loading);
        loadingText.textContent = tries === 1
          ? 'Connecting to the proxy… (it may be waking up)'
          : `Still connecting… try ${tries + 1} of ${RETRY_DELAYS.length + 1}`;
        setTimeout(() => { if (alive) tab?.frame.reload(); }, wait);
        return;
      }
      if (!navFailed) tries = 0;
      navFailed = false;
      loading.remove();
      sync('complete');
    });

    // the tab becomes "active" for extensions when it's shown or clicked
    offs.push(on('view-activated', (view) => { if (view === el) tab?.activate(); }));
    const onBlur = () => setTimeout(() => { if (document.activeElement === frame) tab?.activate(); }, 0);
    window.addEventListener('blur', onBlur);
    offs.push(() => window.removeEventListener('blur', onBlur));

    const renderExt = () => renderExtButtons(extButtons, () => tab?.id ?? null);
    offs.push(on('extensions', renderExt));

    proxyAvailable().then(async (ok) => {
      if (!alive) return;
      if (!ok) {
        loading.replaceChildren(empty('The web proxy isn’t running here', 'It needs the Node server (npm start) or the Pages build. Opened the site in a new browser tab instead.'));
        window.open(params.url, '_blank', 'noopener');
        return;
      }
      try {
        tab = await registerTab(frame, {
          token: params._t,
          activate: () => ctx.activateView?.(el),
          close: () => ctx.closeView?.(el),
          navError: () => { navFailed = true; },
        });
        if (!alive) { tab.dispose(); return; }
        renderExt();
        tab.go(params.url);
      } catch (e) {
        console.error(e);
        loading.replaceChildren(empty('Couldn’t start the web proxy', e.message || String(e)));
      }
    });

    return () => {
      alive = false;
      clearInterval(poll);
      offs.forEach((f) => f());
      tab?.dispose();
      frame.src = 'about:blank';
    };
  },
};
