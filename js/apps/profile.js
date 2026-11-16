import { h, icon, toast, formatDate, avatarEl, modal, pickFile, confirmBox } from '../ui.js';
import { session, leaveGuest, updateProfile, uploadProfileImage, signOut, validUsername } from '../auth.js';
import { on } from '../store.js';

function bannerEl(p) {
  const b = h('div', { class: 'pf-banner' });
  if (p?.banner_url) b.style.backgroundImage = `url("${p.banner_url.replace(/"/g, '%22')}")`;
  return b;
}

/** Read-only profile card (used for other users in chat). */
export function profileCard(p) {
  return h('div', { class: 'pf-card' },
    bannerEl(p),
    h('div', { class: 'pf-head' }, avatarEl(p, 84),
      h('div', { class: 'pf-names' }, h('h2', {}, p.username))),
    p.bio ? h('p', { class: 'pf-bio' }, p.bio) : null,
    h('div', { class: 'pf-joined muted small' }, `Joined ${formatDate(p.created_at)}`));
}

export function showProfileModal(p) {
  if (!p) return;
  modal({ title: p.username, content: profileCard(p) });
}

export default {
  id: 'profile',
  name: 'Profile',
  icon: 'user',
  mount(el) {
    function render() {
      const p = session.profile;
      if (!p) { el.replaceChildren(h('div', { class: 'empty' }, 'Not logged in')); return; }
      const banner = bannerEl(p);
      const bannerBtn = h('button', { class: 'btn sm pf-banner-btn', onClick: () => change('banner') }, h('span', { html: icon('upload', 14) }), 'Change banner');
      banner.append(bannerBtn);
      const av = h('button', { class: 'pf-avatar-btn', title: 'Change profile picture', onClick: () => change('avatar') }, avatarEl(p, 104), h('span', { class: 'pf-avatar-edit', html: icon('upload', 18) }));

      const uname = h('input', { class: 'input', value: p.username, maxlength: 20 });
      const bio = h('textarea', { class: 'input', rows: 3, maxlength: 200, placeholder: 'Say something about yourself' }, p.bio || '');
      const save = h('button', { class: 'btn primary', onClick: async () => {
        const u = uname.value.trim();
        if (!validUsername(u)) return toast('Username: 3-20 letters, numbers or _', 'error');
        save.disabled = true;
        try {
          await updateProfile({ username: u, bio: bio.value.trim().slice(0, 200) });
          toast('Profile saved', 'success');
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          save.disabled = false;
        }
      } }, 'Save');

      el.replaceChildren(h('div', { class: 'pf-page' },
        session.guest ? h('div', { class: 'guest-note' },
          h('p', {}, h('b', {}, 'Guest profile. '), 'Saved in this browser only.'),
          h('button', { class: 'btn primary sm', onClick: leaveGuest }, 'Make an account')) : null,
        h('div', { class: 'pf-card big' },
          banner,
          h('div', { class: 'pf-head' }, av,
            h('div', { class: 'pf-names' }, h('h2', {}, p.username),
              h('div', { class: 'muted small' }, `Joined ${formatDate(p.created_at)}`),
              session.user?.email ? h('div', { class: 'muted small' }, session.user.email) : null)),
          p.bio ? h('p', { class: 'pf-bio' }, p.bio) : null),
        h('div', { class: 'panel' },
          h('h3', {}, 'Edit profile'),
          h('label', { class: 'field' }, h('span', {}, 'Username'), uname),
          h('label', { class: 'field' }, h('span', {}, 'Bio'), bio),
          h('div', { class: 'row gap' }, save,
            p.avatar_url ? h('button', { class: 'btn', onClick: () => updateProfile({ avatar_url: null }) }, 'Remove picture') : null,
            p.banner_url ? h('button', { class: 'btn', onClick: () => updateProfile({ banner_url: null }) }, 'Remove banner') : null)),
        h('div', { class: 'panel' },
          h('h3', {}, 'Account'),
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
    return on('profile', render);
  },
};
