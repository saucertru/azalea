import { h, icon, empty, spinner, debounce, toast, formatBytes, timeAgo, pickFile, confirmBox } from '../ui.js';
import { getManifest } from '../data.js';
import { sb } from '../supabase.js';
import { session } from '../auth.js';

const MAX = 25 * 1024 * 1024;

function pdfCard(item, onOpen, extra) {
  return h('div', { class: 'card pdf-card', tabindex: 0, onClick: onOpen, onKeydown: (e) => e.key === 'Enter' && onOpen() },
    item.cover ? h('img', { class: 'pdf-cover', src: item.cover, alt: '', loading: 'lazy' }) : h('div', { class: 'pdf-cover ph', html: icon('pdf', 36) }),
    h('div', { class: 'card-body' }, h('b', { class: 'clamp2' }, item.title), h('span', { class: 'muted small' }, item.meta || '')),
    extra || null);
}

export default {
  id: 'pdfs',
  name: 'PDFs',
  icon: 'pdf',
  mount(el, params, ctx) {
    let local = [];
    let uploads = [];
    let query = '';
    let alive = true;

    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search PDFs' });
    const uploadBtn = h('button', { class: 'btn primary', onClick: upload }, h('span', { html: icon('upload', 16) }), 'Upload PDF');
    const localGrid = h('div', { class: 'grid pdf-grid' });
    const upGrid = h('div', { class: 'grid pdf-grid' });
    const browse = h('div', {},
      h('div', { class: 'toolbar' }, search, uploadBtn),
      h('h3', { class: 'section-title' }, 'Library'), localGrid,
      h('h3', { class: 'section-title' }, 'Uploaded by users'), upGrid);
    el.append(browse);

    function open(item) {
      if (ctx.openFrame(item.title, item.src, { iconName: 'pdf', width: 900, height: 700 })) return;
      el.replaceChildren(h('div', { class: 'viewer' },
        h('div', { class: 'row gap' },
          h('button', { class: 'btn sm', onClick: () => el.replaceChildren(browse) }, h('span', { html: icon('back', 16) }), 'Back'),
          h('b', { class: 'grow clamp1' }, item.title),
          h('a', { class: 'btn sm', href: item.src, target: '_blank', rel: 'noopener' }, h('span', { html: icon('external', 16) }), 'New tab')),
        h('iframe', { class: 'viewer-frame', src: item.src, title: item.title })));
    }

    function render() {
      const q = query.toLowerCase();
      const match = (x) => !q || x.title.toLowerCase().includes(q);
      const l = local.filter(match);
      localGrid.replaceChildren(...(l.length ? l.map((x) => pdfCard(x, () => open(x))) : [empty(local.length ? 'No matches' : 'No PDFs in the library', local.length ? '' : 'Drop .pdf files into the /pdfs folder, then rebuild.')]));
      const u = uploads.filter(match);
      if (session.offline || !sb) {
        upGrid.replaceChildren(empty('Uploads need Supabase', 'Add your Supabase keys in js/config.js to turn on PDF uploads.'));
        return;
      }
      upGrid.replaceChildren(...(u.length ? u.map((x) => pdfCard(x, () => open(x),
        x.user_id === session.user?.id
          ? h('button', { class: 'icon-btn sm card-del', title: 'Delete', html: icon('trash', 16), onClick: (e) => { e.stopPropagation(); remove(x); } })
          : null)) : [empty(uploads.length ? 'No matches' : 'No uploads yet')]));
    }

    async function loadUploads() {
      if (!sb || session.offline) return;
      const { data, error } = await sb.from('pdf_uploads').select('*, profiles(username)').order('created_at', { ascending: false }).limit(200);
      if (error) { console.error(error); return; }
      uploads = data.map((r) => ({
        ...r,
        src: sb.storage.from('pdfs').getPublicUrl(r.path).data.publicUrl,
        meta: `${r.profiles?.username || 'someone'} · ${timeAgo(r.created_at)} · ${formatBytes(r.size)}`,
      }));
    }

    async function upload() {
      if (session.offline || !sb) { toast('Uploads need Supabase set up in js/config.js', 'error'); return; }
      const file = await pickFile('application/pdf');
      if (!file) return;
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('That isn’t a PDF', 'error'); return; }
      if (file.size > MAX) { toast('PDF must be under 25 MB', 'error'); return; }
      uploadBtn.disabled = true;
      uploadBtn.lastChild.textContent = 'Uploading…';
      try {
        const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${session.user.id}/${Date.now()}-${safe}`;
        const { error } = await sb.storage.from('pdfs').upload(path, file, { contentType: 'application/pdf' });
        if (error) throw error;
        const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').slice(0, 120) || 'Untitled';
        const { error: e2 } = await sb.from('pdf_uploads').insert({ user_id: session.user.id, title, path, size: file.size });
        if (e2) {
          await sb.storage.from('pdfs').remove([path]);
          throw e2;
        }
        toast('PDF uploaded', 'success');
        await loadUploads();
        render();
      } catch (e) {
        toast(e.message || 'Upload failed', 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.lastChild.textContent = 'Upload PDF';
      }
    }

    async function remove(x) {
      if (!(await confirmBox('Delete PDF?', `“${x.title}” will be removed for everyone.`, 'Delete', true))) return;
      const { error } = await sb.from('pdf_uploads').delete().eq('id', x.id);
      if (error) return toast(error.message, 'error');
      await sb.storage.from('pdfs').remove([x.path]);
      uploads = uploads.filter((u) => u.id !== x.id);
      render();
      toast('Deleted');
    }

    search.addEventListener('input', debounce(() => { query = search.value; render(); }, 120));
    localGrid.replaceChildren(spinner());
    Promise.all([getManifest(), loadUploads()]).then(([m]) => {
      if (!alive) return;
      local = m.pdfs.map((p) => ({ ...p, meta: formatBytes(p.size) }));
      render();
    });
    return () => { alive = false; };
  },
};
