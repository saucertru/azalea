// Admin panel (only for accounts with is_admin = true).
//   Overview: site stats, top games and the announcement bar
//   Content:  upload games, music, videos and PDFs to your R2 bucket,
//             edit game titles/covers, delete files
//   Users:    find people, ban/unban, give badges, make admins
// Uploads go through the Cloudflare Worker (worker/index.mjs), which
// checks your login and that you're an admin before touching R2.
import { CONFIG } from '../config.js';
import { h, icon, toast, empty, spinner, modal, avatarEl, confirmBox, formatDate, debounce } from '../ui.js';
import { sb } from '../supabase.js';
import { session } from '../auth.js';
import { getManifest } from '../data.js';
import { PROFILE_COLS, displayName, BADGES, badgeList } from '../profilekit.js';
import { formatPlaytime } from '../gamestats.js';
import { showProfileModal } from './profile.js';

const MAX_UPLOAD = 100 * 1024 * 1024; // Cloudflare's request size limit (free plan)
const ROM_SYSTEMS = ['nes', 'snes', 'gba', 'gb', 'gbc', 'n64', 'nds', 'genesis', 'sms', 'gamegear', 'segacd', '32x', 'psx', 'psp', 'atari2600', 'atari7800', 'lynx', 'jaguar', 'pce', 'ngp', 'ws', 'vb', 'arcade', 'coleco'];
const TYPES = {
  html5: { label: 'HTML5 game (folder)', folder: 'games/html5' },
  webport: { label: 'Webport (folder)', folder: 'games/webports' },
  flash: { label: 'Flash game (.swf)', folder: 'games/flash', accept: '.swf' },
  rom: { label: 'ROM', folder: 'games/roms' },
  music: { label: 'Music', folder: 'music', accept: 'audio/*', multiple: true },
  video: { label: 'Video', folder: 'videos', accept: 'video/*,.mp4,.webm,.ogv,.mov,.m4v' },
  pdf: { label: 'PDF', folder: 'pdfs', accept: 'application/pdf,.pdf', multiple: true },
};

const fmtSize = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : n >= 2 ** 20 ? `${+(n / 2 ** 20).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';
/** keep names readable ("Artist - Song.mp3") but safe */
const cleanName = (s) => s.replace(/[\\/:*?"<>|#%\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'file';
const extOf = (n) => (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();

// ---------------------------------------------------------------- API
async function api(path, { method = 'GET', body, type } = {}) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Log in again to use the admin panel');
  const base = (CONFIG.adminApiUrl || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/admin/${path}`, {
    method, body,
    headers: { authorization: `Bearer ${token}`, ...(type ? { 'content-type': type } : {}) },
  });
  let out = {};
  try { out = await res.json(); } catch {}
  if (!res.ok) throw new Error(out.error || `The admin API said ${res.status}`);
  return out;
}
const putFile = (key, blob) => api(`file?key=${encodeURIComponent(key)}`, { method: 'PUT', body: blob, type: blob.type || 'application/octet-stream' });

export default {
  id: 'admin',
  name: 'Admin',
  icon: 'shield',
  adminOnly: true,
  mount(el, params, ctx) {
    if (!sb || !session.profile?.is_admin) {
      el.append(empty('Admins only', 'Ask the site owner to make your account an admin.'));
      return;
    }
    let tab = params.tab || 'overview';
    const tabs = h('div', { class: 'seg' });
    const body = h('div', { class: 'admin-body' });
    el.append(h('div', { class: 'admin-page' }, tabs, body));
    const drawTabs = () => tabs.replaceChildren(...[['overview', 'Overview'], ['content', 'Content'], ['users', 'Users']].map(([id, label]) =>
      h('button', { class: tab === id ? 'on' : '', onClick: () => { tab = id; drawTabs(); show(); } }, label)));
    const show = () => ({ overview, content, users })[tab]();
    drawTabs();
    show();

    // ============================================================ overview
    async function overview() {
      body.replaceChildren(spinner());
      const [{ data: st, error }, { data: site }] = await Promise.all([
        sb.rpc('admin_stats'),
        sb.from('site_settings').select('announcement').eq('id', 1).maybeSingle(),
      ]);
      if (tab !== 'overview') return;
      if (error) { body.replaceChildren(empty('Could not load stats', error.message)); return; }
      const tile = (n, label) => h('div', { class: 'pf-stat' }, h('b', {}, String(n)), h('span', { class: 'muted tiny' }, label));
      const ann = h('textarea', { class: 'input', rows: 2, maxlength: 300, placeholder: 'Shown in a bar at the top of the site for everyone' }, site?.announcement || '');
      const saveAnn = async (text) => {
        const { error: e } = await sb.from('site_settings').update({ announcement: text || null, updated_at: new Date().toISOString() }).eq('id', 1);
        if (e) return toast(e.message, 'error');
        toast(text ? 'Announcement posted' : 'Announcement removed', 'success');
        if (!text) ann.value = '';
      };
      body.replaceChildren(
        h('section', { class: 'panel' },
          h('h3', {}, 'Site'),
          h('div', { class: 'pf-stat-row' },
            tile(st.users, `users (${st.new_users_7d} new this week)`),
            tile(st.messages, `messages (${st.messages_24h} today)`),
            tile(st.rooms, 'chat rooms'), tile(st.dms, 'direct messages'),
            tile(st.friendships, 'friendships'), tile(st.pdfs, 'PDF uploads'),
            tile(st.plays, `game plays (${formatPlaytime(st.play_seconds)})`), tile(st.banned, 'banned'))),
        h('section', { class: 'panel' },
          h('h3', {}, 'Announcement'),
          ann,
          h('div', { class: 'row gap', style: { marginTop: '10px' } },
            h('button', { class: 'btn primary', onClick: () => saveAnn(ann.value.trim()) }, 'Post'),
            h('button', { class: 'btn', onClick: () => saveAnn('') }, 'Remove'))),
        h('section', { class: 'panel' },
          h('h3', {}, 'Top games'),
          st.top_games.length
            ? h('div', { class: 'admin-table' }, st.top_games.map((g) => h('div', { class: 'admin-row' },
              h('b', { class: 'grow clamp1' }, g.title || g.game_id),
              h('span', { class: 'muted small' }, `${g.plays} plays`),
              h('span', { class: 'muted small' }, formatPlaytime(g.seconds)),
              h('span', { class: 'muted small' }, `★ ${g.favourites}`))))
            : h('p', { class: 'muted small' }, 'No games played yet.')));
    }

    // ============================================================ content
    let files = [];
    async function content() {
      const typeSel = h('select', { class: 'input' }, Object.entries(TYPES).map(([id, t]) => h('option', { value: id }, t.label)));
      const form = h('div', { class: 'upload-form' });
      const list = h('div', {});
      body.replaceChildren(
        h('section', { class: 'panel' },
          h('h3', {}, 'Upload'),
          h('p', { class: 'muted small' }, `Files go into your R2 bucket and show up on the site within a minute. Up to ${fmtSize(MAX_UPLOAD)} per file; put bigger files in the Cloudflare dashboard (R2, then your bucket, then Upload).`),
          h('label', { class: 'field' }, h('span', {}, 'What are you adding?'), typeSel),
          form),
        h('section', { class: 'panel' },
          h('div', { class: 'row gap' }, h('h3', { class: 'grow' }, 'Files in R2'),
            h('button', { class: 'btn sm', onClick: loadFiles }, h('span', { html: icon('refresh', 14) }), 'Refresh')),
          h('p', { class: 'muted small' }, 'Files that are in the GitHub repo aren’t listed here. Change those in the repo.'),
          list));
      typeSel.onchange = () => drawForm(typeSel.value);
      drawForm('html5');

      function drawForm(type) {
        const t = TYPES[type];
        const isFolder = type === 'html5' || type === 'webport';
        const picker = h('input', { type: 'file', class: 'input', ...(isFolder ? { webkitdirectory: true, multiple: true } : { accept: t.accept || '', multiple: !!t.multiple }) });
        const name = h('input', { class: 'input', placeholder: isFolder ? 'Folder name (from the folder you pick)' : 'Uses the file name', maxlength: 60 });
        const title = h('input', { class: 'input', placeholder: 'Shown on the site (optional)', maxlength: 80 });
        const desc = h('input', { class: 'input', placeholder: 'Optional', maxlength: 200 });
        const cover = h('input', { type: 'file', class: 'input', accept: 'image/png,image/jpeg,image/webp,image/gif' });
        const subs = h('input', { type: 'file', class: 'input', accept: '.vtt' });
        const system = h('select', { class: 'input' }, h('option', { value: '' }, 'Detect from the file extension'), ROM_SYSTEMS.map((s) => h('option', { value: s }, s.toUpperCase())));
        const progress = h('div', { class: 'upload-progress' });
        const go = h('button', { class: 'btn primary' }, h('span', { html: icon('upload', 16) }), 'Upload');
        picker.onchange = () => {
          if (isFolder && picker.files.length) name.value = slug(picker.files[0].webkitRelativePath.split('/')[0]);
        };
        form.replaceChildren(
          h('label', { class: 'field' }, h('span', {}, isFolder ? 'Game folder (with index.html)' : t.multiple ? 'Files' : 'File'), picker),
          isFolder ? h('label', { class: 'field' }, h('span', {}, 'Folder name'), name) : null,
          type === 'rom' ? h('label', { class: 'field' }, h('span', {}, 'System'), system) : null,
          isFolder ? h('label', { class: 'field' }, h('span', {}, 'Title'), title) : null,
          isFolder ? h('label', { class: 'field' }, h('span', {}, 'Description'), desc) : null,
          type === 'video' ? h('label', { class: 'field' }, h('span', {}, 'Subtitles (.vtt, optional)'), subs) : null,
          !t.multiple ? h('label', { class: 'field' }, h('span', {}, 'Cover image (optional)'), cover) : null,
          go, progress);

        go.onclick = async () => {
          const picked = [...picker.files];
          if (!picked.length) return toast('Pick something to upload first', 'error');
          const big = picked.find((f) => f.size > MAX_UPLOAD);
          if (big) return toast(`${big.name} is over ${fmtSize(MAX_UPLOAD)}. Upload it in the Cloudflare dashboard instead.`, 'error', 7000);
          const jobs = []; // [key, blob]
          if (isFolder) {
            // strip the picked folder's name; if index.html is one level deeper, use that folder
            let rel = picked.map((f) => [f.webkitRelativePath.split('/').slice(1).join('/'), f]).filter(([r]) => r && !r.split('/').some((p) => p.startsWith('.')));
            if (!rel.some(([r]) => /^index\.html?$/i.test(r))) {
              const inner = rel.find(([r]) => /^[^/]+\/index\.html?$/i.test(r));
              if (!inner) return toast('That folder has no index.html', 'error');
              const top = inner[0].split('/')[0] + '/';
              rel = rel.filter(([r]) => r.startsWith(top)).map(([r, f]) => [r.slice(top.length), f]);
            }
            const dir = `${t.folder}/${slug(name.value || 'game')}`;
            for (const [r, f] of rel) jobs.push([`${dir}/${r}`, f]);
            if (title.value.trim() || desc.value.trim()) {
              jobs.push([`${dir}/game.json`, new Blob([JSON.stringify({ title: title.value.trim() || undefined, description: desc.value.trim() || undefined })], { type: 'application/json' })]);
            }
            if (cover.files[0]) jobs.push([`${dir}/cover${extOf(cover.files[0].name) || '.png'}`, cover.files[0]]);
          } else {
            const folder = type === 'rom' && system.value ? `${t.folder}/${system.value}` : t.folder;
            for (const f of picked) jobs.push([`${folder}/${cleanName(f.name)}`, f]);
            const base = `${folder}/${cleanName(picked[0].name).replace(/\.[^.]+$/, '')}`;
            if (cover.files?.[0]) jobs.push([`${base}${extOf(cover.files[0].name) || '.png'}`, cover.files[0]]);
            if (subs.files?.[0]) jobs.push([`${base}.vtt`, subs.files[0]]);
          }
          if (existing().some((k) => jobs.some(([j]) => j === k))
            && !(await confirmBox('Replace files?', 'Some of these files are already in R2. Upload anyway and replace them?', 'Replace'))) return;

          go.disabled = true;
          const bar = h('div', { class: 'bar' }, h('i'));
          const label = h('div', { class: 'muted small' });
          progress.replaceChildren(bar, label);
          let done = 0, bytes = 0;
          const total = jobs.reduce((t2, [, b]) => t2 + b.size, 0);
          const failed = [];
          // a few at a time
          const queue = [...jobs];
          const worker = async () => {
            while (queue.length) {
              const [key, blob] = queue.shift();
              label.textContent = `Uploading ${key.split('/').pop()}…`;
              try { await putFile(key, blob); } catch (e) { failed.push(`${key}: ${e.message}`); }
              done++; bytes += blob.size;
              bar.firstChild.style.width = `${Math.round((bytes / Math.max(1, total)) * 100)}%`;
            }
          };
          await Promise.all([worker(), worker(), worker()]);
          go.disabled = false;
          if (failed.length) {
            label.textContent = `${done - failed.length} of ${jobs.length} uploaded. Failed: ${failed.slice(0, 3).join('; ')}`;
            toast('Some files failed to upload', 'error');
          } else {
            label.textContent = `Uploaded ${jobs.length} file${jobs.length === 1 ? '' : 's'} (${fmtSize(total)}).`;
            toast('Uploaded! It’ll show on the site within a minute.', 'success', 6000);
            picker.value = ''; cover.value = ''; subs.value = '';
          }
          getManifest(true).catch(() => {});
          loadFiles();
        };
      }

      const existing = () => files.map((f) => f.key);

      async function loadFiles() {
        list.replaceChildren(spinner());
        try {
          files = (await api('files')).files;
        } catch (e) {
          list.replaceChildren(empty('Could not list R2', e.message));
          return;
        }
        if (!files.length) { list.replaceChildren(empty('Nothing in R2 yet', 'Upload something above.')); return; }
        // folder games show as one item
        const groups = new Map();
        for (const f of files) {
          const m = f.key.match(/^(games\/(?:html5|webports)\/[^/]+)\//);
          const id = m ? `${m[1]}/` : f.key;
          const g = groups.get(id) || { id, folder: !!m, size: 0, count: 0, uploaded: f.uploaded };
          g.size += f.size; g.count++;
          if (f.uploaded > g.uploaded) g.uploaded = f.uploaded;
          groups.set(id, g);
        }
        const sections = {};
        for (const g of groups.values()) {
          const sec = g.id.startsWith('games/') ? 'Games' : g.id.startsWith('music/') ? 'Music' : g.id.startsWith('videos/') ? 'Videos' : 'PDFs';
          (sections[sec] ||= []).push(g);
        }
        list.replaceChildren(...Object.entries(sections).flatMap(([sec, items]) => [
          h('div', { class: 'muted tiny list-label' }, `${sec} (${items.length})`),
          h('div', { class: 'admin-table' }, items.sort((a, b) => a.id.localeCompare(b.id)).map((g) => h('div', { class: 'admin-row' },
            h('span', { html: icon(g.folder ? 'folder' : 'upload', 15) }),
            h('span', { class: 'grow clamp1', title: g.id }, g.id),
            h('span', { class: 'muted small' }, g.folder ? `${g.count} files · ${fmtSize(g.size)}` : fmtSize(g.size)),
            g.folder ? h('button', { class: 'btn sm', onClick: () => editGame(g.id) }, 'Edit') : null,
            h('button', { class: 'btn sm danger', onClick: () => del(g) }, 'Delete')))),
        ]));
      }

      async function del(g) {
        if (!(await confirmBox('Delete from R2?', `${g.id}${g.folder ? ` (${g.count} files)` : ''} will be removed from the site. This can’t be undone.`, 'Delete', true))) return;
        try {
          await api(g.folder ? `file?prefix=${encodeURIComponent(g.id)}` : `file?key=${encodeURIComponent(g.id)}`, { method: 'DELETE' });
          toast('Deleted', 'success');
          getManifest(true).catch(() => {});
          loadFiles();
        } catch (e) {
          toast(e.message, 'error');
        }
      }

      async function editGame(dir) {
        let meta = {};
        try {
          const r = await fetch(`${CONFIG.mediaUrl.replace(/\/+$/, '')}/${dir}game.json`, { cache: 'no-store' });
          if (r.ok) meta = await r.json();
        } catch {}
        const title = h('input', { class: 'input', value: meta.title || '', maxlength: 80 });
        const desc = h('input', { class: 'input', value: meta.description || '', maxlength: 200 });
        const cover = h('input', { type: 'file', class: 'input', accept: 'image/png,image/jpeg,image/webp,image/gif' });
        modal({
          title: 'Edit game',
          content: h('div', {},
            h('p', { class: 'muted small' }, dir),
            h('label', { class: 'field' }, h('span', {}, 'Title'), title),
            h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
            h('label', { class: 'field' }, h('span', {}, 'New cover image (optional)'), cover)),
          actions: [
            { label: 'Cancel' },
            { label: 'Save', primary: true, onClick: async () => {
              try {
                const next = { ...meta, title: title.value.trim() || undefined, description: desc.value.trim() || undefined };
                if (cover.files[0]) {
                  const key = `${dir}cover${extOf(cover.files[0].name) || '.png'}`;
                  await putFile(key, cover.files[0]);
                  next.cover = key.split('/').pop();
                }
                await putFile(`${dir}game.json`, new Blob([JSON.stringify(next)], { type: 'application/json' }));
                toast('Saved', 'success');
                getManifest(true).catch(() => {});
                loadFiles();
              } catch (e) {
                toast(e.message, 'error');
                return false;
              }
            } },
          ],
        });
      }

      loadFiles();
    }

    // ============================================================ users
    function users() {
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Search by username or display name' });
      const list = h('div', { class: 'admin-table' });
      const onlyBanned = h('input', { type: 'checkbox' });
      body.replaceChildren(h('section', { class: 'panel' },
        h('h3', {}, 'Users'),
        h('div', { class: 'row gap' }, q, h('label', { class: 'row gap-sm nowrap' }, onlyBanned, h('span', { class: 'small' }, 'Banned only'))),
        list));

      async function load() {
        list.replaceChildren(spinner());
        let query = sb.from('profiles').select(PROFILE_COLS).order('created_at', { ascending: false }).limit(40);
        const s = q.value.trim().replace(/[%,()]/g, '');
        if (s) query = query.or(`username.ilike.%${s}%,display_name.ilike.%${s}%`);
        if (onlyBanned.checked) query = query.eq('banned', true);
        const { data, error } = await query;
        if (error) { list.replaceChildren(empty('Could not load users', error.message)); return; }
        if (!data.length) { list.replaceChildren(empty('No one found')); return; }
        list.replaceChildren(...data.map(row));
      }

      const update = async (p, patch, msg) => {
        const { error } = await sb.from('profiles').update(patch).eq('id', p.id);
        if (error) return toast(error.message, 'error');
        toast(msg, 'success');
        load();
      };

      function row(p) {
        const me = p.id === session.user.id;
        return h('div', { class: 'admin-row' },
          h('button', { class: 'link-btn row gap-sm grow admin-user', onClick: () => showProfileModal(p) },
            avatarEl(p, 32),
            h('span', { class: 'admin-user-names' },
              h('b', { class: 'clamp1' }, displayName(p), ' ', badgeList(p).map((b) => BADGES[b].emoji).join('')),
              h('span', { class: 'muted tiny' }, `@${p.username} · joined ${formatDate(p.created_at)}`))),
          p.banned ? h('span', { class: 'chip sm danger-chip' }, 'Banned') : null,
          h('button', { class: 'btn sm', onClick: () => badgesModal(p) }, 'Badges'),
          me ? null : h('button', { class: 'btn sm', onClick: async () => {
            if (p.is_admin) {
              if (await confirmBox('Remove admin?', `${displayName(p)} won’t be able to use the admin panel.`, 'Remove', true)) update(p, { is_admin: false }, 'Admin removed');
            } else if (await confirmBox('Make admin?', `${displayName(p)} will be able to upload and delete files, ban people and post announcements.`, 'Make admin')) {
              update(p, { is_admin: true }, `${displayName(p)} is now an admin`);
            }
          } }, p.is_admin ? 'Remove admin' : 'Make admin'),
          me ? null : h('button', { class: `btn sm${p.banned ? '' : ' danger'}`, onClick: async () => {
            if (p.banned) return update(p, { banned: false }, 'Unbanned');
            if (await confirmBox(`Ban ${displayName(p)}?`, 'They won’t be able to send messages, make rooms, add friends or upload PDFs. Their old messages stay until you delete them.', 'Ban', true)) {
              update(p, { banned: true }, 'Banned');
            }
          } }, p.banned ? 'Unban' : 'Ban'));
      }

      function badgesModal(p) {
        const chosen = new Set(p.badges || []);
        const grid = h('div', { class: 'badge-pick' }, Object.entries(BADGES).filter(([id]) => id !== 'admin').map(([id, b]) => {
          const box = h('input', { type: 'checkbox', checked: chosen.has(id), onChange: (e) => (e.target.checked ? chosen.add(id) : chosen.delete(id)) });
          return h('label', { class: 'badge-opt' }, box, h('span', {}, `${b.emoji} ${b.label}`));
        }));
        modal({
          title: `Badges for ${displayName(p)}`,
          content: grid,
          actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => update(p, { badges: [...chosen] }, 'Badges saved') }],
        });
      }

      q.addEventListener('input', debounce(load, 250));
      onlyBanned.onchange = load;
      load();
    }
  },
};
