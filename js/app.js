import { CONFIG } from './config.js';
import { h, $, icon, toast, avatarEl, esc } from './ui.js';
import { settings, saveSettings, on } from './store.js';
import { applyTheme, THEMES } from './themes.js';
import { session, initAuth, signUp, signIn, signOut, validUsername, usernameAvailable } from './auth.js';
import { configured, sb } from './supabase.js';
import { APPS, APP_ORDER } from './apps/index.js';
import { mountMini } from './apps/music.js';
import { APP_COLORS, appTile, findApp, searchAll, webSearch, openGame, LOGO_SVG } from './appmeta.js';
import { startPresence } from './presence.js';
import { looksLikeUrl, wakeWisp } from './proxy.js';
import { mountClock, mountWeather, mountSystem } from './widgets.js';

const appRoot = $('#app');
document.title = CONFIG.siteName;

// =====================================================================
// Boot
// =====================================================================
async function boot() {
  applyTheme();
  wakeWisp();
  try {
    await initAuth();
  } catch (e) {
    console.error(e);
    toast('Could not reach the account server', 'error');
  }
  $('#boot')?.remove();
  if (!session.user) showOnboarding(0);
  else if (!settings.onboarded) showOnboarding(1);
  else startShell();
}

on('auth', () => {
  if (!session.user) location.reload(); // signed out (here or in another tab)
});

// =====================================================================
// Onboarding: 1) account  2) theme + accent  3) browser or desktop look
// =====================================================================
const ACCENTS = ['#7c8cff', '#22d3ee', '#4ade80', '#facc15', '#fb923c', '#f43f5e', '#ec4899', '#c084fc', '#14b8a6', '#e4e4e7'];

function showOnboarding(startStep) {
  teardownShell();
  const draft = { theme: settings.theme, accent: settings.accent, layout: settings.layout };
  let step = startStep;
  let mode = 'signup';
  const root = h('div', { class: 'onboard' });
  appRoot.replaceChildren(root);

  const dots = () => h('div', { class: 'ob-dots' }, [0, 1, 2].map((i) => h('span', { class: i === step ? 'on' : i < step ? 'done' : '' })));

  function finish() {
    saveSettings({ ...draft, onboarded: true });
    applyTheme();
    startShell();
    toast(`Welcome${session.profile?.username ? `, ${session.profile.username}` : ''}!`, 'success');
  }

  function afterAccount() {
    // Already set up on this account/browser? go straight in.
    if (settings.onboarded) {
      applyTheme();
      startShell();
      return;
    }
    Object.assign(draft, { theme: settings.theme, accent: settings.accent, layout: settings.layout });
    step = 1;
    render();
  }

  function accountStep() {
    const err = h('div', { class: 'form-error' });
    const busy = (b, btn) => { btn.disabled = b; btn.textContent = b ? 'Please wait…' : btn.dataset.label; };

    if (session.offline) {
      const user = h('input', { class: 'input', placeholder: 'Username', maxlength: 20, autocomplete: 'username' });
      const go = h('button', { class: 'btn primary block', 'data-label': 'Continue' }, 'Continue');
      const submit = () => {
        const u = user.value.trim();
        if (!validUsername(u)) { err.textContent = 'Username: 3-20 letters, numbers or _'; return; }
        signUp({ username: u }).then(afterAccount);
      };
      go.onclick = submit;
      user.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      return h('div', { class: 'ob-card' },
        dots(),
        h('h1', {}, `Welcome to ${CONFIG.siteName}`),
        h('div', { class: 'notice warn' },
          h('b', {}, 'Setup mode: '),
          configured ? 'the account server could not be loaded.' : 'add your Supabase URL and anon key in js/config.js to turn on real accounts and chat.',
          ' For now your profile is saved in this browser only.'),
        h('label', { class: 'field' }, h('span', {}, 'Username'), user),
        err, go);
    }

    const tabs = h('div', { class: 'seg' },
      h('button', { class: mode === 'signup' ? 'on' : '', onClick: () => { mode = 'signup'; render(); } }, 'Create account'),
      h('button', { class: mode === 'login' ? 'on' : '', onClick: () => { mode = 'login'; render(); } }, 'Log in'));

    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: mode === 'signup' ? 'At least 6 characters' : 'Password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });

    if (mode === 'login') {
      const go = h('button', { class: 'btn primary block', 'data-label': 'Log in' }, 'Log in');
      const submit = async () => {
        err.textContent = '';
        busy(true, go);
        try {
          await signIn({ email: email.value.trim(), password: pass.value });
          afterAccount();
        } catch (e) {
          err.textContent = e.message === 'Email not confirmed' ? 'Check your email and confirm your account first.' : friendlyError(e, 'Could not log in');
          busy(false, go);
        }
      };
      go.onclick = submit;
      pass.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      const forgot = h('button', { class: 'link-btn', onClick: async () => {
        if (!email.value.trim()) { err.textContent = 'Type your email above first.'; return; }
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
        toast(error ? error.message : 'Password reset email sent', error ? 'error' : 'success');
      } }, 'Forgot password?');
      return h('div', { class: 'ob-card' }, dots(), h('h1', {}, 'Welcome back'), tabs,
        h('label', { class: 'field' }, h('span', {}, 'Email'), email),
        h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
        err, go, forgot);
    }

    const user = h('input', { class: 'input', placeholder: 'Pick a username', maxlength: 20, autocomplete: 'username' });
    const hint = h('div', { class: 'hint' }, '3-20 letters, numbers or _');
    let checkT;
    user.oninput = () => {
      clearTimeout(checkT);
      const u = user.value.trim();
      if (!u) { hint.textContent = '3-20 letters, numbers or _'; hint.className = 'hint'; return; }
      if (!validUsername(u)) { hint.textContent = 'Only letters, numbers and _ (3-20)'; hint.className = 'hint bad'; return; }
      hint.textContent = 'Checking…'; hint.className = 'hint';
      checkT = setTimeout(async () => {
        const ok = await usernameAvailable(u);
        if (user.value.trim() !== u) return;
        hint.textContent = ok ? 'Available' : 'Taken';
        hint.className = `hint ${ok ? 'good' : 'bad'}`;
      }, 400);
    };
    const go = h('button', { class: 'btn primary block', 'data-label': 'Create account' }, 'Create account');
    const submit = async () => {
      err.textContent = '';
      const u = user.value.trim();
      if (!validUsername(u)) { err.textContent = 'Username: 3-20 letters, numbers or _'; return; }
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { err.textContent = 'Enter a valid email'; return; }
      if (pass.value.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
      busy(true, go);
      try {
        if (!(await usernameAvailable(u))) throw new Error('That username is taken');
        const r = await signUp({ email: email.value.trim(), password: pass.value, username: u });
        if (r.needsConfirm) {
          mode = 'login';
          render();
          toast('Account made! Check your email to confirm it, then log in.', 'success', 7000);
          return;
        }
        afterAccount();
      } catch (e) {
        err.textContent = /already registered/i.test(e.message) ? 'That email already has an account. Log in instead.' : friendlyError(e, 'Could not sign up');
        busy(false, go);
      }
    };
    go.onclick = submit;
    pass.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    return h('div', { class: 'ob-card' }, dots(), h('h1', {}, `Welcome to ${CONFIG.siteName}`), tabs,
      h('label', { class: 'field' }, h('span', {}, 'Username'), user, hint),
      h('label', { class: 'field' }, h('span', {}, 'Email'), email),
      h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
      err, go);
  }

  function themeStep() {
    const preview = () => applyTheme(draft);
    preview();
    const grid = h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, t]) =>
      h('button', {
        class: `theme-swatch${draft.theme === id ? ' on' : ''}`,
        onClick: () => { draft.theme = id; render(); },
      },
      h('div', { class: 'sw', style: { background: t.bg } },
        h('i', { style: { background: t.panel } }), h('i', { style: { background: draft.accent || t.accent } })),
      h('span', {}, t.name))));
    const custom = h('input', { type: 'color', class: 'color-input', value: draft.accent || THEMES[draft.theme].accent, title: 'Custom colour' });
    custom.oninput = () => { draft.accent = custom.value; preview(); $$sel('.accent-dot.on', root).forEach((d) => d.classList.remove('on')); };
    const accents = h('div', { class: 'accent-row' },
      h('button', { class: `accent-dot def${!draft.accent ? ' on' : ''}`, title: 'Theme default', onClick: () => { draft.accent = null; render(); } }, 'A'),
      ACCENTS.map((c) => h('button', {
        class: `accent-dot${draft.accent === c ? ' on' : ''}`, style: { background: c }, title: c,
        onClick: () => { draft.accent = c; render(); },
      })),
      custom);
    return h('div', { class: 'ob-card wide' }, dots(), h('h1', {}, 'Pick a theme'),
      grid,
      h('h3', { class: 'ob-sub' }, 'Accent colour'), accents,
      h('div', { class: 'ob-nav' },
        h('span'),
        h('button', { class: 'btn primary', onClick: () => { step = 2; render(); } }, 'Next')));
  }

  function layoutStep() {
    const card = (id, title, desc, mock) => h('button', {
      class: `layout-card${draft.layout === id ? ' on' : ''}`,
      onClick: () => { draft.layout = id; render(); },
    }, mock, h('b', {}, title), h('span', { class: 'muted small' }, desc));
    const browserMock = h('div', { class: 'mock mock-browser' }, h('div', { class: 'mb-side' }), h('div', { class: 'mb-main' }, h('i'), h('i'), h('i'), h('i')));
    const desktopMock = h('div', { class: 'mock mock-desktop' }, h('div', { class: 'md-icons' }, h('i'), h('i'), h('i')), h('div', { class: 'md-win' }), h('div', { class: 'md-bar' }));
    return h('div', { class: 'ob-card wide' }, dots(), h('h1', {}, 'Choose your look'),
      h('div', { class: 'layout-grid' },
        card('browser', 'Browser page', 'A normal website with a sidebar', browserMock),
        card('desktop', 'Desktop', 'Windows, icons and a taskbar', desktopMock)),
      h('div', { class: 'ob-nav' },
        h('button', { class: 'btn', onClick: () => { step = 1; render(); } }, 'Back'),
        h('button', { class: 'btn primary', onClick: finish }, 'Finish')));
  }

  function render() {
    const card = step === 0 ? accountStep() : step === 1 ? themeStep() : layoutStep();
    root.replaceChildren(h('div', { class: 'ob-brand' }, h('img', { class: 'brand-icon', src: 'assets/icon.png', alt: '' }), CONFIG.siteName), card);
    card.querySelector('input')?.focus();
  }
  render();
}
const $$sel = (s, r) => [...r.querySelectorAll(s)];

function friendlyError(e, fallback) {
  const m = e?.message || '';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Can’t reach the account server. Check your internet, or the Supabase URL in js/config.js.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/rate limit/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  return m || fallback;
}

// =====================================================================
// Shell
// =====================================================================
let shell = null; // { layout, cleanup() }
let browserNav = null; // set by the browser layout

const ctx = {
  get layout() { return settings.layout; },
  open(appId, params = {}) {
    if (!APPS[appId]) return;
    if (settings.layout === 'desktop') wm.open(appId, params);
    else if (browserNav) browserNav(appId, params);
    else location.hash = `#/${appId}${toQuery(params)}`;
  },
  /** Desktop: opens a URL in its own window and returns true. Browser: returns false. */
  openFrame(title, url, opts = {}) {
    if (settings.layout !== 'desktop') return false;
    wm.frame(title, url, opts);
    return true;
  },
};

function toQuery(params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return q ? `?${q}` : '';
}

function mountApp(appId, el, params) {
  const app = APPS[appId];
  el.replaceChildren();
  el.className = `app-view app-${appId}`;
  try {
    const cleanup = app.mount(el, params, ctx);
    return typeof cleanup === 'function' ? cleanup : () => {};
  } catch (e) {
    console.error(e);
    el.replaceChildren(h('div', { class: 'empty' }, `Something went wrong opening ${app.name}.`));
    return () => {};
  }
}

function teardownShell() {
  shell?.cleanup();
  shell = null;
}

function startShell() {
  teardownShell();
  document.body.classList.toggle('layout-desktop', settings.layout === 'desktop');
  shell = settings.layout === 'desktop' ? buildDesktop() : buildBrowser();
  startPresence();
}

let lastLayout = settings.layout;
on('settings', (s) => {
  applyTheme();
  if (shell && s.layout !== lastLayout) {
    lastLayout = s.layout;
    startShell();
  }
});

// ---------------------------------------------------------------------
// Browser layout
// ---------------------------------------------------------------------
function buildBrowser() {
  const scheme = `${CONFIG.siteName.toLowerCase().replace(/[^a-z0-9]/g, '')}://`;
  const RAIL_APPS = ['web', 'games', 'music', 'videos', 'pdfs', 'books', 'tv', 'ai', 'chat'];

  // ---- left icon rail
  const railBtn = (id) => h('button', { class: 'rail-btn', title: APPS[id].name, 'aria-label': APPS[id].name, dataset: { app: id }, html: icon(APPS[id].icon, 19), onClick: () => nav(id) });
  const rail = h('nav', { class: 'rail' },
    railBtn('home'),
    h('div', { class: 'rail-apps' }, RAIL_APPS.map(railBtn)),
    h('div', { class: 'rail-bottom' }, railBtn('profile'), railBtn('settings')));

  // ---- tab strip + toolbar
  const tabsEl = h('div', { class: 'tabs' });
  const newTabBtn = h('button', { class: 'tab-new', title: 'New tab', 'aria-label': 'New tab', html: icon('plus', 16), onClick: () => newTab('home') });
  const backBtn = h('button', { class: 'tb-btn', title: 'Back', 'aria-label': 'Back', html: icon('back', 17), onClick: () => go(-1) });
  const fwdBtn = h('button', { class: 'tb-btn flip', title: 'Forward', 'aria-label': 'Forward', html: icon('back', 17), onClick: () => go(1) });
  const reloadBtn = h('button', { class: 'tb-btn', title: 'Reload', 'aria-label': 'Reload', html: icon('refresh', 16), onClick: () => active && navigate(active, active.appId, active.params, false) });
  const address = h('input', { class: 'address-input', spellcheck: 'false', 'aria-label': 'Address' });
  const pill = h('div', { class: 'music-pill' });
  const fsBtn = h('button', { class: 'tb-btn', title: 'Fullscreen', 'aria-label': 'Fullscreen', html: icon('fullscreen', 16), onClick: () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  } });
  const content = h('div', { class: 'browser-content' });
  const root = h('div', { class: 'shell browser' }, rail,
    h('div', { class: 'chrome' },
      h('div', { class: 'tabstrip' }, tabsEl, newTabBtn),
      h('div', { class: 'toolbar-row' }, backBtn, fwdBtn, reloadBtn,
        h('label', { class: 'address' }, h('span', { class: 'addr-lock', html: icon('lock', 13) }), address),
        pill, fsBtn),
      content));
  appRoot.replaceChildren(root);
  const unMini = mountMini(pill, ctx, { pill: true });

  // ---- tabs
  const tabs = [];
  let active = null;
  let seq = 0;

  function routeOf(tab) { return `${tab.appId}${toQuery(tab.params)}`; }
  // web tabs show the real website address
  function displayUrl(tab) { return tab.appId === 'web' && tab.params.url ? tab.params.url : `${scheme}${routeOf(tab)}`; }
  function webLabel(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Web'; } }

  // the Web app reports where the page went after clicking links
  ctx.webNavigated = (view, url, title) => {
    const t = tabs.find((x) => x.view === view);
    if (!t || t.appId !== 'web') return;
    t.params = { url };
    t.hist[t.hi] = { appId: 'web', params: { url } };
    t.label.textContent = title || webLabel(url);
    t.el.title = title || url;
    if (t === active) updateChrome();
  };

  function newTab(appId = 'home', params = {}) {
    const view = h('div', { class: 'app-view' });
    const pane = h('div', { class: 'tab-pane' }, view);
    content.append(pane);
    const tab = { id: ++seq, appId: null, params: {}, hist: [], hi: -1, view, pane, cleanup: () => {} };
    tab.icon = h('span', { class: 'tab-icon' });
    tab.label = h('span', { class: 'tab-label' });
    tab.el = h('div', { class: 'tab', role: 'tab', title: '', onClick: () => activate(tab), onAuxclick: (e) => e.button === 1 && closeTab(tab) },
      tab.icon, tab.label,
      h('button', { class: 'tab-close', 'aria-label': 'Close tab', html: icon('close', 12), onClick: (e) => { e.stopPropagation(); closeTab(tab); } }));
    tabsEl.append(tab.el);
    tabs.push(tab);
    activate(tab);
    navigate(tab, appId, params, true);
    return tab;
  }

  function navigate(tab, appId, params = {}, push = true) {
    if (!APPS[appId]) appId = 'home';
    if (push) {
      tab.hist = tab.hist.slice(0, tab.hi + 1);
      tab.hist.push({ appId, params });
      if (tab.hist.length > 50) tab.hist.shift();
      tab.hi = tab.hist.length - 1;
    }
    tab.cleanup();
    tab.appId = appId;
    tab.params = params;
    tab.icon.innerHTML = icon(APPS[appId].icon, 14);
    tab.label.textContent = appId === 'web' && params.url ? webLabel(params.url) : APPS[appId].name;
    tab.el.title = appId === 'web' && params.url ? params.url : APPS[appId].name;
    tab.view.scrollTop = 0;
    tab.cleanup = mountApp(appId, tab.view, params);
    if (tab === active) updateChrome();
  }

  function go(delta) {
    if (!active) return;
    const i = active.hi + delta;
    if (i < 0 || i >= active.hist.length) return;
    active.hi = i;
    const { appId, params } = active.hist[i];
    navigate(active, appId, params, false);
  }

  function activate(tab) {
    active = tab;
    for (const t of tabs) {
      t.pane.hidden = t !== tab;
      t.el.classList.toggle('active', t === tab);
    }
    tab.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (tab.appId) updateChrome();
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    try { tab.cleanup(); } catch (e) { console.error(e); }
    tab.pane.remove();
    tab.el.remove();
    tabs.splice(i, 1);
    if (!tabs.length) newTab('home');
    else if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)]);
  }

  function updateChrome() {
    const t = active;
    if (document.activeElement !== address) address.value = displayUrl(t);
    backBtn.disabled = t.hi <= 0;
    fwdBtn.disabled = t.hi >= t.hist.length - 1;
    rail.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.app === t.appId));
    document.title = `${APPS[t.appId].name} · ${CONFIG.siteName}`;
    history.replaceState(null, '', `#/${routeOf(t)}`);
  }

  function nav(appId, params = {}) {
    if (!active) return newTab(appId, params);
    navigate(active, appId, params, true);
  }
  browserNav = nav;

  // ---- address bar
  address.addEventListener('focus', () => address.select());
  address.addEventListener('blur', () => active && (address.value = displayUrl(active)));
  address.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { address.blur(); return; }
    if (e.key !== 'Enter') return;
    const raw = address.value.trim();
    if (!raw) return;
    address.blur();
    const stripped = raw.replace(/^[a-z0-9]+:\/\//i, '').replace(/^\/+|\/+$/g, '');
    const [path, q] = stripped.split('?');
    const isApp = /^[a-z0-9]+:\/\//i.test(raw) ? raw.toLowerCase().startsWith(scheme) : true;
    const id = isApp ? findApp(path) : null;
    if (id) return nav(id, Object.fromEntries(new URLSearchParams(q || '')));
    if (looksLikeUrl(raw)) return webSearch(raw, ctx);
    const r = await searchAll(raw);
    if (r.games.length) return nav('games', { q: raw });
    webSearch(raw, ctx);
  });

  // ---- keyboard: Alt+T new tab, Alt+W close tab
  const onKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); newTab('home'); }
    else if (k === 'w') { e.preventDefault(); active && closeTab(active); }
  };
  document.addEventListener('keydown', onKey);

  // ---- outside hash changes (links, typed URL)
  const onHash = () => {
    const raw = location.hash.replace(/^#\/?/, '');
    const [id, q] = raw.split('?');
    if (active && raw === routeOf(active)) return;
    nav(APPS[id] ? id : 'home', Object.fromEntries(new URLSearchParams(q || '')));
  };
  window.addEventListener('hashchange', onHash);

  const [startId, startQ] = location.hash.replace(/^#\/?/, '').split('?');
  newTab(APPS[startId] ? startId : 'home', Object.fromEntries(new URLSearchParams(startQ || '')));

  return {
    layout: 'browser',
    cleanup() {
      browserNav = null;
      ctx.webNavigated = null;
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('keydown', onKey);
      for (const t of tabs) { try { t.cleanup(); } catch (e) { console.error(e); } }
      unMini();
    },
  };
}

// ---------------------------------------------------------------------
// Desktop layout (window manager)
// ---------------------------------------------------------------------
const wm = {
  wins: new Map(),
  z: 20,
  layer: null,
  bar: null,
  pinned: new Map(), // appId -> dock button
  cascade: 0,

  open(appId, params = {}) {
    const app = APPS[appId];
    const existing = this.wins.get(appId);
    if (existing) {
      if (Object.keys(params).length) {
        existing.cleanup();
        existing.cleanup = mountApp(appId, existing.body, params);
      }
      this.show(existing);
      return;
    }
    this.create({ key: appId, title: app.name, iconName: app.icon, mount: (body) => mountApp(appId, body, params) });
  },

  frame(title, url, { iconName = 'games', width, height } = {}) {
    const key = `frame-${Date.now()}`;
    this.create({
      key, title, iconName, width, height,
      mount: (body) => {
        body.className = 'win-body frame-body';
        body.append(h('iframe', { src: url, allow: 'autoplay; fullscreen; gamepad; clipboard-write', allowfullscreen: true, title }));
        return () => {};
      },
    });
  },

  create({ key, title, iconName, mount, width = 960, height = 620 }) {
    const vw = this.layer.clientWidth, vh = this.layer.clientHeight;
    const w = Math.min(width, vw - 20), hgt = Math.min(height, vh - 20);
    const off = (this.cascade++ % 6) * 28;
    const left = Math.max(10, Math.round((vw - w) / 2 - 80 + off));
    const top = Math.max(10, Math.round((vh - hgt) / 2 - 60 + off));

    const body = h('div', { class: 'win-body' });
    const head = h('div', { class: 'win-head' },
      h('span', { class: 'win-icon', html: icon(iconName, 16) }),
      h('span', { class: 'win-title' }, title),
      h('div', { class: 'win-btns' },
        h('button', { 'aria-label': 'Minimise', html: icon('min', 14), onClick: () => this.minimise(win) }),
        h('button', { 'aria-label': 'Maximise', html: icon('max', 14), onClick: () => this.toggleMax(win) }),
        h('button', { class: 'close', 'aria-label': 'Close', html: icon('close', 14), onClick: () => this.close(win) })));
    const el = h('div', { class: 'win', style: { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hgt}px` } }, head, body);
    const pinned = this.pinned.get(key);
    const colorKey = APP_COLORS[key] ? key : ({ games: 'games', pdf: 'pdfs', book: 'books', tv: 'tv' }[iconName] || 'games');
    const [c1, c2] = APP_COLORS[colorKey];
    const task = pinned || h('button', { class: 'dock-app', title, 'aria-label': title, onClick: () => (win.min || this.top !== win ? this.show(win) : this.minimise(win)) },
      h('span', { class: 'app-tile', style: { width: '34px', height: '34px', borderRadius: '10px', background: `linear-gradient(160deg, ${c1}, ${c2})` }, html: icon(iconName, 17) }));
    task.classList.add('running');
    const win = { key, el, body, task, pinned: Boolean(pinned), min: false, max: false, cleanup: () => {} };
    this.wins.set(key, win);
    this.layer.append(el);
    if (!pinned) this.bar.append(task);
    el.addEventListener('pointerdown', () => this.focus(win), true);
    head.addEventListener('dblclick', (e) => !e.target.closest('button') && this.toggleMax(win));
    this.makeDraggable(win, head);
    if (vw < 700) this.toggleMax(win);
    this.focus(win);
    win.cleanup = mount(body) || (() => {});
    return win;
  },

  makeDraggable(win, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || win.max) return;
      const r = win.el.getBoundingClientRect();
      const lr = this.layer.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('dragging');
      const move = (ev) => {
        const x = Math.min(Math.max(ev.clientX - lr.left - dx, -r.width + 80), lr.width - 80);
        const y = Math.min(Math.max(ev.clientY - lr.top - dy, 0), lr.height - 40);
        win.el.style.left = `${x}px`;
        win.el.style.top = `${y}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging');
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  },

  get top() {
    let best = null;
    for (const w of this.wins.values()) if (!w.min && (!best || +w.el.style.zIndex > +best.el.style.zIndex)) best = w;
    return best;
  },

  focus(win) {
    if (this.top === win && win.el.classList.contains('focused')) return;
    win.el.style.zIndex = ++this.z;
    for (const w of this.wins.values()) {
      w.el.classList.toggle('focused', w === win);
      w.task.classList.toggle('active', w === win);
    }
  },
  show(win) {
    win.min = false;
    win.el.classList.remove('minimised');
    this.focus(win);
  },
  minimise(win) {
    win.min = true;
    win.el.classList.add('minimised');
    win.el.classList.remove('focused');
    win.task.classList.remove('active');
    const t = this.top;
    if (t) this.focus(t);
  },
  toggleMax(win) {
    win.max = !win.max;
    win.el.classList.toggle('maxed', win.max);
  },
  close(win) {
    try { win.cleanup(); } catch (e) { console.error(e); }
    win.el.remove();
    if (win.pinned) win.task.classList.remove('running', 'active');
    else win.task.remove();
    this.wins.delete(win.key);
    const t = this.top;
    if (t) this.focus(t);
  },
  closeAll() {
    for (const w of [...this.wins.values()]) this.close(w);
    this.cascade = 0;
  },
};

function buildDesktop() {
  const DESK_APPS = APP_ORDER.filter((id) => id !== 'home');
  const PINNED = ['web', 'games', 'music', 'videos', 'tv', 'chat', 'ai'];

  const icons = h('div', { class: 'desk-icons' }, DESK_APPS.map((id) =>
    h('button', { class: 'desk-icon', onClick: () => ctx.open(id), title: APPS[id].name },
      appTile(id, 50), h('span', { class: 'di-label' }, APPS[id].name))));
  const logo = h('div', { class: 'desk-logo', html: LOGO_SVG });

  // right-hand widgets
  const bigTime = h('div', { class: 'w-time' });
  const bigDate = h('div', { class: 'w-date' });
  const weather = h('div', { class: 'w-weather' });
  const system = h('div', { class: 'w-system' });
  const widgets = h('aside', { class: 'desk-widgets' },
    bigTime, bigDate,
    h('div', { class: 'w-head' }, 'Weather'), weather,
    h('div', { class: 'w-head' }, 'System'), system);

  const layer = h('div', { class: 'win-layer' });

  // ---- dock
  const tasks = h('div', { class: 'dock-tasks' });
  const pinnedWrap = h('div', { class: 'dock-pinned' });
  wm.pinned = new Map();
  for (const id of PINNED) {
    const b = h('button', { class: 'dock-app', title: APPS[id].name, 'aria-label': APPS[id].name, onClick: () => {
      const w = wm.wins.get(id);
      if (!w) ctx.open(id);
      else if (w.min || wm.top !== w) wm.show(w);
      else wm.minimise(w);
    } }, appTile(id, 34));
    wm.pinned.set(id, b);
    pinnedWrap.append(b);
  }
  const miniEl = h('div', { class: 'bar-mini' });
  const dockTime = h('div', { class: 'dock-time' });
  const dockDate = h('div', { class: 'dock-date' });

  const searchInput = h('input', { class: 'dock-search-input', placeholder: 'Search games, apps and the web', spellcheck: 'false' });
  const results = h('div', { class: 'dock-results hidden' });
  let pick = [];
  const closeResults = () => results.classList.add('hidden');
  const runSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) { closeResults(); return; }
    const r = await searchAll(q);
    if (searchInput.value.trim() !== q) return;
    pick = [
      ...r.apps.map((id) => ({ label: APPS[id].name, sub: 'App', node: appTile(id, 28), run: () => ctx.open(id) })),
      ...r.games.map((g) => ({ label: g.title, sub: 'Game', node: appTile('games', 28), run: () => openGame(g, ctx) })),
      { label: `Search the web for “${q}”`, sub: 'Web', node: h('span', { class: 'res-web', html: icon('globe', 16) }), run: () => webSearch(q, ctx) },
    ];
    results.replaceChildren(...pick.map((p) => h('button', { class: 'res-item', onClick: () => { p.run(); searchInput.value = ''; closeResults(); } },
      p.node, h('span', { class: 'res-label' }, p.label), h('span', { class: 'res-sub' }, p.sub))));
    results.classList.remove('hidden');
  };
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; closeResults(); searchInput.blur(); }
    if (e.key === 'Enter' && pick.length && !results.classList.contains('hidden')) {
      pick[0].run();
      searchInput.value = '';
      closeResults();
    }
  });
  const search = h('label', { class: 'dock-search' }, h('span', { html: icon('search', 14) }), searchInput, results);

  // start menu
  const startMenu = h('div', { class: 'start-menu' });
  const toggleStart = (force) => startMenu.classList.toggle('open', force);
  const renderStart = () => {
    const p = session.profile;
    startMenu.replaceChildren(
      h('div', { class: 'sm-user' }, avatarEl(p, 40), h('div', {}, h('b', {}, p?.username || 'Guest'), h('div', { class: 'muted small' }, session.offline ? 'Setup mode' : 'Signed in'))),
      h('div', { class: 'sm-apps' }, APP_ORDER.map((id) =>
        h('button', { class: 'sm-app', onClick: () => { toggleStart(false); ctx.open(id); } }, appTile(id, 30), APPS[id].name))),
      h('button', { class: 'sm-logout', onClick: () => signOut() }, h('span', { html: icon('logout', 16) }), session.offline ? 'Reset profile' : 'Log out'));
  };
  renderStart();
  const startBtn = h('button', { class: 'start-btn', title: 'Start', 'aria-label': 'Start', onClick: (e) => { e.stopPropagation(); toggleStart(); } },
    h('img', { class: 'start-icon', src: 'assets/icon.png', alt: '' }));

  const dock = h('div', { class: 'dock' }, startBtn, search, pinnedWrap, tasks, miniEl,
    h('div', { class: 'dock-clock' }, dockTime, dockDate));
  const root = h('div', { class: 'shell desktop' }, logo, icons, widgets, layer, startMenu, dock);
  appRoot.replaceChildren(root);

  wm.layer = layer;
  wm.bar = tasks;
  const closeStart = (e) => {
    if (!startMenu.contains(e.target)) toggleStart(false);
    if (!search.contains(e.target)) closeResults();
  };
  const blurStart = () => { toggleStart(false); closeResults(); }; // clicks inside game iframes
  document.addEventListener('pointerdown', closeStart);
  window.addEventListener('blur', blurStart);

  const offs = [
    mountClock(bigTime, bigDate, { dateFmt: 'big' }),
    mountClock(dockTime, dockDate, { dateFmt: 'short' }),
    mountWeather(weather),
    mountSystem(system),
    mountMini(miniEl, ctx),
    on('profile', renderStart),
  ];

  // honour #/app links (e.g. from a shared URL)
  const fromHash = () => {
    const [id, q] = location.hash.replace(/^#\/?/, '').split('?');
    if (APPS[id] && id !== 'home') wm.open(id, Object.fromEntries(new URLSearchParams(q || '')));
    if (location.hash) history.replaceState(null, '', location.pathname);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();

  return {
    layout: 'desktop',
    cleanup() {
      wm.closeAll();
      document.removeEventListener('pointerdown', closeStart);
      window.removeEventListener('blur', blurStart);
      window.removeEventListener('hashchange', fromHash);
      offs.forEach((f) => f());
    },
  };
}

boot();
