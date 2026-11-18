import { h, icon, toast, formatDate, avatarEl, modal, pickFile, confirmBox } from '../ui.js';
import { session, leaveGuest, updateProfile, uploadProfileImage, signOut, validUsername } from '../auth.js';
import { on } from '../store.js';
import { statusOf } from '../presence.js';
import { displayName, STATUSES, DECOS, BADGES, badgeList, isHex } from '../profilekit.js';
import { getManifest } from '../data.js';
import { loadStats, allStats, statsFor, formatPlaytime } from '../gamestats.js';
import { gameCover } from './games.js';

/**
 * "Games" section: total play time, most played and favourites.
 * rows: [{ game_id, title, plays, seconds, favourite }]
 */
function gamesSection(rows, games, openGame) {
  const total = rows.reduce((t, r) => t + (r.seconds || 0), 0);
  const byId = new Map(games.map((g) => [g.id, g]));
  const tile = (r) => {
    const g = byId.get(r.game_id) || { id: r.game_id, title: r.title || 'Game' };
    return h('button', { class: 'pf-game', title: g.title, disabled: !byId.has(r.game_id) || !openGame, onClick: () => openGame?.(g) },
      gameCover(g, 'pf-game-cover'),
      h('span', { class: 'clamp1' }, g.title),
      h('span', { class: 'muted tiny' }, r.seconds >= 60 ? formatPlaytime(r.seconds) : `${r.plays} play${r.plays === 1 ? '' : 's'}`));
  };
  const most = rows.filter((r) => r.plays > 0).sort((a, b) => b.seconds - a.seconds || b.plays - a.plays).slice(0, 6);
  const favs = rows.filter((r) => r.favourite).slice(0, 12);
  if (!most.length && !favs.length) return h('p', { class: 'muted small' }, 'No games played yet.');
  return h('div', { class: 'pf-games' },
    h('div', { class: 'pf-stat-row' },
      h('div', { class: 'pf-stat' }, h('b', {}, formatPlaytime(total)), h('span', { class: 'muted tiny' }, 'played')),
      h('div', { class: 'pf-stat' }, h('b', {}, String(rows.filter((r) => r.plays > 0).length)), h('span', { class: 'muted tiny' }, 'games')),
      h('div', { class: 'pf-stat' }, h('b', {}, String(favs.length)), h('span', { class: 'muted tiny' }, 'favourites'))),
    most.length ? h('div', { class: 'muted tiny list-label' }, 'Most played') : null,
    most.length ? h('div', { class: 'pf-game-row' }, most.map(tile)) : null,
    favs.length ? h('div', { class: 'muted tiny list-label' }, 'Favourites') : null,
    favs.length ? h('div', { class: 'pf-game-row' }, favs.map(tile)) : null);
}
const statsToRows = (stats) => Object.entries(stats).map(([game_id, s]) => ({ game_id, title: s.title, plays: s.plays, seconds: s.seconds, favourite: s.favourite }));


// ---------------------------------------------------------------- card
/** The status dot to show: live presence for others, your choice for you. */
function cardStatus(p) {
  if (p.id && p.id === session.user?.id) return p.status === 'invisible' ? null : (p.status || 'online');
  return p.id ? statusOf(p.id) : undefined;
}

/** Discord-style profile card. `extra` goes under the bio (e.g. buttons). */
export function profileCard(p, extra = null, { big = false, preview = false } = {}) {
  const themed = isHex(p.theme_primary) || isHex(p.theme_accent);
  const p1 = isHex(p.theme_primary) ? p.theme_primary : (p.theme_accent || '');
  const p2 = isHex(p.theme_accent) ? p.theme_accent : p1;
  const card = h('div', { class: `dcard${themed ? ' themed' : ''}${big ? ' big' : ''}` });
  if (themed) card.style.background = `linear-gradient(180deg, ${p1}, ${p2})`;

  const banner = h('div', { class: 'dc-banner' });
  if (p.banner_url) banner.style.backgroundImage = `url("${p.banner_url.replace(/"/g, '%22')}")`;
  else if (isHex(p.banner_color)) banner.style.background = p.banner_color;
  else if (themed) banner.style.background = p1;

  const badges = badgeList(p);
  const games = h('div', { class: 'pf-card-games' });
  if (!preview && p.id && session.user && !session.offline && p.id !== 'local') {
    Promise.all([statsFor(p.id), getManifest()]).then(([rows, m]) => {
      if (rows.length) games.replaceChildren(h('div', { class: 'dc-label' }, 'Games'), gamesSection(rows, m.games, null));
    });
  }
  const statusLine = p.status_text || p.status_emoji
    ? h('div', { class: 'dc-custom-status' }, p.status_emoji ? h('span', {}, p.status_emoji) : null, p.status_text ? h('span', {}, p.status_text) : null)
    : null;

  card.append(
    banner,
    h('div', { class: 'dc-top' },
      h('div', { class: 'dc-avatar' }, avatarEl(p, big ? 104 : 88, { status: cardStatus(p) })),
      badges.length ? h('div', { class: 'dc-badges' }, badges.map((b) => h('span', { class: 'dc-badge', title: BADGES[b].label }, BADGES[b].emoji))) : null),
    h('div', { class: 'dc-body' },
      h('h2', { class: 'dc-name' }, displayName(p)),
      h('div', { class: 'dc-user' }, `@${p.username || 'you'}`, p.pronouns ? h('span', {}, ` • ${p.pronouns}`) : null),
      statusLine,
      p.banned ? h('div', { class: 'dc-banned' }, 'This account is banned') : null,
      p.bio ? h('div', { class: 'dc-section' }, h('div', { class: 'dc-label' }, 'About me'), h('p', { class: 'dc-bio' }, p.bio)) : null,
      h('div', { class: 'dc-section' }, h('div', { class: 'dc-label' }, 'Member since'), h('div', { class: 'small' }, formatDate(p.created_at))),
      extra,
      games));
  return card;
}

export function showProfileModal(p, extra) {
  if (!p) return;
  return modal({ title: displayName(p), content: profileCard(p, extra), wide: false, className: 'profile-modal' });
}

// ---------------------------------------------------------------- page
export default {
  id: 'profile',
  name: 'Profile',
  icon: 'user',
  mount(el, params, ctx) {
    const gamesBox = h('div', {}, h('p', { class: 'muted small' }, 'Loading…'));
    const drawGames = () => getManifest().then((m) =>
      gamesBox.replaceChildren(gamesSection(statsToRows(allStats()), m.games, (g) => ctx.open('games', { play: g.id }))));
    loadStats().then(drawGames);

    let draft = null;
    const previewBox = h('div', { class: 'pf-preview' });
    const drawPreview = () => previewBox.replaceChildren(h('div', { class: 'muted tiny list-label' }, 'Preview'), profileCard(draft, null, { preview: true }));

    function render() {
      const p = session.profile;
      if (!p) { el.replaceChildren(h('div', { class: 'empty' }, 'Not logged in')); return; }
      draft = { ...p };
      const set = (k, v) => { draft[k] = v; drawPreview(); };

      // ---- text fields
      const input = (k, opts) => {
        const i = h('input', { class: 'input', value: draft[k] || '', ...opts });
        i.addEventListener('input', () => set(k, i.value));
        return i;
      };
      const uname = input('username', { maxlength: 20 });
      const dname = input('display_name', { maxlength: 32, placeholder: p.username });
      const pronouns = input('pronouns', { maxlength: 40, placeholder: 'e.g. she/her' });
      const bio = h('textarea', { class: 'input', rows: 3, maxlength: 200, placeholder: 'Say something about yourself' }, draft.bio || '');
      bio.addEventListener('input', () => set('bio', bio.value));

      // ---- status
      const statusRow = h('div', { class: 'status-pick' });
      const drawStatus = () => statusRow.replaceChildren(...Object.entries(STATUSES).map(([id, st]) =>
        h('button', { class: `status-opt${(draft.status || 'online') === id ? ' on' : ''}`, onClick: () => { set('status', id); drawStatus(); } },
          h('i', { style: { background: st.color } }), st.label)));
      drawStatus();
      const emoji = input('status_emoji', { maxlength: 8, placeholder: '😀', class: 'input emoji-input' });
      const stext = input('status_text', { maxlength: 80, placeholder: 'What are you up to?' });

      // ---- decorations
      const decoGrid = h('div', { class: 'deco-grid' });
      const drawDecos = () => decoGrid.replaceChildren(...[['', { label: 'None' }], ...Object.entries(DECOS)].map(([id, d]) =>
        h('button', { class: `deco-opt${(draft.avatar_deco || '') === id ? ' on' : ''}`, title: d.label, onClick: () => { set('avatar_deco', id || null); drawDecos(); } },
          avatarEl({ ...draft, avatar_deco: id || null }, 44), h('span', {}, d.label))));
      drawDecos();

      // ---- colours
      const colour = (k, fallback) => {
        const c = h('input', { type: 'color', class: 'color-input', value: isHex(draft[k]) ? draft[k] : fallback });
        const clear = h('button', { class: 'btn sm', onClick: () => { set(k, null); clear.disabled = true; } }, 'None');
        clear.disabled = !isHex(draft[k]);
        c.addEventListener('input', () => { set(k, c.value); clear.disabled = false; });
        return h('div', { class: 'row gap-sm' }, c, clear);
      };

      const save = h('button', { class: 'btn primary', onClick: async () => {
        const u = (draft.username || '').trim();
        if (!validUsername(u)) return toast('Username: 3-20 letters, numbers or _', 'error');
        const clean = (v, n) => (v || '').trim().slice(0, n) || null;
        const patch = {
          username: u,
          display_name: clean(draft.display_name, 32),
          pronouns: clean(draft.pronouns, 40),
          bio: clean(draft.bio, 200),
          status: draft.status || 'online',
          status_emoji: clean(draft.status_emoji, 8),
          status_text: clean(draft.status_text, 80),
          avatar_deco: draft.avatar_deco || null,
          banner_color: isHex(draft.banner_color) ? draft.banner_color : null,
          theme_primary: isHex(draft.theme_primary) ? draft.theme_primary : null,
          theme_accent: isHex(draft.theme_accent) ? draft.theme_accent : null,
        };
        save.disabled = true;
        try {
          await updateProfile(patch);
          toast('Profile saved', 'success');
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          save.disabled = false;
        }
      } }, 'Save changes');

      const editor = h('div', { class: 'pf-editor' },
        h('h3', {}, 'Edit profile'),
        h('div', { class: 'pf-form' },
          h('label', { class: 'field' }, h('span', {}, 'Display name'), dname),
          h('label', { class: 'field' }, h('span', {}, 'Username'), uname),
          h('label', { class: 'field' }, h('span', {}, 'Pronouns'), pronouns),
          h('label', { class: 'field' }, h('span', {}, 'About me'), bio),
          h('div', { class: 'field' }, h('span', {}, 'Status'), statusRow),
          h('div', { class: 'field' }, h('span', {}, 'Custom status'), h('div', { class: 'row gap-sm' }, emoji, stext)),
          h('div', { class: 'field' }, h('span', {}, 'Profile picture'),
            h('div', { class: 'row gap-sm wrap' },
              h('button', { class: 'btn sm', onClick: () => change('avatar') }, h('span', { html: icon('upload', 14) }), 'Upload'),
              p.avatar_url ? h('button', { class: 'btn sm', onClick: () => updateProfile({ avatar_url: null }) }, 'Remove') : null)),
          h('div', { class: 'field' }, h('span', {}, 'Avatar decoration'), decoGrid),
          h('div', { class: 'field' }, h('span', {}, 'Banner'),
            h('div', { class: 'row gap-sm wrap' },
              h('button', { class: 'btn sm', onClick: () => change('banner') }, h('span', { html: icon('upload', 14) }), 'Upload image'),
              p.banner_url ? h('button', { class: 'btn sm', onClick: () => updateProfile({ banner_url: null }) }, 'Remove image') : null)),
          h('div', { class: 'field' }, h('span', {}, 'Banner colour (when there’s no image)'), colour('banner_color', '#5865f2')),
          h('div', { class: 'field' }, h('span', {}, 'Profile theme'),
            h('div', { class: 'row gap wrap' },
              h('div', { class: 'theme-col' }, h('span', { class: 'muted tiny' }, 'Primary'), colour('theme_primary', '#5865f2')),
              h('div', { class: 'theme-col' }, h('span', { class: 'muted tiny' }, 'Accent'), colour('theme_accent', '#eb459e')))),
          h('div', { class: 'row gap' }, save,
            h('button', { class: 'btn', onClick: render }, 'Undo changes'))),
        previewBox);
      drawPreview();

      el.replaceChildren(h('div', { class: 'pf-page' },
        session.guest ? h('div', { class: 'guest-note' },
          h('p', {}, h('b', {}, 'Guest profile. '), 'Saved in this browser only.'),
          h('button', { class: 'btn primary sm', onClick: leaveGuest }, 'Make an account')) : null,
        profileCard(p, null, { big: true }),
        h('div', { class: 'panel' }, h('h3', {}, 'Games'), gamesBox),
        h('div', { class: 'panel' }, editor),
        h('div', { class: 'panel' },
          h('h3', {}, 'Account'),
          session.user?.email ? h('p', { class: 'muted small' }, session.user.email) : null,
          session.offline ? h('p', { class: 'muted small' }, 'Setup mode: this profile is saved in this browser only. Add Supabase keys in js/config.js for real accounts.') : null,
          session.guest ? h('p', { class: 'muted small' }, 'You’re a guest. Your profile and settings are saved in this browser only. Make an account to chat, upload PDFs and keep your settings on every device.') : null,
          (session.guest
            ? h('button', { class: 'btn primary', onClick: leaveGuest }, h('span', { html: icon('user', 16) }), 'Log in or sign up')
            : h('button', { class: 'btn danger', onClick: async () => {
              if (await confirmBox(session.offline ? 'Reset profile?' : 'Log out?', session.offline ? 'Your local profile will be removed from this browser.' : 'You can log back in any time.', session.offline ? 'Reset' : 'Log out', true)) {
                if (session.offline) localStorage.removeItem('azelela.localProfile');
                signOut();
              }
            } }, h('span', { html: icon('logout', 16) }), session.offline ? 'Reset profile' : 'Log out')))));
    }

    async function change(kind) {
      const f = await pickFile('image/png,image/jpeg,image/gif,image/webp');
      if (!f) return;
      if (f.size > (kind === 'avatar' ? 3 : 5) * 1024 * 1024) return toast(`Image must be under ${kind === 'avatar' ? 3 : 5} MB`, 'error');
      toast('Uploading…');
      try {
        await uploadProfileImage(kind, f);
        toast(kind === 'avatar' ? 'Profile picture updated' : 'Banner updated', 'success');
      } catch (e) {
        toast(e.message || 'Upload failed', 'error');
      }
    }

    render();
    const offs = [on('profile', render), on('gamestats', drawGames)];
    return () => offs.forEach((f) => f());
  },
};
