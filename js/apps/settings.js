import { h, icon, toast, pickFile, resizeImage, blobToDataUrl, confirmBox } from '../ui.js';
import { settings, saveSettings, on, DEFAULTS } from '../store.js';
import { THEMES, FONTS } from '../themes.js';
import { session, leaveGuest, signOut } from '../auth.js';

const ACCENTS = ['#7c8cff', '#22d3ee', '#4ade80', '#facc15', '#fb923c', '#f43f5e', '#ec4899', '#c084fc', '#14b8a6', '#e4e4e7'];

export default {
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  mount(el) {
    function render() {
      const s = settings;
      const t = THEMES[s.theme] || THEMES.midnight;

      const themeGrid = h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, th]) =>
        h('button', { class: `theme-swatch${s.theme === id ? ' on' : ''}`, onClick: () => saveSettings({ theme: id }) },
          h('div', { class: 'sw', style: { background: th.bg } }, h('i', { style: { background: th.panel } }), h('i', { style: { background: s.accent || th.accent } })),
          h('span', {}, th.name))));

      const custom = h('input', { type: 'color', class: 'color-input', value: s.accent || t.accent, title: 'Custom colour' });
      custom.addEventListener('change', () => saveSettings({ accent: custom.value }));
      const accents = h('div', { class: 'accent-row' },
        h('button', { class: `accent-dot def${!s.accent ? ' on' : ''}`, title: 'Theme default', onClick: () => saveSettings({ accent: null }) }, 'A'),
        ACCENTS.map((c) => h('button', { class: `accent-dot${s.accent === c ? ' on' : ''}`, style: { background: c }, title: c, onClick: () => saveSettings({ accent: c }) })),
        custom);

      const font = h('select', { class: 'input' }, FONTS.map((f) => h('option', { value: f, selected: s.font === f, style: { fontFamily: f } }, f)));
      font.onchange = () => saveSettings({ font: font.value });

      const bgUrl = h('input', { class: 'input', placeholder: 'Paste an image URL', value: s.background && !s.background.startsWith('data:') ? s.background : '' });
      const applyUrl = () => {
        const v = bgUrl.value.trim();
        if (v && !/^https?:\/\//i.test(v)) return toast('Use a link starting with https://', 'error');
        saveSettings({ background: v || null });
      };
      bgUrl.addEventListener('keydown', (e) => e.key === 'Enter' && applyUrl());
      const dim = h('input', { type: 'range', class: 'range', min: 0, max: 0.9, step: 0.05, value: s.bgDim });
      dim.addEventListener('input', () => saveSettings({ bgDim: +dim.value }, { sync: false }));
      dim.addEventListener('change', () => saveSettings({ bgDim: +dim.value }));

      const layoutBtn = (id, label, ic) => h('button', { class: `layout-pick${s.layout === id ? ' on' : ''}`, onClick: () => saveSettings({ layout: id }) },
        h('span', { html: icon(ic, 22) }), label);

      el.replaceChildren(h('div', { class: 'settings-page' },
        h('section', { class: 'panel' },
          h('h3', {}, 'Theme'), themeGrid,
          h('h4', {}, 'Accent colour'), accents),
        h('section', { class: 'panel' },
          h('h3', {}, 'Font'), font,
          h('p', { class: 'font-preview', style: { fontFamily: `'${s.font}', system-ui` } }, 'The quick brown fox jumps over the lazy dog.')),
        h('section', { class: 'panel' },
          h('h3', {}, 'Background'),
          s.background ? h('div', { class: 'bg-preview', style: { backgroundImage: `url("${s.background.replace(/"/g, '%22')}")` } }) : h('p', { class: 'muted small' }, 'No custom background.'),
          h('div', { class: 'row gap wrap' }, bgUrl, h('button', { class: 'btn', onClick: applyUrl }, 'Use URL')),
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn', onClick: async () => {
              const f = await pickFile('image/*');
              if (!f) return;
              try {
                const blob = await resizeImage(f, 1920, 1080, 0.82);
                saveSettings({ background: await blobToDataUrl(blob) });
                toast('Background set', 'success');
              } catch {
                toast('Could not use that image', 'error');
              }
            } }, h('span', { html: icon('upload', 16) }), 'Upload image'),
            s.background ? h('button', { class: 'btn', onClick: () => saveSettings({ background: null }) }, 'Remove') : null),
          h('label', { class: 'field' }, h('span', {}, 'Dim background'), dim)),
        h('section', { class: 'panel' },
          h('h3', {}, 'Layout'),
          h('div', { class: 'row gap wrap' }, layoutBtn('browser', 'Browser page', 'menu'), layoutBtn('desktop', 'Desktop', 'grid'))),
        h('section', { class: 'panel' },
          h('h3', {}, 'Reset'),
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn', onClick: async () => {
              if (await confirmBox('Reset appearance?', 'Theme, accent, font and background go back to default.', 'Reset')) {
                const { theme, accent, font, background, bgDim } = DEFAULTS;
                saveSettings({ theme, accent, font, background, bgDim });
              }
            } }, 'Reset appearance'),
            (session.guest
            ? h('button', { class: 'btn primary', onClick: leaveGuest }, h('span', { html: icon('user', 16) }), 'Log in or sign up')
            : h('button', { class: 'btn danger', onClick: async () => {
              if (await confirmBox(session.offline ? 'Reset profile?' : 'Log out?', session.offline ? 'Your local profile will be removed.' : 'You can log back in any time.', session.offline ? 'Reset' : 'Log out', true)) {
                if (session.offline) localStorage.removeItem('azelela.localProfile');
                signOut();
              }
            } }, h('span', { html: icon('logout', 16) }), session.offline ? 'Reset profile' : 'Log out'))))));
    }
    // redraw on changes, but not while the dim slider is being dragged
    const sig = () => JSON.stringify({ ...settings, bgDim: 0 });
    let last = sig();
    render();
    return on('settings', () => {
      const now = sig();
      if (now !== last) { last = now; render(); }
    });
  },
};
